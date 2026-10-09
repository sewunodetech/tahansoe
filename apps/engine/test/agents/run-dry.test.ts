/**
 * End-to-end test: runResearch mode dry + FakeProvider (tanpa API, tanpa DB).
 * Memverifikasi 4 file ditulis ke direktori sementara dan report valid.
 *
 * JARINGAN DILARANG: test ini menyuntik `fixtureCollector` (offline) dan
 * mem-stub `globalThis.fetch` agar MELEMPAR. Jika ada kode yang mencoba fetch
 * (mis. collector live), test gagal — membuktikan unit test tidak menyentuh jaringan.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runResearch } from "../../src/agents/run.ts";
import { Budget } from "../../src/llm/budget.ts";
import { FakeProvider } from "../fake-provider.ts";
import { fakeScript, fixtureCollector } from "../fixtures/research-fixtures.ts";

// Stub fetch agar setiap panggilan jaringan gagal keras selama test ini.
const originalFetch = globalThis.fetch;
before(() => {
  globalThis.fetch = (async () => {
    throw new Error("NETWORK ACCESS FORBIDDEN in unit test");
  }) as typeof fetch;
});
after(() => {
  globalThis.fetch = originalFetch;
});

test("dry + fake: menulis report.json, analysts.json, debate.json, report.md (offline)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "engine-dry-"));
  try {
    const provider = new FakeProvider(fakeScript());
    const result = await runResearch({
      trigger: "SCHEDULED",
      chainId: 42161,
      assets: ["ETH", "USDC"],
      provider,
      collector: fixtureCollector,
      budget: new Budget(1000),
      dry: true,
      outDir: dir,
    });

    assert.ok(result.report, "report tidak null");
    assert.equal(result.outDir, dir);
    assert.equal(result.report?.proposedRegime, "ELEVATED");

    for (const f of ["report.json", "analysts.json", "debate.json", "report.md"]) {
      await access(join(dir, f)); // melempar jika tidak ada
    }

    const reportJson = JSON.parse(await readFile(join(dir, "report.json"), "utf8"));
    // Cap confidence 0.6 ditegakkan di signal (to-signal.ts).
    assert.ok(reportJson.signal.confidence <= 0.6);
    assert.equal(reportJson.signal.module, "RESEARCH");

    const analysts = JSON.parse(await readFile(join(dir, "analysts.json"), "utf8"));
    assert.equal(analysts.length, 4, "4 analyst report tersimpan");

    // --- Inputs (audit, G7) ---
    // report.json.inputs: counts per category/module + chainNotes + warnings terpisah.
    assert.ok(reportJson.inputs, "report.json memuat field inputs");
    assert.equal(reportJson.inputs.marketEventsByCategory["geopolitics:BBC"], 2);
    assert.equal(reportJson.inputs.marketEventsByCategory["crypto:CoinDesk"], 1);
    assert.equal(reportJson.inputs.signalsByModule["ONCHAIN"], 1);
    assert.equal(reportJson.inputs.signalsByModule["ORACLE"], 1);
    // Warnings disimpan TERPISAH (bukan di chainNotes dengan prefix "warning:").
    assert.ok(
      reportJson.inputs.warnings.some((w: string) => w.includes("FRED")),
      "warning FRED ada di inputs.warnings",
    );
    assert.ok(
      reportJson.inputs.chainNotes.every((n: string) => !n.startsWith("warning:")),
      "chainNotes tidak lagi memuat warning berprefix",
    );

    const md = await readFile(join(dir, "report.md"), "utf8");
    assert.match(md, /# Research Report/);
    assert.match(md, /Proposed regime/);
    assert.match(md, /Hawk vs Dove/);
    // Bagian Inputs di report.md.
    assert.match(md, /## Inputs/);
    assert.match(md, /geopolitics:BBC: 2/);
    assert.match(md, /crypto:CoinDesk: 1/);
    assert.match(md, /Source warnings/);
    assert.match(md, /FRED/);

    // --- Run diagnostics (audit G7) ---
    assert.ok(reportJson.diagnostics, "report.json memuat diagnostics");
    const roles = reportJson.diagnostics.roles.map((r: { role: string }) => r.role);
    // 4 analyst + hawk + dove + assessor.
    for (const role of ["analyst:geopolitics", "analyst:macro", "analyst:market", "analyst:onchain", "hawk", "dove", "assessor"]) {
      assert.ok(roles.includes(role), `diagnostics memuat peran ${role}`);
    }
    // Semua peran ok di fixture; usage terkumpul (FakeProvider = 1000/200 per call).
    assert.ok(reportJson.diagnostics.roles.every((r: { ok: boolean }) => r.ok), "semua peran ok");
    assert.ok(reportJson.diagnostics.totalInputTokens > 0, "total input tokens terkumpul");
    assert.ok(reportJson.diagnostics.totalOutputTokens > 0, "total output tokens terkumpul");
    assert.equal(typeof reportJson.diagnostics.durationMs, "number");
    assert.match(md, /## Run diagnostics/);
    assert.match(md, /Total tokens/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("dry + fake: < 3 analyst sukses → report null, tidak menulis file (offline)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "engine-dry-fail-"));
  try {
    // Hanya 2 analyst sukses (2 refusal), sisanya tak terpakai.
    const provider = new FakeProvider([
      { data: { domain: "GEOPOLITICS", findings: [], summary: "ok" } },
      { data: { domain: "MACRO", findings: [], summary: "ok" } },
      { stopReason: "refusal", error: "refusal" },
      { stopReason: "refusal", error: "refusal" },
    ]);
    const result = await runResearch({
      trigger: "SCHEDULED",
      chainId: 42161,
      assets: ["ETH"],
      provider,
      collector: fixtureCollector,
      budget: new Budget(1000),
      dry: true,
      outDir: dir,
    });
    assert.equal(result.report, null);
    // Alasan harus menyebut jumlah analyst sukses & kegagalan per peran.
    assert.match(result.reason ?? "", /analyst sukses/);
    assert.match(result.reason ?? "", /refusal/);
    // Diagnostics mencatat peran yang GAGAL beserta alasannya + usage terkumpul.
    assert.ok(result.diagnostics, "diagnostics ada walau run gagal");
    const failed = result.diagnostics!.roles.filter((r) => !r.ok);
    assert.ok(failed.length >= 1, "ada peran gagal tercatat");
    assert.ok(failed.every((r) => typeof r.reason === "string" && r.reason!.length > 0), "alasan tercatat");
    assert.ok(
      result.diagnostics!.roles.some((r) => r.inputTokens > 0),
      "usage terkumpul walau sebagian gagal",
    );
    // Tidak ada file ditulis.
    await assert.rejects(() => access(join(dir, "report.json")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("dry + fake: error 400 non-retryable → stop sebelum debate/assessor, alasan jelas", async () => {
  // Semua panggilan mengembalikan error 400 (mis. kredit habis). Analis dijalankan
  // KONKUREN (4 panggilan), lalu GUARD fail-fast menghentikan run SEBELUM debate &
  // assessor karena analyst pertama gagal non-retryable (cli-polish §5).
  const provider = new FakeProvider([], {
    stopReason: "error",
    error: "400 Your credit balance is too low to access the Anthropic API",
    status: 400,
  });
  const result = await runResearch({
    trigger: "SCHEDULED",
    chainId: 42161,
    assets: ["ETH", "USDC"],
    provider,
    collector: fixtureCollector,
    budget: new Budget(1000),
    dry: true,
  });
  assert.equal(result.report, null);
  // 4 panggilan analis (konkuren), TIDAK ada panggilan debate/assessor sesudahnya.
  assert.equal(provider.calls.length, 4, "hanya 4 analis dipanggil; berhenti sebelum debate/assessor");
  // Alasan menyebut error non-retryable + pesan asli (tanpa API key).
  assert.match(result.reason ?? "", /non-retryable/);
  assert.match(result.reason ?? "", /credit balance is too low/);
  assert.doesNotMatch(result.reason ?? "", /sk-ant|api[_-]?key/i);
});

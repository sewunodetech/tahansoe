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
    // Tidak ada file ditulis.
    await assert.rejects(() => access(join(dir, "report.json")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

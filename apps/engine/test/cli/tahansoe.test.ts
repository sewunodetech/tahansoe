/**
 * Unit/integrasi test CLI tahansoe (spec m3-cli §6). Offline:
 *  - render: sanitizeExternal (anti-injeksi ANSI), maskHost, box/bar/sparkline width.
 *  - analyze --fake --json → JSON valid (stdout), exit 0.
 *  - doctor dengan fetch mock → tanpa kebocoran key; exit code sesuai.
 *  - schedule --once dengan worker mock → satu siklus lalu stop.
 *  - arg parsing: --help per command, perintah tak dikenal.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

// Isolasi dari settings.json lokal.
process.env.TAHANSOE_SETTINGS = "/__tahansoe_no_settings__/cli.test.json";

import {
  sanitizeExternal,
  maskHost,
  detectTheme,
  box,
  bar,
  sparkline,
  renderReportCard,
  createProgress,
  type Theme,
} from "../../src/cli/render.ts";
import { analyzeCommand } from "../../src/cli/commands/analyze.ts";
import { doctorCommand, runDoctor, formatDoctor, type DoctorFetch } from "../../src/cli/commands/doctor.ts";
import { scheduleCommand } from "../../src/cli/commands/schedule.ts";
import { reportCommand } from "../../src/cli/commands/report.ts";
import { historyCommand } from "../../src/cli/commands/history.ts";

const noColor: Theme = { color: false, width: 70 };

// --- render / security ----------------------------------------------------

test("sanitizeExternal: buang ANSI/OSC & kontrol, sisakan teks", () => {
  const evil = "\x1b[2J\x1b]8;;http://evil\x07hi\r\nthere\x00";
  const out = sanitizeExternal(evil);
  assert.equal(out, "hi there");
  assert.doesNotMatch(out, /\x1b/);
});

test("sanitizeExternal: truncate dengan …", () => {
  const out = sanitizeExternal("x".repeat(50), 10);
  assert.equal(out.length, 10);
  assert.ok(out.endsWith("…"));
});

test("maskHost: host saja, tanpa path/userinfo/key", () => {
  assert.equal(maskHost("https://user:pass@router.bynara.id/v1/chat?key=secret"), "router.bynara.id");
  assert.equal(maskHost("router.bynara.id/v1"), "router.bynara.id");
  assert.equal(maskHost("not a url"), "(invalid url)");
  assert.equal(maskHost(""), "(invalid url)");
});

test("detectTheme: NO_COLOR / --no-color / non-TTY → color off", () => {
  assert.equal(detectTheme([], { NO_COLOR: "1" }, { isTTY: true, columns: 100 }).color, false);
  assert.equal(detectTheme(["--no-color"], {}, { isTTY: true, columns: 100 }).color, false);
  assert.equal(detectTheme([], {}, { isTTY: false }).color, false);
  assert.equal(detectTheme([], {}, { isTTY: true, columns: 120 }).color, true);
});

test("box: lebar konsisten (width 60 & 100), judul inline", () => {
  for (const w of [60, 100]) {
    const b = box(noColor, "TITLE", ["line one", "x".repeat(200)], w);
    const lines = b.split("\n");
    assert.ok(lines[0]!.startsWith("╭─ TITLE "));
    // semua baris body punya lebar sama
    const widths = new Set(lines.map((l) => l.length));
    assert.equal(widths.size, 1, `box width tidak konsisten pada w=${w}`);
  }
});

test("bar & sparkline: deterministik", () => {
  assert.equal(bar(0.5, 10), "█████░░░░░");
  assert.equal(bar(0, 4), "░░░░");
  assert.equal(bar(1, 4), "████");
  const sp = sparkline(noColor, ["CALM", "ELEVATED", "STRESSED", "CRISIS"]);
  assert.equal(sp, "▁▃▅█");
});

test("progress: analyst gagal → baris ✖ + alasan, bukan ✔; kolom label sejajar (cli-fix §3)", () => {
  const out: string[] = [];
  const progress = createProgress(noColor, { isTTY: false, write: (s) => out.push(s) });
  progress.done("analyst:macro", "deepseek-v4-flash", 1200);
  progress.fail("analyst:geopolitics", "schema invalid: summary too long");
  const text = out.join("");
  assert.match(text, /✖ analyst:geopolitics/);
  assert.match(text, /schema invalid: summary too long/);
  assert.doesNotMatch(text, /✔ analyst:geopolitics/);
  const okLine = out.find((l) => l.includes("✔"))!;
  const failLine = out.find((l) => l.includes("✖"))!;
  assert.equal(okLine.indexOf("analyst:macro"), failLine.indexOf("analyst:geopolitics"), "kolom label sejajar");
});

test("renderReportCard: footer 'not a trading signal', tanpa buy/sell", () => {
  const card = renderReportCard(noColor, {
    createdAt: new Date("2026-10-09T14:02:00Z"),
    regime: "ELEVATED",
    direction: "DOWN",
    confidence: 0.55,
    confidenceCap: 0.6,
    horizonHours: 24,
    paths: [{ code: "T2", label: "Macro rates shock", severity: 0.7 }],
    evidence: [{ text: "FOMC in 2 days", source: "Fed" }],
    reportId: "a91f1234",
    tokens: 46800,
    costIdr: 41,
    durationMs: 11500,
  });
  assert.match(card, /not a trading signal/);
  assert.doesNotMatch(card.toLowerCase(), /\bbuy\b|\bsell\b/);
  assert.match(card, /saved #a91f1/);
});

test("renderReportCard: label 'Proposed regime (research)' + footer biaya IDR; path code pad 3", () => {
  const card = renderReportCard(noColor, {
    createdAt: new Date("2026-10-09T14:02:00Z"),
    regime: "CALM",
    direction: "VOLATILITY",
    confidence: 0.45,
    confidenceCap: 0.6,
    horizonHours: 24,
    paths: [
      { code: "T1", label: "Collateral price drop", severity: 0.5 },
      { code: "T10", label: "L2 sequencer down", severity: 0.4 },
    ],
    evidence: [],
    suggestion: "No change suggested: your static policy applies",
    tokens: 36500,
    costIdr: 6,
    durationMs: 345000,
  });
  assert.match(card, /Proposed regime \(research\)/, "label menandai regime proposal riset");
  assert.match(card, /Rp 6/, "biaya IDR di footer");
  assert.match(card, /36\.5k tok/);
  // Path code di-pad lebar 3: label 'Collateral' dan 'L2' mulai pada kolom sama.
  const t1 = card.split("\n").find((l) => l.includes("T1 "))!;
  const t10 = card.split("\n").find((l) => l.includes("T10"))!;
  assert.equal(t1.indexOf("Collateral"), t10.indexOf("L2 sequencer"), "label jalur sejajar (pad kode 3)");
});

test("suggestionFor: bergantung regime, tanpa buy/sell", async () => {
  const { suggestionFor } = await import("../../src/cli/report-card-data.ts");
  assert.match(suggestionFor("CALM"), /No change suggested/);
  assert.match(suggestionFor("ELEVATED"), /higher buffer within your approved band/i);
  assert.match(suggestionFor("STRESSED"), /rules engine decides/i);
  assert.match(suggestionFor("CRISIS"), /rules engine decides/i);
  for (const r of ["CALM", "ELEVATED", "STRESSED", "CRISIS"]) {
    assert.doesNotMatch(suggestionFor(r).toLowerCase(), /\bbuy\b|\bsell\b/);
  }
});

test("runCostFromDiagnostics: USD + IDR dari harga runtime (Bynara)", async () => {
  const { setRuntimePricing, clearRuntimePricing } = await import("../../src/llm/budget.ts");
  const { runCostFromDiagnostics } = await import("../../src/cli/report-card-data.ts");
  const usdToIdr = 17891.619611;
  try {
    setRuntimePricing(
      new Map([
        ["agnes-2.5-flash", { inputPerM: 100 / usdToIdr, outputPerM: 200 / usdToIdr, native: { currency: "IDR" as const, inputPerM: 100, outputPerM: 200, usdToNative: usdToIdr } }],
      ]),
    );
    const diag = {
      roles: [
        { role: "assessor", ok: true, usedModel: "agnes-2.5-flash", inputTokens: 1_000_000, outputTokens: 1_000_000 },
      ],
      totalInputTokens: 1_000_000,
      totalOutputTokens: 1_000_000,
      durationMs: 1000,
    };
    const c = runCostFromDiagnostics(diag);
    assert.ok(Math.abs(c.usd - 300 / usdToIdr) < 1e-9);
    assert.ok(c.idr !== undefined && Math.abs(c.idr - 300) < 1e-6, "IDR = 100+200 per 1M");
  } finally {
    clearRuntimePricing();
  }
});

test("analyze --fake --json → JSON valid di stdout, exit 0", async () => {
  const chunks: string[] = [];
  const code = await analyzeCommand(["--fake", "--json", "--no-color"], {
    stdout: (s) => chunks.push(s),
    stderr: () => {},
  });
  assert.equal(code, 0);
  const out = chunks.join("");
  const parsed = JSON.parse(out); // harus JSON valid tunggal
  assert.equal(parsed.regime !== undefined, true);
  assert.equal(parsed.disclaimer, "not a trading signal");
  assert.ok(Array.isArray(parsed.paths));
});

test("analyze --help → exit 0", async () => {
  let out = "";
  const code = await analyzeCommand(["--help"], { stdout: (s) => void (out += s), stderr: () => {} });
  assert.equal(code, 0);
  assert.match(out, /tahansoe analyze/);
});

// --- doctor ---------------------------------------------------------------

test("doctor: fetch mock, key TIDAK bocor di output", async () => {
  const prevUrl = process.env.LLM_API_URL;
  const prevKey = process.env.LLM_API_KEY;
  process.env.LLM_API_URL = "https://router.bynara.id/v1";
  process.env.LLM_API_KEY = "SUPER-SECRET-KEY-123";
  try {
    const fetchImpl: DoctorFetch = async () => ({ ok: true, status: 200, json: async () => ({ result: "0xa4b1" }), text: async () => "" });
    const results = await runDoctor({ fetchImpl, env: process.env, checkDb: async () => ({ ok: true, detail: "connected" }), loadSettingsImpl: async () => ({ ok: true, detail: "v2 valid" }) });
    const text = formatDoctor(noColor, results);
    assert.doesNotMatch(text, /SUPER-SECRET-KEY-123/, "key tidak boleh muncul");
    assert.match(text, /router\.bynara\.id/, "host disamarkan muncul");
    assert.match(text, /set \(hidden\)/, "key ditandai hidden");
    // gateway /models ok
    const models = results.find((r) => r.name === "gateway /models");
    assert.ok(models?.ok);
  } finally {
    if (prevUrl === undefined) delete process.env.LLM_API_URL; else process.env.LLM_API_URL = prevUrl;
    if (prevKey === undefined) delete process.env.LLM_API_KEY; else process.env.LLM_API_KEY = prevKey;
  }
});

test("doctor: /models error → check ✖ pesan tersanitasi (cli-fix §5)", async () => {
  const prevUrl = process.env.LLM_API_URL;
  const prevKey = process.env.LLM_API_KEY;
  process.env.LLM_API_URL = "https://router.bynara.id/v1";
  process.env.LLM_API_KEY = "k";
  try {
    const fetchImpl: DoctorFetch = async () => {
      throw new Error("timeout after 25s");
    };
    const results = await runDoctor({
      fetchImpl,
      env: process.env,
      checkDb: async () => ({ ok: true, detail: "connected" }),
      loadSettingsImpl: async () => ({ ok: true, detail: "ok" }),
    });
    const models = results.find((r) => r.name === "gateway /models")!;
    assert.equal(models.ok, false);
    assert.match(models.detail, /timeout after 25s/);
  } finally {
    if (prevUrl === undefined) delete process.env.LLM_API_URL; else process.env.LLM_API_URL = prevUrl;
    if (prevKey === undefined) delete process.env.LLM_API_KEY; else process.env.LLM_API_KEY = prevKey;
  }
});

test("doctor: exit 2 bila LLM_API_URL/KEY hilang", async () => {
  const prevUrl = process.env.LLM_API_URL;
  const prevKey = process.env.LLM_API_KEY;
  const prevBase = process.env.LLM_BASE_URL;
  delete process.env.LLM_API_URL;
  delete process.env.LLM_BASE_URL;
  delete process.env.LLM_API_KEY;
  try {
    const code = await doctorCommand(["--no-color"], {
      stdout: () => {},
      stderr: () => {},
      fetchImpl: async () => ({ ok: false, status: 0, json: async () => ({}), text: async () => "" }),
      checkDb: async () => ({ ok: false, detail: "no db" }),
      loadSettingsImpl: async () => ({ ok: true, detail: "default" }),
    });
    assert.equal(code, 2, "config error exit code");
  } finally {
    if (prevUrl !== undefined) process.env.LLM_API_URL = prevUrl;
    if (prevBase !== undefined) process.env.LLM_BASE_URL = prevBase;
    if (prevKey !== undefined) process.env.LLM_API_KEY = prevKey;
  }
});

// --- schedule --------------------------------------------------------------

test("schedule --once dengan worker mock → satu siklus, exit 0", async () => {
  let started = false;
  let stopped = false;
  const code = await scheduleCommand(["run", "--once"], {
    makeWorker: () => ({
      start: async () => {
        started = true;
        return true;
      },
      stop: async () => {
        stopped = true;
      },
    }),
  });
  assert.equal(code, 0);
  assert.ok(started, "worker.start dipanggil");
  assert.ok(stopped, "worker.stop dipanggil");
});

test("schedule status (mock) → exit 0", async () => {
  const code = await scheduleCommand(["status"], { statusImpl: async () => "scheduler status: mock" });
  assert.equal(code, 0);
});

// --- report / history arg parsing -----------------------------------------

test("report: tanpa argumen → exit 1", async () => {
  const code = await reportCommand([]);
  assert.equal(code, 1);
});

test("history: tanpa DATABASE_URL → exit 1 (json)", async () => {
  const prev = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  const chunks: string[] = [];
  try {
    const code = await historyCommand(["--json"], { stdout: (s) => chunks.push(s), stderr: () => {} });
    assert.equal(code, 1);
    assert.match(chunks.join(""), /DATABASE_URL/);
  } finally {
    if (prev !== undefined) process.env.DATABASE_URL = prev;
  }
});

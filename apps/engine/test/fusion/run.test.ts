/**
 * Integrasi fusion/run.ts (mocked DB) + FusionTicker + CLI fuse.
 *
 * GUARDRAIL (invariant): sinyal RESEARCH/NEWS/SOCIAL SENDIRIAN tidak pernah
 * menghasilkan regime STRESSED/CRISIS yang tersimpan — dibuktikan lewat run.ts
 * dengan DB palsu (property test atas banyak himpunan acak).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { REGIMES } from "@tahansoe/domain";
import type { RiskAssessment, Signal } from "@tahansoe/domain";
import { runFusion, type FusionDeps } from "../../src/fusion/run.ts";
import { FusionTicker, FUSION_ADVISORY_LOCK_KEY, SETTLE_ADVISORY_LOCK_KEY, fusionIntervalMs } from "../../src/cli/commands/schedule.ts";
import { fuseCommand } from "../../src/cli/commands/fuse.ts";
import { sig, NOW, resetSeq } from "./_fixtures.ts";

const rank = (r: string) => REGIMES.indexOf(r as (typeof REGIMES)[number]);

/** DB palsu: signals dari list, prior null, tanpa harga; menangkap tulisan. */
function mockDeps(signals: Signal[], written: RiskAssessment[]): Partial<FusionDeps> {
  return {
    emitSignals: async () => [],
    loadActiveSignals: async () => signals,
    loadPrior: async () => null,
    loadPriceSamples: async () => [],
    writeAssessment: async (a) => {
      written.push(a);
      return `id-${written.length}`;
    },
    logger: { warn: () => {} },
  };
}

// PRNG deterministik.
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const UNCONFIRMED: Array<"RESEARCH" | "NEWS" | "SOCIAL"> = ["RESEARCH", "NEWS", "SOCIAL"];
const PATHS = ["T1", "T2", "T3", "T4", "T8", "T9", "T10"] as const;

test("GUARDRAIL via run.ts: 300 himpunan acak RESEARCH/NEWS/SOCIAL → assessment TIDAK PERNAH ≥ STRESSED", async () => {
  const rand = mulberry32(1234);
  for (let iter = 0; iter < 300; iter++) {
    resetSeq();
    const n = 1 + Math.floor(rand() * 6);
    const signals: Signal[] = Array.from({ length: n }, () =>
      sig({
        module: UNCONFIRMED[Math.floor(rand() * UNCONFIRMED.length)]!,
        severity: rand(),
        confidence: rand(),
        direction: rand() < 0.5 ? "DOWN" : "VOLATILITY",
        paths: [PATHS[Math.floor(rand() * PATHS.length)]!],
        assets: ["ETH"],
      }),
    );
    const written: RiskAssessment[] = [];
    const result = await runFusion({ chainId: 42161, assets: ["ETH"], now: NOW, deps: mockDeps(signals, written) });
    const eth = result.results.find((r) => r.asset === "ETH")!;
    if (eth.assessment) {
      assert.ok(
        rank(eth.assessment.regime) < rank("STRESSED"),
        `iter ${iter}: regime ${eth.assessment.regime} ≥ STRESSED dari sinyal tak terkonfirmasi (reasons: ${eth.reasons.join(",")})`,
      );
    }
    // Yang tertulis juga tak boleh ≥ STRESSED.
    for (const a of written) assert.ok(rank(a.regime) < rank("STRESSED"));
  }
});

test("run.ts: ONCHAIN T4 (depeg) → assessment STRESSED tersimpan (konfirmasi memperbolehkan)", async () => {
  resetSeq();
  const signals: Signal[] = [sig({ module: "ONCHAIN", paths: ["T4"], severity: 0.6, confidence: 0.8, assets: ["USDC"] })];
  const written: RiskAssessment[] = [];
  const result = await runFusion({ chainId: 42161, assets: ["USDC"], now: NOW, deps: mockDeps(signals, written) });
  const usdc = result.results.find((r) => r.asset === "USDC")!;
  assert.ok(usdc.assessment);
  assert.equal(usdc.assessment!.regime, "STRESSED");
  assert.equal(written.length, 1, "satu baris tertulis");
  assert.equal(written[0]!.modelVersion.startsWith("fusion-v1"), true);
  assert.ok(written[0]!.validUntil.getTime() > written[0]!.createdAt.getTime(), "valid_until > created_at");
});

test("run.ts: tanpa sinyal aktif → tidak ada assessment, tidak menulis", async () => {
  const written: RiskAssessment[] = [];
  const result = await runFusion({ chainId: 42161, assets: ["ETH"], now: NOW, deps: mockDeps([], written) });
  assert.equal(result.results[0]!.assessment, null);
  assert.equal(written.length, 0);
});

test("run.ts: dry → hitung tapi TIDAK menulis", async () => {
  resetSeq();
  const signals: Signal[] = [sig({ module: "ONCHAIN", paths: ["T4"], severity: 0.6, confidence: 0.8, assets: ["USDC"] })];
  const written: RiskAssessment[] = [];
  const result = await runFusion({ chainId: 42161, assets: ["USDC"], now: NOW, dry: true, deps: mockDeps(signals, written) });
  assert.ok(result.results[0]!.assessment, "assessment dihitung");
  assert.equal(written.length, 0, "dry tidak menulis");
  assert.match(result.results[0]!.note ?? "", /dry/);
});

test("run.ts: loadActiveSignals melempar → degradasi (hasil kosong, tidak crash)", async () => {
  const result = await runFusion({
    chainId: 42161,
    assets: ["ETH"],
    now: NOW,
    deps: {
      loadActiveSignals: async () => {
        throw new Error("db down");
      },
      loadPrior: async () => null,
      loadPriceSamples: async () => [],
      writeAssessment: async () => "x",
      logger: { warn: () => {} },
    },
  });
  assert.equal(result.results.length, 0, "degradasi: tanpa assessment");
});

test("run.ts: writeAssessment melempar → assessment tetap dihitung, note write failed (tidak crash)", async () => {
  resetSeq();
  const signals: Signal[] = [sig({ module: "ONCHAIN", paths: ["T4"], severity: 0.6, confidence: 0.8, assets: ["USDC"] })];
  const result = await runFusion({
    chainId: 42161,
    assets: ["USDC"],
    now: NOW,
    deps: {
      loadActiveSignals: async () => signals,
      loadPrior: async () => null,
      loadPriceSamples: async () => [],
      writeAssessment: async () => {
        throw new Error("insert failed");
      },
      logger: { warn: () => {} },
    },
  });
  const usdc = result.results[0]!;
  assert.ok(usdc.assessment);
  assert.match(usdc.note ?? "", /write failed/);
});

// --- FusionTicker ----------------------------------------------------------

function fakeIntervalClock() {
  let cb: (() => void) | null = null;
  return {
    clock: { setInterval: (fn: () => void) => { cb = fn; return 1; }, clearInterval: () => { cb = null; } },
    fire: () => cb?.(),
    hasTimer: () => cb !== null,
  };
}
const silent = { info: () => {}, warn: () => {}, error: () => {} };

test("FusionTicker: lock ok → tick pertama jalan + dashboard line", async () => {
  let released = false;
  const fc = fakeIntervalClock();
  const ticker = new FusionTicker(
    async () => ({ chainId: 42161, now: NOW, dry: false, results: [
      { asset: "ETH", assessment: { regime: "ELEVATED" } as RiskAssessment, reasons: [] },
      { asset: "USDC", assessment: null, reasons: [] },
    ] }),
    async () => ({ acquired: true, release: async () => void (released = true) }),
    silent,
    60_000,
    fc.clock,
  );
  await ticker.start();
  assert.equal(ticker.status.heldLock, true);
  assert.match(ticker.dashboardLine(), /Fusion: ETH ELEVATED · USDC —/);
  assert.ok(fc.hasTimer());
  await ticker.stop();
  assert.equal(released, true);
  assert.ok(!fc.hasTimer());
});

test("FusionTicker: kontensi lock → tick dilewati", async () => {
  let runs = 0;
  const ticker = new FusionTicker(
    async () => { runs++; return { chainId: 42161, now: NOW, dry: false, results: [] }; },
    async () => ({ acquired: false, release: async () => {} }),
    silent,
    60_000,
    fakeIntervalClock().clock,
  );
  await ticker.start();
  assert.equal(runs, 0);
  assert.match(ticker.dashboardLine(), /another instance/);
});

test("fusionIntervalMs: default 15m, override via FUSION_INTERVAL_MIN", () => {
  assert.equal(fusionIntervalMs({}), 15 * 60_000);
  assert.equal(fusionIntervalMs({ FUSION_INTERVAL_MIN: "5" }), 5 * 60_000);
});

test("lock keys fusion/settle/research semua berbeda", () => {
  assert.notEqual(FUSION_ADVISORY_LOCK_KEY, SETTLE_ADVISORY_LOCK_KEY);
  assert.notEqual(FUSION_ADVISORY_LOCK_KEY, 42161001);
  assert.notEqual(SETTLE_ADVISORY_LOCK_KEY, 42161001);
});

// --- fuse CLI --------------------------------------------------------------

test("fuse --json (mock run) → JSON valid per-asset", async () => {
  const chunks: string[] = [];
  const code = await fuseCommand(["--json"], {
    run: async () => ({
      chainId: 42161,
      now: NOW,
      dry: false,
      results: [
        { asset: "ETH", assessment: { regime: "ELEVATED", riskScore: 55, recommendedTriggerHF: 1.33, recommendedTargetHF: 1.63, drawdownEstimate: { h4: 0.1, h24: 0.2 } } as RiskAssessment, reasons: ["R-MACRO-SOON"], assessmentId: "id-1" },
      ],
    }),
    stdout: (s) => chunks.push(s),
    stderr: () => {},
  });
  assert.equal(code, 0);
  const out = JSON.parse(chunks.join(""));
  assert.equal(out.ok, true);
  assert.equal(out.assets[0].asset, "ETH");
  assert.equal(out.assets[0].regime, "ELEVATED");
  assert.equal(out.disclaimer, "not a trading signal");
});

test("fuse (box, no-color, mock) → per-asset regime + footer", async () => {
  const chunks: string[] = [];
  const code = await fuseCommand(["--no-color"], {
    run: async () => ({
      chainId: 42161,
      now: NOW,
      dry: true,
      results: [
        { asset: "ETH", assessment: { regime: "CALM", riskScore: 10, recommendedTriggerHF: 1.15, recommendedTargetHF: 1.45, drawdownEstimate: { h4: 0.05, h24: 0.1 }, explanation: "Regime for ETH: CALM." } as RiskAssessment, reasons: [] },
      ],
    }),
    stdout: (s) => chunks.push(s),
    stderr: () => {},
  });
  assert.equal(code, 0);
  const out = chunks.join("");
  assert.match(out, /RISK FUSION/);
  assert.match(out, /ETH/);
  assert.match(out, /CALM/);
  assert.match(out, /not a trading signal/);
  assert.match(out, /DRY/);
});

test("fuse --help → exit 0", async () => {
  let out = "";
  const code = await fuseCommand(["--help"], { stdout: (s) => void (out += s), stderr: () => {} });
  assert.equal(code, 0);
  assert.match(out, /tahansoe fuse/);
});

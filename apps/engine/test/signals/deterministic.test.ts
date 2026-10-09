import { test } from "node:test";
import assert from "node:assert/strict";
import type { Db } from "@tahansoe/db";
import type { Signal } from "@tahansoe/domain";
import { computeOracleSignals } from "../../src/signals/oracle.ts";
import { computeDepegSignals } from "../../src/signals/depeg.ts";
import { computeMacroSignals } from "../../src/signals/macro.ts";
import { decideRegime } from "../../src/fusion/regime.ts";
import { emitDeterministicSignals } from "../../src/signals/emit.ts";
import { dedupeSignals, getSignalDedupeKey } from "../../src/signals/dedupe.ts";
import { runFusion } from "../../src/fusion/run.ts";

const NOW = new Date("2026-10-09T12:00:00Z");

// ============================================================================
// 1. Unit tests: Depeg 1% boundary & Capped USDC
// ============================================================================

test("depeg: deviasi < 1% tidak memancarkan sinyal (boundary)", () => {
  const signals = computeDepegSignals({
    now: NOW,
    prices: [
      { asset: "USDC", priceUsd: 0.995 }, // dev 0.5% < 1%
      { asset: "USDT", priceUsd: 1.005 }, // dev 0.5% < 1%
    ],
  });
  assert.equal(signals.length, 0, "Deviasi di bawah 1% tidak boleh menghasilkan sinyal");
});

test("depeg: deviasi 1% memancarkan sinyal dengan severity 0.5", () => {
  const signals = computeDepegSignals({
    now: NOW,
    prices: [{ asset: "USDC", priceUsd: 0.99 }], // dev 1.0%
  });
  assert.equal(signals.length, 1);
  const sig = signals[0]!;
  assert.equal(sig.module, "ONCHAIN");
  assert.deepEqual(sig.paths, ["T4"]);
  assert.ok(Math.abs(sig.severity - 0.5) < 0.001);
  assert.equal(sig.confidence, 0.9);
});

test("depeg: deviasi linear naik hingga 1.0 pada 5%", () => {
  const signals3 = computeDepegSignals({
    now: NOW,
    prices: [{ asset: "USDC", priceUsd: 0.97 }], // dev 3.0%
  });
  assert.equal(signals3.length, 1);
  // 0.5 + (0.02 / 0.04) * 0.5 = 0.75
  assert.ok(Math.abs(signals3[0]!.severity - 0.75) < 0.001);

  const signals5 = computeDepegSignals({
    now: NOW,
    prices: [{ asset: "USDC", priceUsd: 0.95 }], // dev 5.0%
  });
  assert.equal(signals5.length, 1);
  assert.equal(signals5[0]!.severity, 1.0);
});

test("depeg: deviasi ke atas $1 diabaikan untuk capped USDC", () => {
  const signals = computeDepegSignals({
    now: NOW,
    prices: [
      { asset: "USDC", priceUsd: 1.02, isCapped: true }, // deviasi ke atas untuk capped USDC diabaikan
      { asset: "USDT", priceUsd: 1.02, isCapped: false }, // uncapped USDT deviasi 2% -> terpancar
    ],
  });
  assert.equal(signals.length, 1);
  assert.equal(signals[0]!.assets[0], "USDT");
  assert.ok(signals[0]!.severity >= 0.6);
});

// ============================================================================
// 2. Unit tests: Sequencer Uptime & Grace Period
// ============================================================================

test("sequencer: answer == 1 (down) memancarkan sinyal severity 1.0", () => {
  const signals = computeOracleSignals({
    now: NOW,
    sequencer: {
      answer: 1n,
      startedAt: new Date(NOW.getTime() - 15 * 60 * 1000), // 15m ago
    },
  });
  assert.equal(signals.length, 1);
  const sig = signals[0]!;
  assert.equal(sig.module, "ORACLE");
  assert.deepEqual(sig.paths, ["T10"]);
  assert.equal(sig.severity, 1.0);
  assert.equal(sig.confidence, 0.9);
});

test("sequencer: answer == 0 dalam masa tenggang < 1h memancarkan sinyal severity 0.7", () => {
  const signals = computeOracleSignals({
    now: NOW,
    sequencer: {
      answer: 0n,
      startedAt: new Date(NOW.getTime() - 30 * 60 * 1000), // pulih 30 menit lalu (< 1 jam)
    },
  });
  assert.equal(signals.length, 1);
  const sig = signals[0]!;
  assert.equal(sig.module, "ORACLE");
  assert.deepEqual(sig.paths, ["T10"]);
  assert.equal(sig.severity, 0.7);
});

test("sequencer: normal (answer == 0 dan startedAt >= 1h) tidak memancarkan sinyal", () => {
  const signals = computeOracleSignals({
    now: NOW,
    sequencer: {
      answer: 0n,
      startedAt: new Date(NOW.getTime() - 3 * 3600 * 1000), // pulih 3 jam lalu
    },
  });
  assert.equal(signals.length, 0);
});

// ============================================================================
// 3. Unit tests: Oracle Staleness & Deviation Steps
// ============================================================================

test("oracle staleness: feed lebih tua dari heartbeat * 1.5 memancarkan T8", () => {
  // ETH/USD heartbeat 3600s, threshold 5400s (1.5 jam)
  const freshSig = computeOracleSignals({
    now: NOW,
    feeds: [
      {
        feed: "ETH/USD",
        asset: "ETH",
        answer: 260000000000n,
        updatedAt: new Date(NOW.getTime() - 3600 * 1000), // 1 jam lalu (belum lewat 1.5 jam)
        heartbeatSec: 3600,
      },
    ],
  });
  assert.equal(freshSig.length, 0, "Feed masih di dalam batas heartbeat*1.5 tidak boleh memancarkan sinyal");

  const staleSig = computeOracleSignals({
    now: NOW,
    feeds: [
      {
        feed: "ETH/USD",
        asset: "ETH",
        answer: 260000000000n,
        updatedAt: new Date(NOW.getTime() - 3 * 3600 * 1000), // 3 jam lalu (lewat 1.5 jam)
        heartbeatSec: 3600,
      },
    ],
  });
  assert.equal(staleSig.length, 1);
  const sig = staleSig[0]!;
  assert.equal(sig.module, "ORACLE");
  assert.deepEqual(sig.paths, ["T8"]);
  assert.ok(sig.severity >= 0.6);
});

test("oracle deviation: deviasi bertingkat (>=0.5% -> 0.6, >=1% -> 0.8, >=2% -> 1.0)", () => {
  // Diff 0.3% (< 0.5%) -> tidak ada sinyal
  const noSig = computeOracleSignals({
    now: NOW,
    deviations: [
      { asset: "ETH", aavePrice: 200000000000n, chainlinkPrice: 200600000000n }, // diff 0.3%
    ],
  });
  assert.equal(noSig.length, 0);

  // Diff 0.6% (>= 0.5%) -> 0.6
  const sig06 = computeOracleSignals({
    now: NOW,
    deviations: [
      { asset: "ETH", aavePrice: 200000000000n, chainlinkPrice: 201200000000n }, // diff 0.6%
    ],
  });
  assert.equal(sig06.length, 1);
  assert.equal(sig06[0]!.severity, 0.6);

  // Diff 1.2% (>= 1.0%) -> 0.8
  const sig08 = computeOracleSignals({
    now: NOW,
    deviations: [
      { asset: "ETH", aavePrice: 200000000000n, chainlinkPrice: 202400000000n }, // diff 1.2%
    ],
  });
  assert.equal(sig08.length, 1);
  assert.equal(sig08[0]!.severity, 0.8);

  // Diff 2.5% (>= 2.0%) -> 1.0
  const sig10 = computeOracleSignals({
    now: NOW,
    deviations: [
      { asset: "ETH", aavePrice: 200000000000n, chainlinkPrice: 205000000000n }, // diff 2.5%
    ],
  });
  assert.equal(sig10.length, 1);
  assert.equal(sig10[0]!.severity, 1.0);
});

test("oracle deviation: deviasi ke atas $1 diabaikan untuk capped USDC", () => {
  const sig = computeOracleSignals({
    now: NOW,
    deviations: [
      // Aave 1.00 (capped), Chainlink 1.02 (market)
      { asset: "USDC", aavePrice: 100000000n, chainlinkPrice: 102000000n, isCappedUsdc: true },
    ],
  });
  assert.equal(sig.length, 0, "Deviasi ke atas pada capped feed USDC harus diabaikan");
});

// ============================================================================
// 4. Unit tests: Macro 48h Window & Severity Mapping
// ============================================================================

test("macro: event dalam jendela 48h memancarkan sinyal, > 48h dilewati", () => {
  const signals = computeMacroSignals({
    now: NOW,
    events: [
      { name: "FOMC Rate Decision", scheduledAt: new Date(NOW.getTime() + 12 * 3600 * 1000) }, // 12h
      { name: "US CPI Release", scheduledAt: new Date(NOW.getTime() + 36 * 3600 * 1000) }, // 36h
      { name: "US NFP Release", scheduledAt: new Date(NOW.getTime() + 60 * 3600 * 1000) }, // 60h (> 48h)
    ],
  });

  assert.equal(signals.length, 2, "Hanya 2 event dalam 48h yang dipancarkan");
  const fomc = signals.find((s) => s.evidence[0]?.title.includes("FOMC"));
  assert.ok(fomc);
  assert.equal(fomc.module, "MACRO");
  assert.deepEqual(fomc.paths, ["T1", "T2"]);
  assert.equal(fomc.severity, 0.6); // FOMC = 0.6
  assert.equal(fomc.confidence, 0.95);
  assert.equal(fomc.horizonHours, 12); // Pastikan horizonHours = 12

  const cpi = signals.find((s) => s.evidence[0]?.title.includes("CPI"));
  assert.ok(cpi);
  assert.equal(cpi.severity, 0.5); // CPI = 0.5
  assert.equal(cpi.horizonHours, 36);
});

// ============================================================================
// 5. Replay tests through decideRegime
// ============================================================================

test("replay: sequencer down -> STRESSED", () => {
  const signals = computeOracleSignals({
    now: NOW,
    sequencer: {
      answer: 1n,
      startedAt: new Date(NOW.getTime() - 10 * 60 * 1000),
    },
  });
  const res = decideRegime({ now: NOW, signals });
  assert.equal(res.regime, "STRESSED");
  assert.ok(res.reasons.includes("R-SEQUENCER-DOWN"));
});

test("replay: USDC 0.95 -> CRISIS", () => {
  const signals = computeDepegSignals({
    now: NOW,
    prices: [{ asset: "USDC", priceUsd: 0.95 }],
  });
  assert.equal(signals[0]!.severity, 1.0);
  const res = decideRegime({ now: NOW, signals });
  assert.equal(res.regime, "CRISIS");
  assert.ok(res.reasons.includes("R-DEPEG-CONFIRMED"));
});

test("replay: USDC 0.995 -> no signal, regime CALM", () => {
  const signals = computeDepegSignals({
    now: NOW,
    prices: [{ asset: "USDC", priceUsd: 0.995 }],
  });
  assert.equal(signals.length, 0);
  const res = decideRegime({ now: NOW, signals });
  assert.equal(res.regime, "CALM");
});

test("replay: FOMC in 12h -> ELEVATED", () => {
  const signals = computeMacroSignals({
    now: NOW,
    events: [
      { name: "FOMC Rate Decision", scheduledAt: new Date(NOW.getTime() + 12 * 3600 * 1000) },
    ],
  });
  assert.equal(signals.length, 1);
  assert.equal(signals[0]!.horizonHours, 12);
  const res = decideRegime({ now: NOW, signals });
  assert.equal(res.regime, "ELEVATED");
  assert.ok(res.reasons.includes("R-MACRO-SOON"));
});

test("replay: normal conditions -> no ORACLE/T4 signals, regime CALM", () => {
  const oracleSignals = computeOracleSignals({
    now: NOW,
    sequencer: { answer: 0n, startedAt: new Date(NOW.getTime() - 24 * 3600 * 1000) }, // up > 1h
    feeds: [
      { feed: "ETH/USD", asset: "ETH", answer: 260000000000n, updatedAt: NOW, heartbeatSec: 3600 },
      { feed: "USDC/USD", asset: "USDC", answer: 100000000n, updatedAt: NOW, heartbeatSec: 86400 },
    ],
    deviations: [
      { asset: "ETH", aavePrice: 260000000000n, chainlinkPrice: 260000000000n },
      { asset: "USDC", aavePrice: 100000000n, chainlinkPrice: 100000000n },
    ],
  });
  const depegSignals = computeDepegSignals({
    now: NOW,
    prices: [
      { asset: "USDC", priceUsd: 1.0 },
      { asset: "USDT", priceUsd: 1.0 },
    ],
  });

  assert.equal(oracleSignals.length, 0, "Kondisi normal tidak menghasilkan sinyal ORACLE");
  assert.equal(depegSignals.length, 0, "Kondisi normal tidak menghasilkan sinyal T4");

  const res = decideRegime({ now: NOW, signals: [...oracleSignals, ...depegSignals] });
  assert.equal(res.regime, "CALM");
});

// ============================================================================
// 6. Deduplication & Lifecycle Tests (emitDeterministicSignals & Fusion Read)
// ============================================================================

interface MockSignalRow {
  id: string;
  chainId: number;
  module: string;
  paths: any;
  assets: any;
  direction: string;
  severity: string;
  confidence: string;
  horizonHours: number;
  observedAt: Date;
  expiresAt: Date;
  evidence: any;
}

function createMockSignalDb(getCurrentNow: () => Date) {
  const table: MockSignalRow[] = [];
  const db = {
    select: () => ({
      from: () => ({
        where: () => {
          const now = getCurrentNow();
          return Promise.resolve(table.filter((r) => r.expiresAt.getTime() > now.getTime()));
        },
      }),
    }),
    update: () => ({
      set: (values: Partial<MockSignalRow>) => ({
        where: (expr: any) => {
          const ids = new Set<string>();
          const seen = new Set<any>();
          function extract(obj: any) {
            if (!obj || typeof obj !== "object" || seen.has(obj)) return;
            seen.add(obj);
            if (Array.isArray(obj)) {
              for (const item of obj) {
                if (typeof item === "string" && table.some((r) => r.id === item)) {
                  ids.add(item);
                } else {
                  extract(item);
                }
              }
            } else {
              for (const k of Object.keys(obj)) {
                try {
                  const val = (obj as any)[k];
                  if (typeof val === "string" && table.some((r) => r.id === val)) {
                    ids.add(val);
                  } else {
                    extract(val);
                  }
                } catch {
                  // ignore
                }
              }
            }
          }
          extract(expr);
          for (const r of table) {
            if (ids.has(r.id)) {
              if (values.expiresAt) r.expiresAt = values.expiresAt;
            }
          }
          return Promise.resolve();
        },
      }),
    }),
    insert: () => ({
      values: (rows: MockSignalRow[]) => {
        table.push(...rows);
        return Promise.resolve(rows);
      },
    }),
  } as unknown as Db;

  return { db, table };
}

test("dedupe: mempertahankan sinyal terbaru per key dan membiarkan sinyal non-deterministik", () => {
  const sig1: Signal = {
    id: "s1",
    module: "ONCHAIN",
    paths: ["T11"],
    assets: ["USDC"],
    direction: "DOWN",
    severity: 0.5,
    confidence: 0.8,
    horizonHours: 24,
    observedAt: new Date("2026-10-09T10:00:00Z"),
    expiresAt: new Date("2026-10-09T10:30:00Z"),
    dedupeKey: "ONCHAIN:T11:kink:USDC",
    evidence: [{ title: "Reserve USDC utilization at 91%", source: "aave_rates" }],
  };
  const sig2Newer: Signal = {
    id: "s2",
    module: "ONCHAIN",
    paths: ["T11"],
    assets: ["USDC"],
    direction: "DOWN",
    severity: 0.7,
    confidence: 0.8,
    horizonHours: 24,
    observedAt: new Date("2026-10-09T10:05:00Z"), // 5 menit lebih baru
    expiresAt: new Date("2026-10-09T10:35:00Z"),
    dedupeKey: "ONCHAIN:T11:kink:USDC",
    evidence: [{ title: "Reserve USDC utilization at 94%", source: "aave_rates" }],
  };
  const sigNews: Signal = {
    id: "s-news",
    module: "NEWS",
    assets: ["ETH"],
    direction: "DOWN",
    severity: 0.4,
    confidence: 0.7,
    horizonHours: 12,
    observedAt: new Date("2026-10-09T10:00:00Z"),
    expiresAt: new Date("2026-10-09T14:00:00Z"),
    evidence: [{ title: "Breaking crypto news", source: "news" }],
  };

  const deduped = dedupeSignals([sig1, sig2Newer, sigNews]);
  assert.equal(deduped.length, 2, "Hanya 2 sinyal tersisa setelah dedup");
  const usdcSig = deduped.find((s) => s.assets.includes("USDC"))!;
  assert.equal(usdcSig.id, "s2", "Sinyal yang lebih baru (s2) dipertahankan");
  assert.equal(usdcSig.severity, 0.7);
  assert.ok(deduped.some((s) => s.id === "s-news"), "Sinyal tanpa dedupeKey dipertahankan");
});

test("lifecycle: running emit 3 times in a row yields exactly one active signal per key", async () => {
  let currentTime = new Date("2026-10-09T12:00:00Z");
  const { db, table } = createMockSignalDb(() => currentTime);

  const mockReserve = {
    asset: "USDC",
    address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    supplyApr: 0.02,
    supplyApy: 0.02,
    borrowApr: 0.15,
    borrowApy: 0.16,
    utilization: 0.92, // > optimalUtil 0.80
    curve: { baseRate: 0, slope1: 0.04, slope2: 0.75, optimalUtil: 0.8 },
  };

  // Tick 1
  currentTime = new Date("2026-10-09T12:00:00Z");
  await emitDeterministicSignals({
    db,
    now: currentTime,
    rates: [mockReserve],
    skipOnchain: true,
    skipMacro: true,
  });

  // Tick 2 (1 menit kemudian)
  currentTime = new Date("2026-10-09T12:01:00Z");
  await emitDeterministicSignals({
    db,
    now: currentTime,
    rates: [mockReserve],
    skipOnchain: true,
    skipMacro: true,
  });

  // Tick 3 (2 menit kemudian)
  currentTime = new Date("2026-10-09T12:02:00Z");
  await emitDeterministicSignals({
    db,
    now: currentTime,
    rates: [mockReserve],
    skipOnchain: true,
    skipMacro: true,
  });

  // Periksa isi tabel
  assert.equal(table.length, 3, "Total 3 baris tercatat dalam histori");
  const activeRows = table.filter((r) => r.expiresAt.getTime() > currentTime.getTime());
  assert.equal(activeRows.length, 1, "Tepat satu sinyal aktif per key setelah 3 tick berurutan");
  assert.equal(activeRows[0]!.assets[0], "USDC");
  assert.equal(activeRows[0]!.evidence[0].dedupeKey, "ONCHAIN:T11:kink:USDC");
});

test("lifecycle: a condition that clears is no longer active after the next tick", async () => {
  let currentTime = new Date("2026-10-09T12:00:00Z");
  const { db, table } = createMockSignalDb(() => currentTime);

  const mockReservePastKink = {
    asset: "USDC",
    address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    supplyApr: 0.02,
    supplyApy: 0.02,
    borrowApr: 0.15,
    borrowApy: 0.16,
    utilization: 0.92, // > optimalUtil 0.80
    curve: { baseRate: 0, slope1: 0.04, slope2: 0.75, optimalUtil: 0.8 },
  };

  // Tick 1: kondisi kink aktif
  currentTime = new Date("2026-10-09T12:00:00Z");
  await emitDeterministicSignals({
    db,
    now: currentTime,
    rates: [mockReservePastKink],
    skipOnchain: true,
    skipMacro: true,
  });
  let activeRows = table.filter((r) => r.expiresAt.getTime() > currentTime.getTime());
  assert.equal(activeRows.length, 1, "Satu sinyal aktif pada tick 1");

  // Tick 2: kondisi pulih / hilang (utilization turun ke 50%)
  const mockReserveNormal = {
    ...mockReservePastKink,
    utilization: 0.50, // < optimalUtil 0.80 -> kondisi hilang
  };
  currentTime = new Date("2026-10-09T12:01:00Z");
  await emitDeterministicSignals({
    db,
    now: currentTime,
    rates: [mockReserveNormal],
    skipOnchain: true,
    skipMacro: true,
  });

  activeRows = table.filter((r) => r.expiresAt.getTime() > currentTime.getTime());
  assert.equal(activeRows.length, 0, "Kondisi yang hilang berhenti aktif dalam satu tick");
});

test("fusion: fusion score identical after 1 vs 5 ticks with the same conditions (property-style)", async () => {
  const signalUSDC1: Signal = {
    id: "sig-1",
    module: "ONCHAIN",
    paths: ["T11"],
    assets: ["USDC"],
    direction: "DOWN",
    severity: 0.6,
    confidence: 0.8,
    horizonHours: 24,
    observedAt: new Date("2026-10-09T12:00:00Z"),
    expiresAt: new Date("2026-10-09T12:30:00Z"),
    dedupeKey: "ONCHAIN:T11:kink:USDC",
    evidence: [{ title: "Reserve USDC utilization at 91%", source: "aave_rates", dedupeKey: "ONCHAIN:T11:kink:USDC" }],
  };

  const signalETH1: Signal = {
    id: "sig-2",
    module: "ORACLE",
    paths: ["T8"],
    assets: ["ETH"],
    direction: "DOWN",
    severity: 0.6,
    confidence: 0.9,
    horizonHours: 24,
    observedAt: new Date("2026-10-09T12:00:00Z"),
    expiresAt: new Date("2026-10-09T12:30:00Z"),
    dedupeKey: "ORACLE:T8:deviation:ETH",
    evidence: [{ title: "Oracle deviation for ETH", source: "aave_oracle", dedupeKey: "ORACLE:T8:deviation:ETH" }],
  };

  // Run 1 tick dengan sinyal dasar
  const run1 = await runFusion({
    assets: ["USDC", "ETH"],
    now: new Date("2026-10-09T12:00:00Z"),
    deps: {
      loadActiveSignals: async () => [signalUSDC1, signalETH1],
      loadPrior: async () => null,
      loadPriceSamples: async () => [],
      writeAssessment: async () => "id-1",
      emitSignals: async () => [],
    },
  });

  // Run 5 ticks yang menghasilkan 5 duplikasi sinyal di DB
  const signalsStacked: Signal[] = [];
  for (let tick = 1; tick <= 5; tick++) {
    signalsStacked.push({
      ...signalUSDC1,
      id: `sig-usdc-tick-${tick}`,
      observedAt: new Date(signalUSDC1.observedAt.getTime() + tick * 60_000),
      expiresAt: new Date(signalUSDC1.expiresAt.getTime() + tick * 60_000),
    });
    signalsStacked.push({
      ...signalETH1,
      id: `sig-eth-tick-${tick}`,
      observedAt: new Date(signalETH1.observedAt.getTime() + tick * 60_000),
      expiresAt: new Date(signalETH1.expiresAt.getTime() + tick * 60_000),
    });
  }

  const run5 = await runFusion({
    assets: ["USDC", "ETH"],
    now: new Date("2026-10-09T12:05:00Z"),
    deps: {
      loadActiveSignals: async () => signalsStacked,
      loadPrior: async () => null,
      loadPriceSamples: async () => [],
      writeAssessment: async () => "id-5",
      emitSignals: async () => [],
    },
  });

  const res1USDC = run1.results.find((r) => r.asset === "USDC")!;
  const res5USDC = run5.results.find((r) => r.asset === "USDC")!;
  assert.equal(res1USDC.assessment?.riskScore, res5USDC.assessment?.riskScore, "Skor USDC harus identik antara 1 vs 5 ticks");
  assert.equal(res1USDC.assessment?.regime, res5USDC.assessment?.regime, "Regime USDC harus identik");

  const res1ETH = run1.results.find((r) => r.asset === "ETH")!;
  const res5ETH = run5.results.find((r) => r.asset === "ETH")!;
  assert.equal(res1ETH.assessment?.riskScore, res5ETH.assessment?.riskScore, "Skor ETH harus identik antara 1 vs 5 ticks");
  assert.equal(res1ETH.assessment?.regime, res5ETH.assessment?.regime, "Regime ETH harus identik");

  assert.equal(run5.activeSignals?.length, 2, "activeSignals harus tepat 2 (didedup per key, bukan 10)");
});

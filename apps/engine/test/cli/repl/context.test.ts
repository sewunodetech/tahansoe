/**
 * Unit test untuk Deterministic Context Builder (spec m3-cli §3.5).
 *
 * Menguji:
 *  - Fresh vs Stale (> 6h) vs Empty DB loaders
 *  - Peringatan STALE / EMPTY dan arahan menjalankan /analyze
 *  - Deduplikasi sinyal aktif berdasarkan judul bukti
 *  - Perhitungan pasangan carry dari sampel suku bunga
 *  - Format baris status (status line) untuk berbagai kondisi data
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Signal } from "@tahansoe/domain";
import {
  buildReplContext,
  dedupeSignalsByEvidence,
  computeCarryPairs,
  formatContextForPrompt,
  formatStatusLine,
  formatStaleClosingLine,
  type ReplContextLoaders,
  type FetchedReport,
  type FetchedAssessment,
  type FetchedRateSample,
} from "../../../src/cli/repl/context.ts";

test("dedupeSignalsByEvidence: mendeduplikasi sinyal dengan judul bukti sama", () => {
  const t0 = new Date("2026-10-09T10:00:00Z");
  const t1 = new Date("2026-10-09T11:00:00Z");

  const signals: Signal[] = [
    {
      id: "sig-1",
      module: "ONCHAIN",
      assets: ["USDC"],
      direction: "DOWN",
      severity: 0.5,
      confidence: 0.7,
      horizonHours: 24,
      observedAt: t0,
      expiresAt: new Date(t0.getTime() + 86400000),
      evidence: [{ title: "USDC.e pool 92% utilized past kink", source: "Aave" }],
    },
    {
      id: "sig-2",
      module: "ONCHAIN",
      assets: ["USDC"],
      direction: "DOWN",
      severity: 0.8,
      confidence: 0.8,
      horizonHours: 24,
      observedAt: t1,
      expiresAt: new Date(t1.getTime() + 86400000),
      evidence: [{ title: "USDC.e pool 92% utilized past kink", source: "Aave" }], // duplicate title, newer
    },
    {
      id: "sig-3",
      module: "MACRO",
      assets: ["ETH"],
      direction: "VOLATILITY",
      severity: 0.6,
      confidence: 0.7,
      horizonHours: 48,
      observedAt: t1,
      expiresAt: new Date(t1.getTime() + 86400000),
      evidence: [{ title: "FOMC meeting scheduled in 2 days", source: "Fed" }], // distinct title
    },
  ];

  const deduped = dedupeSignalsByEvidence(signals);
  assert.equal(deduped.length, 2, "Harus menyisakan 2 sinyal unik");

  const usdcSig = deduped.find((s) => s.evidence[0]?.title.includes("USDC.e"));
  assert.ok(usdcSig);
  assert.equal(usdcSig.id, "sig-2", "Harus memilih sinyal yang lebih baru");
  assert.equal(usdcSig.severity, 0.8);
});

test("computeCarryPairs: menghitung net carry dan drift hari untuk pasangan representatif", () => {
  const rates: FetchedRateSample[] = [
    {
      asset: "WETH",
      supplyApy: 0.021, // 2.1%
      borrowApr: 0.035,
      borrowApy: 0.036,
      utilization: 0.65,
      optimalUtilization: 0.80,
      sampledAt: new Date("2026-10-09T14:00:00Z"),
    },
    {
      asset: "USDC",
      supplyApy: 0.045,
      borrowApr: 0.068, // 6.8%
      borrowApy: 0.070,
      utilization: 0.92,
      optimalUtilization: 0.90,
      sampledAt: new Date("2026-10-09T14:00:00Z"),
    },
  ];

  const pairs = computeCarryPairs(rates);
  const wethUsdc = pairs.find((p) => p.collateral === "WETH" && p.debt === "USDC");
  assert.ok(wethUsdc);
  // Net carry = 0.021 - 0.068 = -0.047 (-4.7%)
  assert.ok(Math.abs(wethUsdc.netCarryPct - -4.7) < 0.01);
  assert.ok(wethUsdc.daysToDrift !== null && wethUsdc.daysToDrift > 0);
});

test("buildReplContext: Empty DB → hasData false, isStale true, prompt memuat peringatan /analyze", async () => {
  const emptyLoaders: ReplContextLoaders = {
    loadLatestReports: async () => ({ latest: null, last24h: [] }),
    loadAssessments: async () => [],
    loadActiveSignals: async () => [],
    loadRateSamples: async () => [],
    loadPriceSamples: async () => [],
    loadMacroEvents: async () => [],
  };

  const now = new Date("2026-10-09T14:00:00Z");
  const ctx = await buildReplContext({ now, loaders: emptyLoaders });

  assert.equal(ctx.hasData, false);
  assert.equal(ctx.isStale, true);

  const promptText = formatContextForPrompt(ctx, now);
  assert.match(promptText, /STATUS: EMPTY DATABASE/);
  assert.match(promptText, /run `\/analyze`/);

  const statusLine = formatStatusLine(ctx, { color: false, width: 80 });
  assert.match(statusLine, /no research yet/);
});

test("buildReplContext: Fresh DB (< 6h) → hasData true, isStale false, prompt memuat bagian lengkap", async () => {
  const now = new Date("2026-10-09T14:00:00Z");
  const oneHourAgo = new Date("2026-10-09T13:00:00Z");

  const freshLoaders: ReplContextLoaders = {
    loadLatestReports: async (): Promise<{ latest: FetchedReport; last24h: FetchedReport[] }> => ({
      latest: {
        id: "rep-fresh-1",
        createdAt: oneHourAgo,
        report: {
          assets: ["ETH", "USDC"],
          proposedRegime: "ELEVATED",
          direction: "DOWN",
          confidence: 0.52,
          horizonHours: 24,
          paths: [{ path: "T11", severity: 0.7, rationale: "Borrow rate spike" }],
          keyDevelopments: [{ summary: "USDC rate past kink", evidence: [{ source: "ONCHAIN", summary: "92% util" }] }],
          hawkCase: "High borrow rates will erode buffer",
          doveCase: "Collateral price stable",
        },
      },
      last24h: [],
    }),
    loadAssessments: async (): Promise<FetchedAssessment[]> => [
      {
        asset: "USDC",
        regime: "ELEVATED",
        riskScore: 55,
        recommendedTriggerHf: 1.25,
        recommendedTargetHf: 1.55,
        reasons: ["T11-RATE-SPIKE"],
        explanation: "Rate stress on USDC",
        validUntil: new Date("2026-10-09T16:00:00Z"),
        createdAt: oneHourAgo,
      },
    ],
    loadActiveSignals: async () => [],
    loadRateSamples: async () => [],
    loadPriceSamples: async () => [],
    loadMacroEvents: async () => [],
  };

  const ctx = await buildReplContext({ now, loaders: freshLoaders });
  assert.equal(ctx.hasData, true);
  assert.equal(ctx.isStale, false);

  const promptText = formatContextForPrompt(ctx, now);
  assert.match(promptText, /STATUS: FRESH DATA/);
  assert.match(promptText, /LATEST RESEARCH REPORT/);
  assert.match(promptText, /ELEVATED/);
  assert.match(promptText, /USDC/);

  const statusLine = formatStatusLine(ctx, { color: false, width: 80 });
  assert.match(statusLine, /USDC ELEVATED/);
  assert.doesNotMatch(statusLine, /stale/);
});

test("buildReplContext: Stale DB (> 6h) → isStale true, prompt memuat instruksi /analyze", async () => {
  const now = new Date("2026-10-09T22:00:00Z");
  const sevenHoursAgo = new Date("2026-10-09T14:00:00Z"); // 8 jam lalu

  const staleLoaders: ReplContextLoaders = {
    loadLatestReports: async (): Promise<{ latest: FetchedReport; last24h: FetchedReport[] }> => ({
      latest: {
        id: "rep-stale-1",
        createdAt: sevenHoursAgo,
        report: {
          assets: ["ETH"],
          proposedRegime: "CALM",
          direction: "VOLATILITY",
          confidence: 0.40,
          horizonHours: 24,
          paths: [],
          keyDevelopments: [],
          hawkCase: "Low stress",
          doveCase: "Quiet markets",
        },
      },
      last24h: [],
    }),
    loadAssessments: async (): Promise<FetchedAssessment[]> => [
      {
        asset: "ETH",
        regime: "CALM",
        riskScore: 15,
        recommendedTriggerHf: 1.15,
        recommendedTargetHf: 1.45,
        reasons: [],
        explanation: "Quiet conditions",
        validUntil: sevenHoursAgo,
        createdAt: sevenHoursAgo,
      },
    ],
    loadActiveSignals: async () => [],
    loadRateSamples: async () => [],
    loadPriceSamples: async () => [],
    loadMacroEvents: async () => [],
  };

  const ctx = await buildReplContext({ now, loaders: staleLoaders });
  assert.equal(ctx.hasData, true);
  assert.equal(ctx.isStale, true);
  assert.ok(ctx.staleReason?.includes("8.0h old"));

  const promptText = formatContextForPrompt(ctx, now);
  assert.match(promptText, /STATUS: STALE DATA/);
  assert.match(promptText, /run \/analyze/);

  const statusLine = formatStatusLine(ctx, { color: false, width: 80 });
  assert.match(statusLine, /\(stale\)/);
});

test("buildReplContext: Mixed fresh/stale fixtures → computes per-source freshness, sets isStale, formats STALE markers and closing line", async () => {
  const now = new Date("2026-10-09T14:00:00Z");
  const freshTime = new Date("2026-10-09T13:26:00Z"); // 34 menit lalu (fresh)
  const staleTime = new Date("2026-10-09T04:05:00Z"); // 9 jam 55 menit lalu (~10h old, STALE)

  const mixedLoaders: ReplContextLoaders = {
    loadLatestReports: async (): Promise<{ latest: FetchedReport; last24h: FetchedReport[] }> => ({
      latest: {
        id: "rep-mixed-1",
        createdAt: freshTime,
        report: {
          assets: ["ETH", "USDC"],
          proposedRegime: "ELEVATED",
          direction: "DOWN",
          confidence: 0.55,
          horizonHours: 24,
          paths: [],
          keyDevelopments: [],
          hawkCase: "",
          doveCase: "",
        },
      },
      last24h: [],
    }),
    loadAssessments: async (): Promise<FetchedAssessment[]> => [
      {
        asset: "USDC",
        regime: "ELEVATED",
        riskScore: 60,
        recommendedTriggerHf: 1.25,
        recommendedTargetHf: 1.55,
        reasons: ["T11-RATE-SPIKE"],
        explanation: "Borrow rate spike",
        validUntil: new Date("2026-10-09T16:00:00Z"),
        createdAt: freshTime,
      },
    ],
    loadActiveSignals: async () => [],
    loadRateSamples: async (): Promise<FetchedRateSample[]> => [
      {
        asset: "USDC",
        supplyApy: 0.045,
        borrowApr: 0.068,
        borrowApy: 0.070,
        utilization: 0.92,
        optimalUtilization: 0.90,
        sampledAt: freshTime,
      },
    ],
    loadPriceSamples: async () => [
      {
        asset: "ETH",
        latestPrice: 2450.5,
        sampledAt: staleTime,
        min24h: 2400,
        max24h: 2500,
        change24hPct: 1.2,
      },
    ],
    loadMacroEvents: async () => [],
  };

  const ctx = await buildReplContext({ now, loaders: mixedLoaders });

  assert.equal(ctx.hasData, true);
  assert.equal(ctx.isStale, true, "Konteks harus dianggap stale jika ada sumber stale");

  // Per-source freshness check
  assert.equal(ctx.sourceFreshness.report.isStale, false, "Report harus fresh");
  assert.equal(ctx.sourceFreshness.assessments.isStale, false, "Assessments harus fresh");
  assert.equal(ctx.sourceFreshness.rate_samples.isStale, false, "Rate samples harus fresh");
  assert.equal(ctx.sourceFreshness.price_samples.isStale, true, "Price samples harus stale");
  assert.equal(Math.round(ctx.sourceFreshness.price_samples.ageHours ?? 0), 10);

  // Stale sources list
  assert.equal(ctx.staleSources.length, 1);
  assert.equal(ctx.staleSources[0]?.source, "price_samples");

  // Closing line
  const closingLine = formatStaleClosingLine(ctx.staleSources);
  assert.match(closingLine, /Price samples are 10h old/);
  assert.match(closingLine, /schedule run --with-price/);

  // Prompt formatting
  const promptText = formatContextForPrompt(ctx, now);
  assert.match(promptText, /STATUS: STALE DATA DETECTED/);
  assert.match(promptText, /Price samples: STALE since 04:05 UTC/);
  assert.match(promptText, /AAVE V3 RATES & CARRY MONITOR \(ARBITRUM\) \[STATUS: FRESH/);
  assert.match(promptText, /PRICE SAMPLES SUMMARY \[STATUS: STALE since 04:05 UTC/);
  assert.match(promptText, /\[price_samples 04:05 - STALE/);
  assert.match(promptText, /\[rate_samples 13:26\]/);
});

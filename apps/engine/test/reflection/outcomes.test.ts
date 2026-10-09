/**
 * Unit test offline untuk computeOutcome (spec §3.5, ADR 0005).
 *
 * Menguji evaluasi outcome aktual dari deret harga AaveOracle:
 *  - Crash ≥ 10% memicu outcome buruk T1
 *  - Pergerakan tenang (< 10%) tidak memicu outcome buruk
 *  - Kurang dari 2 sampel harga menghasilkan status insufficient_data
 *  - Depeg stablecoin USDC memicu outcome buruk T4
 *  - Sinyal eksternal Sequencer Down memicu outcome buruk T10
 *  - Coverage Guard: late start, early end, internal gap, full coverage passes
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeOutcome,
  type RawPriceSample,
  SAMPLE_EDGE_TOLERANCE_MIN,
  MAX_SAMPLE_GAP_MIN,
} from "../../src/reflection/outcomes.ts";

function makeCoverageSamples(
  asset: string,
  start: Date,
  end: Date,
  stepMin: number = 30,
  priceFn: (t: Date) => number = () => 2500,
): RawPriceSample[] {
  const samples: RawPriceSample[] = [];
  let curr = new Date(start);
  while (curr.getTime() <= end.getTime()) {
    samples.push({
      asset,
      source: "aave_oracle",
      priceUsd: priceFn(curr).toFixed(2),
      sampledAt: new Date(curr),
    });
    curr = new Date(curr.getTime() + stepMin * 60 * 1000);
  }
  return samples;
}

describe("computeOutcome", () => {
  const t0 = new Date("2026-10-09T00:00:00Z");
  const tEnd = new Date("2026-10-09T24:00:00Z");

  it("konstanta coverage guard terdefinisi sesuai spek", () => {
    assert.equal(SAMPLE_EDGE_TOLERANCE_MIN, 30);
    assert.equal(MAX_SAMPLE_GAP_MIN, 60);
  });

  it("mendeteksi skenario crash 12% sebagai outcome buruk T1 dengan titik terburuk terisi", async () => {
    // 2500 -> 2600 (puncak di 4h) -> 2288 (trough di 10h, -12% dari 2600) -> 2350
    const priceSamples = makeCoverageSamples("WETH", t0, tEnd, 30, (t) => {
      const elapsedHours = (t.getTime() - t0.getTime()) / (3600 * 1000);
      if (elapsedHours <= 4) {
        return 2500 + (100 * elapsedHours) / 4; // 2500 -> 2600
      }
      if (elapsedHours <= 10) {
        return 2600 - (312 * (elapsedHours - 4)) / 6; // 2600 -> 2288
      }
      return 2288 + (62 * (elapsedHours - 10)) / 14; // 2288 -> 2350
    });

    const res = await computeOutcome({
      asset: "ETH",
      chainId: 42161,
      windowStart: t0,
      windowEnd: tEnd,
      priceSamples,
    });

    assert.equal(res.insufficientData, false);
    assert.equal(res.hadBadOutcome, true);
    assert.ok(res.triggeredPaths.includes("T1"));
    assert.equal(res.maxDrawdownPct.toFixed(2), "0.12");
    assert.ok(res.worstOutcomeAt);
    assert.equal(
      res.worstOutcomeAt.toISOString(),
      new Date(t0.getTime() + 10 * 3600 * 1000).toISOString(),
    );
  });

  it("pergerakan pasar tenang (drawdown 2%) tidak memicu outcome buruk", async () => {
    const priceSamples = makeCoverageSamples("WETH", t0, tEnd, 30, (t) => {
      const elapsedHours = (t.getTime() - t0.getTime()) / (3600 * 1000);
      return 2500 + Math.sin(elapsedHours) * 25; // 2475..2525 (~1% max drawdown)
    });

    const res = await computeOutcome({
      asset: "WETH",
      chainId: 42161,
      windowStart: t0,
      windowEnd: tEnd,
      priceSamples,
    });

    assert.equal(res.insufficientData, false);
    assert.equal(res.hadBadOutcome, false);
    assert.equal(res.triggeredPaths.length, 0);
    assert.ok(res.maxDrawdownPct < 0.1);
  });

  it("data harga kurang dari 2 sampel menghasilkan status insufficient_data dan tanpa label palsu", async () => {
    const priceSamples: RawPriceSample[] = [
      {
        asset: "WETH",
        source: "aave_oracle",
        priceUsd: "2500.00",
        sampledAt: new Date(t0.getTime() + 10 * 60 * 1000),
      },
    ];

    const res = await computeOutcome({
      asset: "WETH",
      chainId: 42161,
      windowStart: t0,
      windowEnd: tEnd,
      priceSamples,
    });

    assert.equal(res.insufficientData, true);
    assert.equal(res.hadBadOutcome, false);
    assert.equal(res.triggeredPaths.length, 0);
    assert.ok(res.insufficientReason?.includes("tidak mencukupi"));
  });

  it("mendeteksi depeg USDC < 0.99 sebagai outcome buruk T4", async () => {
    const ethSamples = makeCoverageSamples("WETH", t0, tEnd, 30, () => 2500);
    const usdcSamples: RawPriceSample[] = [
      {
        asset: "USDC",
        source: "aave_oracle",
        priceUsd: "0.9750", // depeg signifikan < 0.99
        sampledAt: new Date(t0.getTime() + 2 * 3600 * 1000),
      },
    ];

    const res = await computeOutcome({
      asset: "WETH",
      chainId: 42161,
      windowStart: t0,
      windowEnd: tEnd,
      priceSamples: [...ethSamples, ...usdcSamples],
    });

    assert.equal(res.insufficientData, false);
    assert.equal(res.hadBadOutcome, true);
    assert.ok(res.triggeredPaths.includes("T4"));
    assert.equal(res.minStablecoinPeg, 0.975);
  });

  it("mendeteksi sinyal ONCHAIN Sequencer DOWN sebagai outcome buruk T10", async () => {
    const ethSamples = makeCoverageSamples("WETH", t0, tEnd, 30, () => 2500);
    const signals = [
      {
        module: "ONCHAIN",
        paths: ["T10" as const],
        severity: "1.0",
        observedAt: new Date(t0.getTime() + 2 * 3600 * 1000),
      },
    ];

    const res = await computeOutcome({
      asset: "WETH",
      chainId: 42161,
      windowStart: t0,
      windowEnd: tEnd,
      priceSamples: ethSamples,
      signals,
    });

    assert.equal(res.insufficientData, false);
    assert.equal(res.hadBadOutcome, true);
    assert.ok(res.triggeredPaths.includes("T10"));
  });

  // --- Tests Coverage Guard (ADR 0005) ---

  it("coverage guard: late start ditandai sebagai insufficientData", async () => {
    // Sampel pertama mulai 45 menit setelah windowStart (toleransi 30 menit)
    const startLate = new Date(t0.getTime() + 45 * 60 * 1000);
    const priceSamples = makeCoverageSamples("WETH", startLate, tEnd, 30);

    const res = await computeOutcome({
      asset: "WETH",
      chainId: 42161,
      windowStart: t0,
      windowEnd: tEnd,
      priceSamples,
    });

    assert.equal(res.insufficientData, true);
    assert.equal(res.hadBadOutcome, false);
    assert.ok(res.insufficientReason?.includes("late start"));
  });

  it("coverage guard: early end ditandai sebagai insufficientData", async () => {
    // Sampel terakhir berhenti 50 menit sebelum windowEnd (toleransi 30 menit)
    const endEarly = new Date(tEnd.getTime() - 50 * 60 * 1000);
    const priceSamples = makeCoverageSamples("WETH", t0, endEarly, 30);

    const res = await computeOutcome({
      asset: "WETH",
      chainId: 42161,
      windowStart: t0,
      windowEnd: tEnd,
      priceSamples,
    });

    assert.equal(res.insufficientData, true);
    assert.equal(res.hadBadOutcome, false);
    assert.ok(res.insufficientReason?.includes("early end"));
  });

  it("coverage guard: internal gap ditandai sebagai insufficientData", async () => {
    // Jeda antara 2h dan 3.5h adalah 90 menit (maks 60 menit)
    const part1 = makeCoverageSamples(
      "WETH",
      t0,
      new Date(t0.getTime() + 2 * 3600 * 1000),
      30,
    );
    const part2 = makeCoverageSamples(
      "WETH",
      new Date(t0.getTime() + 3.5 * 3600 * 1000),
      tEnd,
      30,
    );

    const res = await computeOutcome({
      asset: "WETH",
      chainId: 42161,
      windowStart: t0,
      windowEnd: tEnd,
      priceSamples: [...part1, ...part2],
    });

    assert.equal(res.insufficientData, true);
    assert.equal(res.hadBadOutcome, false);
    assert.ok(res.insufficientReason?.includes("internal gap"));
  });

  it("coverage guard: full coverage passes", async () => {
    // Mulai 15 menit setelah t0 (< 30 min), interval 30 min (< 60 min), selesai 15 menit sebelum tEnd (< 30 min)
    const startWithinTol = new Date(t0.getTime() + 15 * 60 * 1000);
    const endWithinTol = new Date(tEnd.getTime() - 15 * 60 * 1000);
    const priceSamples = makeCoverageSamples("WETH", startWithinTol, endWithinTol, 30);

    const res = await computeOutcome({
      asset: "WETH",
      chainId: 42161,
      windowStart: t0,
      windowEnd: tEnd,
      priceSamples,
    });

    assert.equal(res.insufficientData, false);
    assert.equal(res.hadBadOutcome, false);
  });
});


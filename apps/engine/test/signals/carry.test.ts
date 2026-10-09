import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeCarrySignals,
  type ReserveRateSample,
} from "../../src/signals/carry.ts";

function createTestReserves(): ReserveRateSample[] {
  return [
    {
      asset: "USDC",
      address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      supplyApr: 0.04,
      supplyApy: 0.041,
      borrowApr: 0.06,
      borrowApy: 0.062,
      utilization: 0.85,
      curve: { baseRate: 0, slope1: 0.04, slope2: 0.60, optimalUtil: 0.90 },
    },
    {
      asset: "WETH",
      address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
      supplyApr: 0.02,
      supplyApy: 0.02,
      borrowApr: 0.028,
      borrowApy: 0.028,
      utilization: 0.70,
      curve: { baseRate: 0, slope1: 0.03, slope2: 0.80, optimalUtil: 0.80 },
    },
    {
      asset: "wstETH",
      address: "0x5979D7b546E38E414F7E9822514be443A4800529",
      supplyApr: 0.005,
      supplyApy: 0.005,
      borrowApr: 0.015,
      borrowApy: 0.015,
      utilization: 0.50,
      curve: { baseRate: 0, slope1: 0.03, slope2: 0.80, optimalUtil: 0.80 },
    },
    {
      asset: "USDT",
      address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
      supplyApr: 0.035,
      supplyApy: 0.036,
      borrowApr: 0.05,
      borrowApy: 0.051,
      utilization: 0.75,
      curve: { baseRate: 0, slope1: 0.04, slope2: 0.75, optimalUtil: 0.90 },
    },
    {
      asset: "WBTC",
      address: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f",
      supplyApr: 0.005,
      supplyApy: 0.005,
      borrowApr: 0.015,
      borrowApy: 0.015,
      utilization: 0.40,
      curve: { baseRate: 0, slope1: 0.02, slope2: 0.80, optimalUtil: 0.80 },
    },
  ];
}

test("computeCarrySignals: emits negative carry for representative pairs", () => {
  const reserves = createTestReserves();
  const signals = computeCarrySignals({
    latestReserves: reserves,
    now: new Date("2026-10-09T12:00:00Z"),
  });

  // WETH -> USDC carry: 0.02 - 0.06 = -0.04 (negative)
  const wethUsdcSig = signals.find(
    (s) =>
      s.evidence?.[0]?.source === "aave_rates" &&
      s.evidence[0].title.includes("Negative carry on WETH->USDC"),
  );

  assert.ok(wethUsdcSig, "Harus menghasilkan sinyal negative carry WETH->USDC");
  assert.equal(wethUsdcSig.module, "ONCHAIN");
  assert.deepEqual(wethUsdcSig.paths, ["T11"]);
  assert.equal(wethUsdcSig.confidence, 0.9);
  assert.ok(wethUsdcSig.assets.includes("WETH"));
  assert.ok(wethUsdcSig.assets.includes("USDC"));
  assert.ok(wethUsdcSig.assets.includes("ETH")); // alias ETH
});

test("computeCarrySignals: emits kink proximity when util >= optimalUtil", () => {
  const reserves = createTestReserves();
  // Set USDC util melewati kink 0.90 -> 0.95
  const usdc = reserves.find((r) => r.asset === "USDC")!;
  usdc.utilization = 0.95;

  const signals = computeCarrySignals({
    latestReserves: reserves,
    now: new Date("2026-10-09T12:00:00Z"),
  });

  const kinkSig = signals.find(
    (s) =>
      s.evidence?.[0]?.source === "aave_rates" &&
      s.evidence[0].title.includes("Reserve USDC utilization"),
  );

  assert.ok(kinkSig, "Harus memancarkan kink proximity signal untuk USDC");
  assert.equal(kinkSig.module, "ONCHAIN");
  assert.deepEqual(kinkSig.paths, ["T11"]);
  // (0.95 - 0.90) / 0.10 = 0.50 severity
  assert.ok(Math.abs(kinkSig.severity - 0.5) < 0.01);
});

test("computeCarrySignals: includes T7 when utilization >= 0.98", () => {
  const reserves = createTestReserves();
  const usdc = reserves.find((r) => r.asset === "USDC")!;
  usdc.utilization = 0.99;

  const signals = computeCarrySignals({
    latestReserves: reserves,
    now: new Date("2026-10-09T12:00:00Z"),
  });

  const kinkSig = signals.find(
    (s) =>
      s.evidence?.[0]?.source === "aave_rates" &&
      s.evidence[0].title.includes("Reserve USDC utilization"),
  );

  assert.ok(kinkSig);
  assert.deepEqual(kinkSig.paths, ["T11", "T7"]);
});

test("computeCarrySignals: emits rate spike on >= 2x or stablecoin > 20%", () => {
  const reserves = createTestReserves();
  const usdc = reserves.find((r) => r.asset === "USDC")!;
  usdc.borrowApr = 0.25; // 25% APR (> 20%)

  const rates24h = new Map<string, number>();
  rates24h.set("USDC", 0.05);

  const signals = computeCarrySignals({
    latestReserves: reserves,
    rates24hAgo: rates24h,
    now: new Date("2026-10-09T12:00:00Z"),
  });

  const spikeSig = signals.find(
    (s) =>
      s.evidence?.[0]?.source === "aave_rates" &&
      s.evidence[0].title.includes("Reserve USDC borrow APR spiked"),
  );

  assert.ok(spikeSig, "Harus memancarkan rate spike signal untuk USDC");
  assert.ok(spikeSig.severity >= 0.6);
  assert.equal(spikeSig.confidence, 0.9);
});

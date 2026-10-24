import { test } from "node:test";
import assert from "node:assert/strict";
import type { Address } from "@tahansoe/domain";
import { positionStatus, type GuardianContext } from "./status";
import { priceForHealthFactor } from "./price-at-hf";
import type { AssetAmount, PositionDetail } from "./types";

const USER = "0x00000000000000000000000000000000000000aa" as Address;
const USDC = "0x00000000000000000000000000000000000000c1" as Address;
const DAI = "0x00000000000000000000000000000000000000d1" as Address;
const WETH = "0x00000000000000000000000000000000000000e1" as Address;

const asset = (symbol: string, address: Address, decimals: number, units: number, valueUsd: number): AssetAmount => ({
  symbol,
  address,
  decimals,
  amount: BigInt(Math.round(units * 10 ** Math.min(decimals, 6))) * 10n ** BigInt(Math.max(decimals - 6, 0)),
  valueUsd,
});

function position(over: Partial<PositionDetail> = {}): PositionDetail {
  return {
    id: "aave-v3:421614:pool:user",
    protocol: "aave-v3",
    chainId: 421614,
    user: USER,
    healthFactor: 1_500_000_000_000_000_000n,
    liquidationThreshold: 8250n,
    collateralValueUsd: 10_000n * 10n ** 8n,
    debtValueUsd: 5_000n * 10n ** 8n,
    oracleSource: USER,
    collateral: [asset("WETH", WETH, 18, 4, 10_000)],
    debt: [asset("USDC", USDC, 6, 5_000, 5_000)],
    liquidationThresholdBps: 8250,
    priceAtHf: () => null,
    monitorOnly: false,
    ...over,
  };
}

const guardian = (policy: GuardianContext["policy"], chainId = 421614): GuardianContext => ({ chainId, policy });
const enabledUsdc = { enabled: true, debtAsset: USDC, triggerHf: 1.3, targetHf: 1.6 };

test("enabled policy on a borrowed asset → Protected with trigger and target", () => {
  const s = positionStatus(position(), guardian(enabledUsdc));
  assert.deepEqual(s, { kind: "protected", triggerHf: 1.3, targetHf: 1.6, debtSymbol: "USDC", note: null });
});

test("debt asset match ignores address case", () => {
  const s = positionStatus(position(), guardian({ ...enabledUsdc, debtAsset: USDC.toUpperCase().replace("0X", "0x") as Address }));
  assert.equal(s.kind, "protected");
});

test("several debt assets → Protected with an honest note", () => {
  const s = positionStatus(position({ debt: [asset("USDC", USDC, 6, 3_000, 3_000), asset("DAI", DAI, 18, 2_000, 2_000)] }), guardian(enabledUsdc));
  assert.equal(s.kind, "protected");
  assert.equal(s.kind === "protected" && s.note, "Only USDC debt is protected");
});

test("no policy → Not protected", () => {
  assert.deepEqual(positionStatus(position(), guardian(null)), { kind: "not-protected", note: null });
});

test("disabled policy → Not protected", () => {
  assert.equal(positionStatus(position(), guardian({ ...enabledUsdc, enabled: false })).kind, "not-protected");
});

test("policy on a debt asset the position does not borrow → Not protected with a note", () => {
  const s = positionStatus(position({ debt: [asset("DAI", DAI, 18, 5_000, 5_000)] }), guardian(enabledUsdc));
  assert.equal(s.kind, "not-protected");
  assert.ok(s.kind === "not-protected" && s.note);
});

test("chain without a Guardian → Monitor only", () => {
  assert.equal(positionStatus(position({ chainId: 42161 }), null).kind, "monitor-only");
  assert.equal(positionStatus(position({ chainId: 42161 }), guardian(enabledUsdc, 421614)).kind, "monitor-only");
});

test("Morpho → Monitor only even with a policy", () => {
  const s = positionStatus(position({ protocol: "morpho-blue", monitorOnly: true }), guardian(enabledUsdc));
  assert.equal(s.kind, "monitor-only");
});

test("priceForHealthFactor: single collateral scales linearly with HF", () => {
  // 4 ETH at $2,500, $5,000 debt, LT 0.825 → HF 1.65. HF 1.0 at $1,515.15; HF 1.3 at $1,969.70.
  const weth = asset("WETH", WETH, 18, 4, 10_000);
  const input = { collateral: [weth], debt: [asset("USDC", USDC, 6, 5_000, 5_000)], lt: 0.825, mainCollateral: weth };
  assert.ok(Math.abs(priceForHealthFactor({ ...input, hf: 1 })! - 1515.1515) < 0.01);
  assert.ok(Math.abs(priceForHealthFactor({ ...input, hf: 1.3 })! - 1969.697) < 0.01);
});

test("priceForHealthFactor: other collateral is held constant", () => {
  const weth = asset("WETH", WETH, 18, 4, 10_000);
  const dai = asset("DAI", DAI, 18, 2_000, 2_000);
  const input = { collateral: [weth, dai], debt: [asset("USDC", USDC, 6, 5_000, 5_000)], lt: 0.8, mainCollateral: weth };
  // main needed = 1.0 × 5000 / 0.8 − 2000 = 4250 → $1,062.50 per ETH.
  assert.ok(Math.abs(priceForHealthFactor({ ...input, hf: 1 })! - 1062.5) < 0.01);
  // DAI alone keeps HF at 0.32, so no ETH price takes the position down to HF 0.3.
  assert.equal(priceForHealthFactor({ ...input, hf: 0.3 }), null);
});

test("priceForHealthFactor: no debt → null", () => {
  const weth = asset("WETH", WETH, 18, 4, 10_000);
  assert.equal(priceForHealthFactor({ collateral: [weth], debt: [], lt: 0.8, mainCollateral: weth, hf: 1 }), null);
});

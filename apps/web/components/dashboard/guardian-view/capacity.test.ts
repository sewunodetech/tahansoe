import { test } from "node:test";
import assert from "node:assert/strict";
import type { Address } from "@tahansoe/domain";
import { computeCapacity, type CapacityInput } from "./capacity";
import { formatAge, heartbeatState, STALE_AFTER_MS } from "../../../lib/positions/heartbeat";

const WETH = "0x00000000000000000000000000000000000000e1" as Address;
const VAULT = "0x00000000000000000000000000000000000000f1" as Address;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const usdc = (n: number) => BigInt(n) * 1_000_000n;

const base: CapacityInput = {
  policy: { enabled: true, maxRepayPerAction: usdc(1_000) },
  token: { balance: usdc(800), allowance: usdc(5_000), decimals: 6, priceBase: 100_000_000n },
  layer2: null,
  layer3: null,
};

test("L1 is the smallest of balance, allowance and cap", () => {
  const c = computeCapacity(base);
  assert.deepEqual(c.l1, { on: true, usd: 800, label: "$800" });
  const lowAllowance = computeCapacity({ ...base, token: { ...base.token!, allowance: usdc(300) } });
  assert.deepEqual(lowAllowance.l1, { on: true, usd: 300, label: "$300" });
});

test("everything is off without an enabled policy", () => {
  const c = computeCapacity({ ...base, policy: { enabled: false, maxRepayPerAction: usdc(1_000) } });
  assert.deepEqual([c.l1.on, c.l2.on, c.l3.on, c.totalUsd], [false, false, false, 0]);
});

test("L2 off when no source is set, on with its per-action cap otherwise", () => {
  assert.equal(computeCapacity({ ...base, layer2: { source: ZERO, maxAssetsPerAction: usdc(1) } }).l2.on, false);
  const c = computeCapacity({ ...base, layer2: { source: VAULT, maxAssetsPerAction: usdc(2_500) } });
  assert.deepEqual(c.l2, { on: true, usd: 2_500, label: "up to $2,500" });
  assert.equal(c.totalUsd, 3_300);
});

test("L3 in ETH, valued with the collateral price when it matches", () => {
  const c = computeCapacity({
    ...base,
    layer3: { enabled: true, collateralAsset: WETH, maxCollateralPerAction: 5n * 10n ** 17n },
    l3Collateral: { address: WETH, symbol: "WETH", decimals: 18, unitPriceUsd: 2_000 },
  });
  assert.equal(c.l3.on && c.l3.label, "max 0.5 ETH");
  assert.equal(c.l3.on && c.l3.usd, 1_000);
  assert.equal(c.totalUsd, 1_800);
});

test("heartbeat: fresh, stale after 10 min, none without a timestamp", () => {
  const now = Date.parse("2026-10-24T12:00:00Z");
  assert.deepEqual(heartbeatState("2026-10-24T11:59:48Z", now), { kind: "fresh", ageMs: 12_000 });
  assert.equal(heartbeatState(new Date(now - STALE_AFTER_MS - 1).toISOString(), now).kind, "stale");
  assert.equal(heartbeatState(null, now).kind, "none");
  assert.equal(heartbeatState("not a date", now).kind, "none");
  assert.equal(heartbeatState("2026-10-24T12:00:05Z", now).kind, "fresh");
  assert.deepEqual([formatAge(12_000), formatAge(240_000), formatAge(3 * 3_600_000)], ["12 s", "4 min", "3 h"]);
});

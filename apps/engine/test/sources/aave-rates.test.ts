import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RAY,
  rayToRate,
  aprToApy,
  utilization,
  netCarry,
  daysUntilHf,
  borrowAprAt,
} from "../../src/sources/aave-rates.ts";

test("rayToRate converts Aave ray rates", () => {
  assert.equal(rayToRate(RAY / 20n), 0.05); // 5%
  assert.equal(rayToRate(0n), 0);
});

test("aprToApy compounds per second (5% APR ≈ 5.127% APY)", () => {
  assert.ok(Math.abs(aprToApy(0.05) - 0.051271) < 1e-5);
});

test("utilization = debt / (debt + available)", () => {
  assert.equal(utilization(90n, 10n), 0.9);
  assert.equal(utilization(0n, 0n), 0);
});

test("daysUntilHf follows HF(t) = HF0·exp(carry·t)", () => {
  const carry = netCarry(0.02, 0.06); // -4%/yr
  const days = daysUntilHf(1.5, 1.45, carry)!;
  // ln(1.5/1.45)/0.04 years ≈ 0.8476 yr ≈ 309 days
  assert.ok(Math.abs(days - 309.4) < 1, `got ${days}`);
  assert.equal(daysUntilHf(1.5, 1.45, 0.01), null, "positive carry never erodes HF");
  assert.equal(daysUntilHf(1.4, 1.5, -0.04), null, "target above start is invalid");
});

test("borrowAprAt models the two-slope Aave curve", () => {
  const curve = { baseRate: 0, slope1: 0.06, slope2: 0.6, optimalUtil: 0.9 };
  assert.ok(Math.abs(borrowAprAt(0.45, curve) - 0.03) < 1e-9);
  assert.ok(Math.abs(borrowAprAt(0.9, curve) - 0.06) < 1e-9);
  assert.ok(Math.abs(borrowAprAt(0.95, curve) - 0.36) < 1e-9, "halfway past kink adds half of slope2");
  assert.ok(Math.abs(borrowAprAt(1, curve) - 0.66) < 1e-9);
});

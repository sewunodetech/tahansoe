/**
 * Unit test settle (spec §6): keempat label + lead time.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  labelOf,
  leadTimeMinutes,
  isPositiveRegime,
  type SettleInput,
} from "../../src/reflection/settle.ts";
import type { Outcome } from "../../src/reflection/outcomes.ts";

function outcome(hadBadOutcome: boolean): Outcome {
  return {
    asset: "WETH",
    chainId: 42161,
    windowStart: new Date("2026-10-08T00:00:00Z"),
    windowEnd: new Date("2026-10-08T12:00:00Z"),
    maxDrawdownPct: hadBadOutcome ? 0.15 : 0.02,
    triggeredPaths: hadBadOutcome ? ["T1"] : [],
    hadBadOutcome,
  };
}

function input(o: Partial<SettleInput>): SettleInput {
  return {
    assessedRegime: "STRESSED",
    outcome: outcome(true),
    wasBelowFloorBeforeOutcome: false,
    ...o,
  };
}

test("isPositiveRegime: STRESSED & CRISIS positif, CALM & ELEVATED tidak", () => {
  assert.equal(isPositiveRegime("CALM"), false);
  assert.equal(isPositiveRegime("ELEVATED"), false);
  assert.equal(isPositiveRegime("STRESSED"), true);
  assert.equal(isPositiveRegime("CRISIS"), true);
});

test("TRUE_POSITIVE: regime ≥ STRESSED + outcome buruk", () => {
  assert.equal(labelOf(input({ assessedRegime: "STRESSED", outcome: outcome(true) })), "TRUE_POSITIVE");
});

test("FALSE_POSITIVE: regime ≥ STRESSED tanpa outcome buruk", () => {
  assert.equal(labelOf(input({ assessedRegime: "CRISIS", outcome: outcome(false) })), "FALSE_POSITIVE");
});

test("MISSED: outcome buruk, regime < STRESSED selama look-back", () => {
  assert.equal(
    labelOf(input({ assessedRegime: "CALM", outcome: outcome(true), wasBelowFloorBeforeOutcome: true })),
    "MISSED",
  );
});

test("TRUE_NEGATIVE: regime < STRESSED tanpa outcome buruk, disampel", () => {
  assert.equal(
    labelOf(input({ assessedRegime: "ELEVATED", outcome: outcome(false), sampledForTrueNegative: true })),
    "TRUE_NEGATIVE",
  );
});

test("null jika TN tidak disampel", () => {
  assert.equal(labelOf(input({ assessedRegime: "CALM", outcome: outcome(false) })), null);
});

test("leadTimeMinutes menghitung selisih menit", () => {
  const a = new Date("2026-10-08T00:00:00Z");
  const b = new Date("2026-10-08T06:30:00Z");
  assert.equal(leadTimeMinutes(a, b), 390);
});

test("leadTimeMinutes null jika salah satu waktu kosong", () => {
  assert.equal(leadTimeMinutes(null, new Date()), null);
});

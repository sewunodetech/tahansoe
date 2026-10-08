/**
 * Unit test computeMetrics (spec §3.6) + Budget (spec §6).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeMetrics, type SettlementCounts } from "../../src/reflection/scorecard.ts";
import { Budget, costOf } from "../../src/llm/budget.ts";

function counts(o: Partial<SettlementCounts> = {}): SettlementCounts {
  return {
    truePositive: 7,
    falsePositive: 3,
    missed: 3,
    trueNegative: 50,
    medianLeadTimeMinutes: 400,
    timeInStressedFraction: 0.08,
    schemaPassRate: 0.99,
    ...o,
  };
}

test("recall = TP / (TP + MISSED)", () => {
  const m = computeMetrics(counts({ truePositive: 7, missed: 3 }));
  assert.equal(m.recall, 0.7);
});

test("precision = TP / (TP + FP)", () => {
  const m = computeMetrics(counts({ truePositive: 6, falsePositive: 6 }));
  assert.equal(m.precision, 0.5);
});

test("recall null jika tidak ada TP maupun MISSED", () => {
  const m = computeMetrics(counts({ truePositive: 0, missed: 0 }));
  assert.equal(m.recall, null);
});

test("costOf menghitung dari tabel harga Opus", () => {
  // 1M input @ $4 + 1M output @ $20 = $24
  const c = costOf({ model: "claude-opus-5-5", inputTokens: 1_000_000, outputTokens: 1_000_000 });
  assert.equal(c, 24);
});

test("Budget.exceeded true setelah melewati limit", () => {
  const b = new Budget(1); // limit $1
  assert.equal(b.exceeded(), false);
  b.record({ model: "claude-opus-5-5", inputTokens: 1_000_000, outputTokens: 0 }); // $4
  assert.equal(b.exceeded(), true);
});

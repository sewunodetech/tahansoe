/**
 * Unit test computeMetrics (spec §3.6) + Budget (spec §6).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeMetrics,
  generateScorecard,
  formatScorecardTable,
  type SettlementCounts,
} from "../../src/reflection/scorecard.ts";
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

test("generateScorecard menghitung agregat dan metrik dari settlements", async () => {
  const from = new Date("2026-10-01T00:00:00Z");
  const to = new Date("2026-10-09T00:00:00Z");

  const mockSettlements = [
    { label: "TRUE_POSITIVE", leadTimeMinutes: 480 },
    { label: "TRUE_POSITIVE", leadTimeMinutes: 360 },
    { label: "FALSE_POSITIVE", leadTimeMinutes: null },
    { label: "MISSED", leadTimeMinutes: null },
    { label: "TRUE_NEGATIVE", leadTimeMinutes: null },
  ];

  const sc = await generateScorecard({
    from,
    to,
    settlements: mockSettlements,
    insufficientDataCount: 2,
  });

  assert.equal(sc.totalSettled, 5);
  assert.equal(sc.counts.truePositive, 2);
  assert.equal(sc.counts.falsePositive, 1);
  assert.equal(sc.counts.missed, 1);
  assert.equal(sc.counts.trueNegative, 1);
  assert.equal(sc.insufficientDataCount, 2);

  // Recall = 2 / (2 + 1) = 2/3 ≈ 0.6667
  assert.ok(sc.recall !== null && Math.abs(sc.recall - 2 / 3) < 0.001);

  // Precision = 2 / (2 + 1) = 2/3 ≈ 0.6667
  assert.ok(sc.precision !== null && Math.abs(sc.precision - 2 / 3) < 0.001);

  // Median lead time: [360, 480] -> average = 420
  assert.equal(sc.medianLeadTimeMinutes, 420);

  // Time in stressed: (2 TP + 1 FP) / 5 = 0.6
  assert.equal(sc.timeInStressedFraction, 0.6);
});

test("formatScorecardTable menghasilkan tabel terformat", async () => {
  const from = new Date("2026-10-01T00:00:00Z");
  const to = new Date("2026-10-09T00:00:00Z");

  const sc = await generateScorecard({
    from,
    to,
    settlements: [
      { label: "TRUE_POSITIVE", leadTimeMinutes: 400 },
      { label: "TRUE_NEGATIVE", leadTimeMinutes: null },
    ],
    insufficientDataCount: 1,
  });

  const table = formatScorecardTable(sc);
  assert.ok(table.includes("TAHANSOE RESEARCH AGENT SCORECARD"));
  assert.ok(table.includes("TRUE_POSITIVE  (TP) : 1"));
  assert.ok(table.includes("Laporan Kurang Data   : 1"));
  assert.ok(table.includes("Recall (TP / [TP+MISSED])"));
});


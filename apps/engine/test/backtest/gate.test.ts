/**
 * Unit tests for release gate logic (spec m4-protection-strategy-agent §3.5).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { passesReleaseGate } from "../../src/backtest/reports.ts";
import type { AggregateReport } from "../../src/backtest/types.ts";

function createMockReport(overrides?: Partial<AggregateReport>): AggregateReport {
  return {
    deciderId: "mock",
    scenariosCount: 5,
    totalLiquidations: 0,
    liquidationsPrevented: 10,
    totalLiquidationLossUsd: 0,
    totalRepaidUsd: 50000,
    totalDeleveragedUsd: 0,
    totalCostUsd: 50000,
    falsePositives: 0,
    averageLeadTimeSeconds: 36000,
    scenarios: {},
    ...overrides,
  };
}

test("passesReleaseGate: passes when candidate >= active prevented and cost within 10%", () => {
  const active = createMockReport({ deciderId: "static", liquidationsPrevented: 10, totalCostUsd: 50000, falsePositives: 0 });
  const candidate = createMockReport({
    deciderId: "candidate",
    liquidationsPrevented: 12, // +2 more prevented
    totalCostUsd: 54000, // +8% higher cost (<= 10%)
    falsePositives: 0,
  });

  const gate = passesReleaseGate(candidate, active);
  assert.equal(gate.passed, true);
  assert.equal(gate.reasons.length, 0);
});

test("passesReleaseGate: fails when candidate prevented fewer liquidations", () => {
  const active = createMockReport({ deciderId: "static", liquidationsPrevented: 10, totalCostUsd: 50000, falsePositives: 0 });
  const candidate = createMockReport({
    deciderId: "candidate",
    liquidationsPrevented: 9, // fewer!
    totalCostUsd: 40000,
    falsePositives: 0,
  });

  const gate = passesReleaseGate(candidate, active);
  assert.equal(gate.passed, false);
  assert.ok(gate.reasons.some((r) => r.includes("fewer liquidations")));
});

test("passesReleaseGate: fails when candidate cost is >10% higher than active", () => {
  const active = createMockReport({ deciderId: "static", liquidationsPrevented: 10, totalCostUsd: 50000, falsePositives: 0 });
  const candidate = createMockReport({
    deciderId: "candidate",
    liquidationsPrevented: 10,
    totalCostUsd: 56000, // +12% higher cost (> 10%)
    falsePositives: 0,
  });

  const gate = passesReleaseGate(candidate, active);
  assert.equal(gate.passed, false);
  assert.ok(gate.reasons.some((r) => r.includes("total cost") && r.includes(">10% higher")));
});

test("passesReleaseGate: fails when candidate false positives > 10% higher than active", () => {
  const active = createMockReport({ deciderId: "static", liquidationsPrevented: 10, totalCostUsd: 50000, falsePositives: 0 });
  const candidate = createMockReport({
    deciderId: "candidate",
    liquidationsPrevented: 10,
    totalCostUsd: 50000,
    falsePositives: 1, // Active had 0, candidate had 1
  });

  const gate = passesReleaseGate(candidate, active);
  assert.equal(gate.passed, false);
  assert.ok(gate.reasons.some((r) => r.includes("false positives")));
});

/**
 * Report generation, aggregation, release gate verification, and table renderers.
 * (spec m4-protection-strategy-agent §3.5, PRD §6.4).
 */

import { replayScenario, unassistedDecider } from "./protection-replay.ts";
import type {
  AggregateReport,
  ProtectionDecider,
  ProtectionScenario,
  ReleaseGateResult,
  ScenarioReplayReport,
} from "./types.ts";

/**
 * Runs a backtest suite across multiple scenarios for a decider.
 * Computes unassisted baseline for each scenario to measure liquidations prevented.
 */
export async function runBacktestSuite(
  scenarios: ProtectionScenario[],
  decider: ProtectionDecider,
  deciderId: string,
  options?: { baselineReports?: Record<string, ScenarioReplayReport> }
): Promise<AggregateReport> {
  const scenarioReports: Record<string, ScenarioReplayReport> = {};

  for (const scenario of scenarios) {
    let baseline = options?.baselineReports?.[scenario.id];
    if (!baseline) {
      baseline = await replayScenario(scenario, unassistedDecider, "unassisted");
    }

    const report = await replayScenario(scenario, decider, deciderId, {
      unassistedBaseline: baseline,
    });
    scenarioReports[scenario.id] = report;
  }

  const list = Object.values(scenarioReports);
  const totalLiquidations = list.reduce((acc, r) => acc + r.liquidationsCount, 0);
  const liquidationsPrevented = list.reduce((acc, r) => acc + r.liquidationsPrevented, 0);
  const totalLiquidationLossUsd = list.reduce((acc, r) => acc + r.liquidationLossUsd, 0);
  const totalRepaidUsd = list.reduce((acc, r) => acc + r.totalRepaidUsd, 0);
  const totalDeleveragedUsd = list.reduce((acc, r) => acc + r.totalDeleveragedUsd, 0);
  const totalCostUsd = list.reduce((acc, r) => acc + r.totalCostUsd, 0);
  const falsePositives = list.reduce((acc, r) => acc + r.unnecessaryActionsInCalm, 0);

  const activeLeads = list.filter((r) => r.averageLeadTimeSeconds > 0);
  const averageLeadTimeSeconds =
    activeLeads.length > 0
      ? activeLeads.reduce((acc, r) => acc + r.averageLeadTimeSeconds, 0) / activeLeads.length
      : 0;

  return {
    deciderId,
    scenariosCount: scenarios.length,
    totalLiquidations,
    liquidationsPrevented,
    totalLiquidationLossUsd,
    totalRepaidUsd,
    totalDeleveragedUsd,
    totalCostUsd,
    falsePositives,
    averageLeadTimeSeconds,
    scenarios: scenarioReports,
  };
}

/**
 * Verifies if candidate decider passes release gate over active decider (spec §3.5):
 * 1. candidate.liquidationsPrevented >= active.liquidationsPrevented
 * 2. candidate.totalCostUsd <= active.totalCostUsd * 1.10 (at most 10% worse)
 * 3. candidate.falsePositives <= active.falsePositives * 1.10 (at most 10% worse)
 */
export function passesReleaseGate(candidate: AggregateReport, active: AggregateReport): ReleaseGateResult {
  const reasons: string[] = [];

  const preventedDiff = candidate.liquidationsPrevented - active.liquidationsPrevented;
  if (candidate.liquidationsPrevented < active.liquidationsPrevented) {
    reasons.push(
      `Candidate prevented fewer liquidations (${candidate.liquidationsPrevented}) than active (${active.liquidationsPrevented})`
    );
  }

  // Cost ratio comparison (<= +10% higher than active)
  let costDiffPct = 0;
  if (active.totalCostUsd > 0) {
    costDiffPct = ((candidate.totalCostUsd - active.totalCostUsd) / active.totalCostUsd) * 100;
    if (candidate.totalCostUsd > active.totalCostUsd * 1.1) {
      reasons.push(
        `Candidate total cost ($${candidate.totalCostUsd.toFixed(2)}) is >10% higher than active ($${active.totalCostUsd.toFixed(2)}, +${costDiffPct.toFixed(1)}%)`
      );
    }
  } else if (candidate.totalCostUsd > 0) {
    costDiffPct = 100;
  }

  // False positives ratio comparison (<= +10% higher than active)
  let fpDiffPct = 0;
  if (active.falsePositives > 0) {
    fpDiffPct = ((candidate.falsePositives - active.falsePositives) / active.falsePositives) * 100;
    if (candidate.falsePositives > active.falsePositives * 1.1) {
      reasons.push(
        `Candidate false positives (${candidate.falsePositives}) is >10% higher than active (${active.falsePositives}, +${fpDiffPct.toFixed(1)}%)`
      );
    }
  } else if (candidate.falsePositives > 0) {
    fpDiffPct = 100;
    reasons.push(
      `Candidate incurred ${candidate.falsePositives} false positives while active had 0`
    );
  }

  const passed = reasons.length === 0;

  return {
    passed,
    candidateId: candidate.deciderId,
    activeId: active.deciderId,
    liquidationsPrevented: {
      candidate: candidate.liquidationsPrevented,
      active: active.liquidationsPrevented,
      diff: preventedDiff,
    },
    totalCostUsd: {
      candidate: candidate.totalCostUsd,
      active: active.totalCostUsd,
      ratioDiffPct: costDiffPct,
    },
    falsePositives: {
      candidate: candidate.falsePositives,
      active: active.falsePositives,
      ratioDiffPct: fpDiffPct,
    },
    reasons,
  };
}

/** Formats seconds into human hours/minutes or seconds. */
export function formatLeadTime(seconds: number): string {
  if (seconds <= 0) return "0s";
  const hours = seconds / 3600;
  if (hours >= 1) {
    return `${hours.toFixed(1)}h`;
  }
  const mins = Math.round(seconds / 60);
  return `${mins}m`;
}

/**
 * Renders a side-by-side human table comparing two deciders across scenarios and aggregate metrics.
 */
export function renderComparisonTable(
  candidate: AggregateReport,
  active: AggregateReport,
  gate?: ReleaseGateResult
): string {
  const lines: string[] = [];

  lines.push("=".repeat(96));
  lines.push(` TAHANSOE PROTECTION BACKTEST REPORT: ${candidate.deciderId.toUpperCase()} (Candidate) vs ${active.deciderId.toUpperCase()} (Active)`);
  lines.push("=".repeat(96));

  const pad = (str: string, len: number, alignLeft = true) =>
    alignLeft ? str.padEnd(len) : str.padStart(len);

  // Header
  lines.push(
    [
      pad("Scenario ID", 24),
      pad(`Liq Prev (${candidate.deciderId}/${active.deciderId})`, 20, false),
      pad(`Liq Loss USD`, 18, false),
      pad(`Cost USD`, 16, false),
      pad(`False Pos`, 10, false),
      pad(`Lead Time`, 10, false),
    ].join(" | ")
  );
  lines.push("-".repeat(96));

  const scenarioIds = Object.keys(candidate.scenarios);
  for (const id of scenarioIds) {
    const cScen = candidate.scenarios[id]!;
    const aScen = active.scenarios[id]!;

    const prevStr = `${cScen.liquidationsPrevented} / ${aScen.liquidationsPrevented}`;
    const lossStr = `$${cScen.liquidationLossUsd.toFixed(0)} / $${aScen.liquidationLossUsd.toFixed(0)}`;
    const costStr = `$${cScen.totalCostUsd.toFixed(0)} / $${aScen.totalCostUsd.toFixed(0)}`;
    const fpStr = `${cScen.unnecessaryActionsInCalm} / ${aScen.unnecessaryActionsInCalm}`;
    const leadStr = `${formatLeadTime(cScen.averageLeadTimeSeconds)} / ${formatLeadTime(aScen.averageLeadTimeSeconds)}`;

    lines.push(
      [
        pad(id, 24),
        pad(prevStr, 20, false),
        pad(lossStr, 18, false),
        pad(costStr, 16, false),
        pad(fpStr, 10, false),
        pad(leadStr, 10, false),
      ].join(" | ")
    );
  }

  lines.push("-".repeat(96));

  // Aggregate row
  const aggPrev = `${candidate.liquidationsPrevented} / ${active.liquidationsPrevented}`;
  const aggLoss = `$${candidate.totalLiquidationLossUsd.toFixed(0)} / $${active.totalLiquidationLossUsd.toFixed(0)}`;
  const aggCost = `$${candidate.totalCostUsd.toFixed(0)} / $${active.totalCostUsd.toFixed(0)}`;
  const aggFp = `${candidate.falsePositives} / ${active.falsePositives}`;
  const aggLead = `${formatLeadTime(candidate.averageLeadTimeSeconds)} / ${formatLeadTime(active.averageLeadTimeSeconds)}`;

  lines.push(
    [
      pad("TOTAL (ALL SCENARIOS)", 24),
      pad(aggPrev, 20, false),
      pad(aggLoss, 18, false),
      pad(aggCost, 16, false),
      pad(aggFp, 10, false),
      pad(aggLead, 10, false),
    ].join(" | ")
  );
  lines.push("=".repeat(96));

  if (gate) {
    lines.push("");
    lines.push(`RELEASE GATE (Spec §3.5): ${gate.passed ? "PASSED [OK]" : "FAILED [REJECT]"}`);
    lines.push(`  - Liquidations Prevented: ${gate.liquidationsPrevented.candidate} vs ${gate.liquidationsPrevented.active} (diff: ${gate.liquidationsPrevented.diff >= 0 ? "+" : ""}${gate.liquidationsPrevented.diff})`);
    lines.push(`  - Total Cost: $${gate.totalCostUsd.candidate.toFixed(2)} vs $${gate.totalCostUsd.active.toFixed(2)} (${gate.totalCostUsd.ratioDiffPct >= 0 ? "+" : ""}${gate.totalCostUsd.ratioDiffPct.toFixed(1)}%)`);
    lines.push(`  - False Positives (Calm): ${gate.falsePositives.candidate} vs ${gate.falsePositives.active}`);
    if (gate.reasons.length > 0) {
      lines.push("  - Gate Failures:");
      for (const r of gate.reasons) {
        lines.push(`    * ${r}`);
      }
    }
    lines.push("=".repeat(96));
  }

  return lines.join("\n");
}

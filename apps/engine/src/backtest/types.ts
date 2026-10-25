/**
 * Data structures and types for the Tahansoe Protection Backtest Harness.
 * (spec m4-protection-strategy-agent §3.5, PRD §6.4).
 */

import type { Regime, ProtectionPlan, ProtectionAction, Mandate, PositionState, ProtectionDecider } from "@tahansoe/domain";

/** Config for a synthetic borrow position on Aave V3. */
export interface SyntheticPositionConfig {
  positionKey: string;
  collateralAsset: {
    symbol: string;
    decimals: number;
    initialPriceUsd: number;
  };
  debtAsset: {
    address: string;
    symbol: string;
    decimals: number;
    priceUsd: number;
  };
  /** Liquidation threshold, e.g. 0.825 for 82.5%. */
  liquidationThreshold: number;
  /** Initial health factor, e.g. 1.45. */
  initialHf: number;
  /** Initial debt in token base units (e.g. 10_000_000_000n for 10,000 USDC). */
  initialDebtBase: bigint;
  /** User policy. */
  policy: {
    triggerHf: number;
    targetHf: number;
    maxRepayPerAction: bigint;
  };
  /** Reserves available for protection. */
  initialReserves: {
    wallet: bigint;
    vault: bigint;
  };
  /** Mandate parameters (defaults to defaultMandate if omitted). */
  mandate?: {
    actionMask?: number;
    maxPerAction?: bigint;
    maxPer24h?: bigint;
    maxPreemptHF?: number;
  };
}

/** Single price point along a scenario timeline. */
export interface ScenarioPricePoint {
  /** Unix timestamp in seconds. */
  t: number;
  /** Collateral price in USD. */
  price: number;
  /** Assessed market regime at this point in time. */
  regime: Regime;
  /** Optional driver / signal identifiers. */
  signalIds?: string[];
}

/** A backtest scenario with price path and regime series. */
export interface ProtectionScenario {
  id: string;
  title: string;
  description: string;
  source: string;
  normalized?: boolean;
  points: ScenarioPricePoint[];
  /** Optional custom position configs; if omitted, standard default positions are used. */
  positions?: SyntheticPositionConfig[];
}

/** Details of an individual protection action or liquidation step. */
export interface ReplayStepEvent {
  t: number;
  isoDate: string;
  price: number;
  regime: Regime;
  hfBefore: number;
  hfAfter: number;
  action: ProtectionAction;
  plan?: ProtectionPlan;
  amountRepaidBase: bigint;
  repaidUsd: number;
  collateralSoldBase: bigint;
  collateralSoldUsd: number;
  slippageLossUsd: number;
  liquidationOccurred: boolean;
  debtLiquidatedBase: bigint;
  debtLiquidatedUsd: number;
  collateralSeizedBase: bigint;
  collateralSeizedUsd: number;
  liquidationLossUsd: number;
  unnecessaryAction: boolean;
  note?: string;
}

/** Replay summary for one synthetic position over a scenario. */
export interface PositionReplayResult {
  positionKey: string;
  initialHf: number;
  minHf: number;
  finalHf: number;
  liquidationsCount: number;
  liquidationLossUsd: number;
  totalRepaidBase: bigint;
  totalRepaidUsd: number;
  totalDeleveragedBase: bigint;
  totalDeleveragedUsd: number;
  totalSlippageLossUsd: number;
  totalCostUsd: number;
  unnecessaryActionsInCalm: number;
  firstActionTime: number | null;
  firstCrashTime: number | null;
  leadTimeSeconds: number;
  events: ReplayStepEvent[];
}

/** Replay result for a scenario across all its synthetic positions. */
export interface ScenarioReplayReport {
  scenarioId: string;
  scenarioTitle: string;
  deciderId: string;
  positionsCount: number;
  liquidationsCount: number;
  /** Liquidations prevented compared to unassisted baseline (no protection). */
  liquidationsPrevented: number;
  liquidationLossUsd: number;
  totalRepaidUsd: number;
  totalDeleveragedUsd: number;
  totalCostUsd: number;
  unnecessaryActionsInCalm: number;
  averageLeadTimeSeconds: number;
  positions: PositionReplayResult[];
}

/** Aggregated multi-scenario report for a decider. */
export interface AggregateReport {
  deciderId: string;
  scenariosCount: number;
  totalLiquidations: number;
  liquidationsPrevented: number;
  totalLiquidationLossUsd: number;
  totalRepaidUsd: number;
  totalDeleveragedUsd: number;
  totalCostUsd: number;
  falsePositives: number;
  averageLeadTimeSeconds: number;
  scenarios: Record<string, ScenarioReplayReport>;
}

/** Result of release gate comparison: candidate vs active. */
export interface ReleaseGateResult {
  passed: boolean;
  candidateId: string;
  activeId: string;
  liquidationsPrevented: { candidate: number; active: number; diff: number };
  totalCostUsd: { candidate: number; active: number; ratioDiffPct: number };
  falsePositives: { candidate: number; active: number; ratioDiffPct: number };
  reasons: string[];
}

export type { ProtectionDecider };

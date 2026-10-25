/**
 * Backtest harness module exports.
 * (spec m4-protection-strategy-agent §3.5).
 */

export * from "./types.ts";
export {
  DEFAULT_DELEVERAGE_SLIPPAGE,
  AAVE_CLOSE_FACTOR,
  AAVE_LIQUIDATION_BONUS,
  replayPosition,
  replayScenario,
  unassistedDecider,
  type ReplayOptions,
} from "./protection-replay.ts";
export * from "./deciders.ts";
export * from "./scenarios.ts";
export * from "./reports.ts";
export {
  type ReplayScenario,
  type ReplayResult,
  replayScenario as replayResearchScenario,
} from "./research-replay.ts";

/**
 * Success-fee estimate and "without Tahansoe" liquidation math for Simulation Mode
 * (spec m1-simulation-mode §2, §3.2; spec m4-guardian-success-fee §3).
 *
 * While the fork runs Guardian v2 (no FeeCharged event), the UI shows the fee v3 would charge,
 * labelled as an estimate. Constants come from @tahansoe/domain so they match simulateCascade.
 */

import { FEE_HF_CEILING, SUCCESS_FEE_BPS, simulateCascade } from "@tahansoe/domain";

export { FEE_HF_CEILING, SUCCESS_FEE_BPS };

export function estimateSuccessFee(input: { totalRepaidUsd: number; hfBefore: number; staticTriggerHf: number }): {
  feeEligible: boolean;
  fee: number;
} {
  const feeEligible = input.hfBefore < input.staticTriggerHf && input.hfBefore < FEE_HF_CEILING && input.totalRepaidUsd > 0;
  return { feeEligible, fee: feeEligible ? (input.totalRepaidUsd * SUCCESS_FEE_BPS) / 10_000 : 0 };
}

/** Aave V3 Arbitrum One WETH reserve: liquidation bonus 5% (LB 10500). */
export const WETH_LIQUIDATION_BONUS = 0.05;
/** Aave V3 close factor: 50% of debt, or 100% once HF is below 0.95. */
const CLOSE_FACTOR_HF_THRESHOLD = 0.95;

export interface UnprotectedOutcome {
  hf: number;
  liquidatable: boolean;
  /** Debt a liquidator would repay in one call. */
  debtRepaidUsd: number;
  /** Collateral the liquidator takes beyond the debt it repays: the user's loss. */
  penaltyUsd: number;
}

/** The same position without any protection, valued at `price`. */
export function unprotectedOutcome(position: { collateralEth: number; debtUsd: number; liquidationThreshold: number }, price: number): UnprotectedOutcome {
  const collateralUsd = position.collateralEth * price;
  // simulateCascade with nothing enabled is the plain HF formula from @tahansoe/domain.
  const { initialHf: hf } = simulateCascade({
    collateralUsd,
    debtUsd: position.debtUsd,
    liquidationThreshold: position.liquidationThreshold,
    triggerHf: 0,
    targetHf: 0,
  });
  if (!(hf < 1)) return { hf, liquidatable: false, debtRepaidUsd: 0, penaltyUsd: 0 };
  const closeFactor = hf < CLOSE_FACTOR_HF_THRESHOLD ? 1 : 0.5;
  const debtRepaidUsd = Math.min(position.debtUsd * closeFactor, collateralUsd / (1 + WETH_LIQUIDATION_BONUS));
  return { hf, liquidatable: true, debtRepaidUsd, penaltyUsd: debtRepaidUsd * WETH_LIQUIDATION_BONUS };
}

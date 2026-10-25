/**
 * Deterministic replay engine for synthetic Aave borrow positions.
 * (spec m4-protection-strategy-agent §3.5, PRD §6.4).
 */

import {
  defaultMandate,
  mandateAllows,
  type Mandate,
  type PositionState,
  type ProtectionDecider,
  type ProtectionPlan,
} from "@tahansoe/domain";
import { calculateRepayAmountBase } from "./deciders.ts";
import type {
  PositionReplayResult,
  ProtectionScenario,
  ReplayStepEvent,
  ScenarioReplayReport,
  SyntheticPositionConfig,
} from "./types.ts";

/** Default execution slippage for DELEVERAGE (1%). */
export const DEFAULT_DELEVERAGE_SLIPPAGE = 0.01;

/** Aave V3 standard liquidation close factor (50%). */
export const AAVE_CLOSE_FACTOR = 0.5;

/** Aave V3 liquidation penalty bonus for ETH/USDC (5%). */
export const AAVE_LIQUIDATION_BONUS = 0.05;

export interface ReplayOptions {
  slippage?: number;
  unassistedBaseline?: ScenarioReplayReport;
}

/**
 * Replays a single synthetic position along a scenario price path.
 */
export async function replayPosition(
  config: SyntheticPositionConfig,
  scenario: ProtectionScenario,
  decider: ProtectionDecider,
  options?: { slippage?: number }
): Promise<PositionReplayResult> {
  const slippage = options?.slippage ?? DEFAULT_DELEVERAGE_SLIPPAGE;
  const { collateralAsset, debtAsset, liquidationThreshold, initialHf, initialDebtBase, policy, initialReserves } =
    config;

  const initialPrice = collateralAsset.initialPriceUsd;
  const initialDebtUsd = (Number(initialDebtBase) / 10 ** debtAsset.decimals) * debtAsset.priceUsd;
  const initialCollateralUsd = (initialHf * initialDebtUsd) / liquidationThreshold;
  let collateralQty = initialCollateralUsd / initialPrice;

  let currentDebtBase = initialDebtBase;
  let walletReserve = initialReserves.wallet;
  let vaultReserve = initialReserves.vault;
  const currentPolicy = { ...policy };

  // Mandate setup
  const baseMandate: Mandate = defaultMandate({
    positionKey: config.positionKey,
    agent: "0xAgent000000000000000000000000000000000001",
    staticTriggerHf: policy.triggerHf,
    maxRepayPerAction: policy.maxRepayPerAction,
    validUntil: new Date(Date.now() + 365 * 86400 * 1000),
  });

  const mandate: Mandate = {
    ...baseMandate,
    ...(config.mandate?.actionMask !== undefined ? { actionMask: config.mandate.actionMask } : {}),
    ...(config.mandate?.maxPerAction !== undefined ? { maxPerAction: config.mandate.maxPerAction } : {}),
    ...(config.mandate?.maxPer24h !== undefined ? { maxPer24h: config.mandate.maxPer24h } : {}),
    ...(config.mandate?.maxPreemptHF !== undefined ? { maxPreemptHF: config.mandate.maxPreemptHF } : {}),
  };

  const spentHistory: Array<{ t: number; amount: bigint }> = [];
  const events: ReplayStepEvent[] = [];

  let minHf = initialHf;
  let liquidationsCount = 0;
  let liquidationLossUsd = 0;
  let totalRepaidBase = 0n;
  let totalRepaidUsd = 0;
  let totalDeleveragedBase = 0n;
  let totalDeleveragedUsd = 0;
  let totalSlippageLossUsd = 0;
  let unnecessaryActionsInCalm = 0;
  let firstActionTime: number | null = null;
  let firstCrashTime: number | null = null;

  // Track the timestamp of the lowest price trough for lead-time calculation
  let troughTime = scenario.points[0]?.t ?? 0;
  let minPrice = scenario.points[0]?.price ?? initialPrice;
  for (const pt of scenario.points) {
    if (pt.price < minPrice) {
      minPrice = pt.price;
      troughTime = pt.t;
    }
  }

  for (const pt of scenario.points) {
    const price = pt.price;
    const collateralUsd = collateralQty * price;
    const debtUsd = (Number(currentDebtBase) / 10 ** debtAsset.decimals) * debtAsset.priceUsd;
    let hf = debtUsd <= 0 ? 999 : (collateralUsd * liquidationThreshold) / debtUsd;
    if (hf < minHf) minHf = hf;

    if (hf < 1.0 && firstCrashTime === null) {
      firstCrashTime = pt.t;
    }

    // Prune rolling 24h spent history
    const cutoff = pt.t - 86400;
    while (spentHistory.length > 0 && spentHistory[0]!.t < cutoff) {
      spentHistory.shift();
    }
    const spent24h = spentHistory.reduce((acc, x) => acc + x.amount, 0n);

    // Build PositionState
    const state: PositionState = {
      positionKey: config.positionKey,
      at: new Date(pt.t * 1000),
      healthFactor: hf,
      collateralUsd,
      debtUsd,
      liquidationThreshold,
      debtAsset,
      reserves: {
        wallet: walletReserve,
        vault: vaultReserve,
      },
      policy: currentPolicy,
      regime: pt.regime,
      signalIds: pt.signalIds ?? [`regime:${pt.regime}`],
      spent24h,
    };

    let stepRepaidBase = 0n;
    let stepRepaidUsd = 0;
    let stepCollateralSoldBase = 0n;
    let stepCollateralSoldUsd = 0;
    let stepSlippageLossUsd = 0;
    let plan: ProtectionPlan | undefined;
    const hfBefore = hf;

    // Call decider if position still has active debt and collateral
    if (currentDebtBase > 0n && collateralQty > 0) {
      try {
        plan = await decider(state, mandate);
      } catch {
        plan = undefined;
      }

      if (plan && mandateAllows(mandate, plan.action)) {
        if (plan.action === "SHIFT_TRIGGER" && plan.triggerHf !== undefined) {
          if (plan.triggerHf <= mandate.maxPreemptHF) {
            currentPolicy.triggerHf = plan.triggerHf;
            events.push({
              t: pt.t,
              isoDate: new Date(pt.t * 1000).toISOString(),
              price,
              regime: pt.regime,
              hfBefore,
              hfAfter: hf,
              action: "SHIFT_TRIGGER",
              plan,
              amountRepaidBase: 0n,
              repaidUsd: 0,
              collateralSoldBase: 0n,
              collateralSoldUsd: 0,
              slippageLossUsd: 0,
              liquidationOccurred: false,
              debtLiquidatedBase: 0n,
              debtLiquidatedUsd: 0,
              collateralSeizedBase: 0n,
              collateralSeizedUsd: 0,
              liquidationLossUsd: 0,
              unnecessaryAction: false,
              note: `Shifted trigger to ${plan.triggerHf.toFixed(3)}`,
            });
          }
        } else if (plan.action === "REPAY_WALLET" || plan.action === "REPAY_VAULT") {
          const neededBase = calculateRepayAmountBase(
            collateralUsd,
            debtUsd,
            liquidationThreshold,
            currentPolicy.targetHf,
            debtAsset.decimals,
            debtAsset.priceUsd
          );

          let proposedBase = plan.amount ? BigInt(plan.amount) : neededBase;
          if (proposedBase > neededBase) proposedBase = neededBase;

          const remaining24h = mandate.maxPer24h > spent24h ? mandate.maxPer24h - spent24h : 0n;
          let cap = mandate.maxPerAction;
          if (currentPolicy.maxRepayPerAction < cap) cap = currentPolicy.maxRepayPerAction;
          if (remaining24h < cap) cap = remaining24h;

          let executeBase = proposedBase > cap ? cap : proposedBase;

          if (plan.action === "REPAY_WALLET") {
            if (executeBase > walletReserve) executeBase = walletReserve;
            walletReserve -= executeBase;
          } else {
            if (executeBase > vaultReserve) executeBase = vaultReserve;
            vaultReserve -= executeBase;
          }

          if (executeBase > currentDebtBase) executeBase = currentDebtBase;

          if (executeBase > 0n) {
            currentDebtBase -= executeBase;
            spentHistory.push({ t: pt.t, amount: executeBase });
            stepRepaidBase = executeBase;
            stepRepaidUsd = (Number(executeBase) / 10 ** debtAsset.decimals) * debtAsset.priceUsd;
            totalRepaidBase += executeBase;
            totalRepaidUsd += stepRepaidUsd;

            if (firstActionTime === null) firstActionTime = pt.t;

            // Recalculate HF
            const newDebtUsd = (Number(currentDebtBase) / 10 ** debtAsset.decimals) * debtAsset.priceUsd;
            hf = newDebtUsd <= 0 ? 999 : (collateralUsd * liquidationThreshold) / newDebtUsd;

            // Check if action was an unnecessary false positive in calm regime
            let isUnnecessary = false;
            if (pt.regime === "CALM" && hfBefore >= currentPolicy.triggerHf + 0.1) {
              unnecessaryActionsInCalm++;
              isUnnecessary = true;
            }

            events.push({
              t: pt.t,
              isoDate: new Date(pt.t * 1000).toISOString(),
              price,
              regime: pt.regime,
              hfBefore,
              hfAfter: hf,
              action: plan.action,
              plan,
              amountRepaidBase: stepRepaidBase,
              repaidUsd: stepRepaidUsd,
              collateralSoldBase: 0n,
              collateralSoldUsd: 0,
              slippageLossUsd: 0,
              liquidationOccurred: false,
              debtLiquidatedBase: 0n,
              debtLiquidatedUsd: 0,
              collateralSeizedBase: 0n,
              collateralSeizedUsd: 0,
              liquidationLossUsd: 0,
              unnecessaryAction: isUnnecessary,
              note: `Repaid $${stepRepaidUsd.toFixed(2)} from ${plan.action === "REPAY_WALLET" ? "wallet" : "vault"}`,
            });
          }
        } else if (plan.action === "DELEVERAGE") {
          // Deleverage sells collateral to repay debt
          const denom = currentPolicy.targetHf - liquidationThreshold / (1 - slippage);
          if (denom > 0) {
            const repayNeededUsd =
              (currentPolicy.targetHf * debtUsd - collateralUsd * liquidationThreshold) / denom;

            if (repayNeededUsd > 0) {
              const unit = 10 ** debtAsset.decimals;
              let executeBase = BigInt(Math.ceil((repayNeededUsd / debtAsset.priceUsd) * unit));
              if (plan.amount && BigInt(plan.amount) < executeBase) {
                executeBase = BigInt(plan.amount);
              }

              const remaining24h = mandate.maxPer24h > spent24h ? mandate.maxPer24h - spent24h : 0n;
              let cap = mandate.maxPerAction;
              if (currentPolicy.maxRepayPerAction < cap) cap = currentPolicy.maxRepayPerAction;
              if (remaining24h < cap) cap = remaining24h;
              if (executeBase > cap) executeBase = cap;
              if (executeBase > currentDebtBase) executeBase = currentDebtBase;

              const proceedsUsd = (Number(executeBase) / unit) * debtAsset.priceUsd;
              const collateralSoldUsd = proceedsUsd / (1 - slippage);
              const collateralSoldQty = collateralSoldUsd / price;

              if (collateralSoldQty <= collateralQty && executeBase > 0n) {
                collateralQty -= collateralSoldQty;
                currentDebtBase -= executeBase;
                spentHistory.push({ t: pt.t, amount: executeBase });

                stepCollateralSoldUsd = collateralSoldUsd;
                stepCollateralSoldBase = BigInt(Math.ceil(collateralSoldQty * 10 ** collateralAsset.decimals));
                stepSlippageLossUsd = collateralSoldUsd - proceedsUsd;

                totalDeleveragedBase += executeBase;
                totalDeleveragedUsd += proceedsUsd;
                totalSlippageLossUsd += stepSlippageLossUsd;

                if (firstActionTime === null) firstActionTime = pt.t;

                const newDebtUsd = (Number(currentDebtBase) / unit) * debtAsset.priceUsd;
                const newCollateralUsd = collateralQty * price;
                hf = newDebtUsd <= 0 ? 999 : (newCollateralUsd * liquidationThreshold) / newDebtUsd;

                let isUnnecessary = false;
                if (pt.regime === "CALM") {
                  unnecessaryActionsInCalm++;
                  isUnnecessary = true;
                }

                events.push({
                  t: pt.t,
                  isoDate: new Date(pt.t * 1000).toISOString(),
                  price,
                  regime: pt.regime,
                  hfBefore,
                  hfAfter: hf,
                  action: "DELEVERAGE",
                  plan,
                  amountRepaidBase: executeBase,
                  repaidUsd: proceedsUsd,
                  collateralSoldBase: stepCollateralSoldBase,
                  collateralSoldUsd,
                  slippageLossUsd: stepSlippageLossUsd,
                  liquidationOccurred: false,
                  debtLiquidatedBase: 0n,
                  debtLiquidatedUsd: 0,
                  collateralSeizedBase: 0n,
                  collateralSeizedUsd: 0,
                  liquidationLossUsd: 0,
                  unnecessaryAction: isUnnecessary,
                  note: `Deleveraged: sold ${collateralSoldQty.toFixed(4)} ${collateralAsset.symbol} to repay $${proceedsUsd.toFixed(2)} debt`,
                });
              }
            }
          }
        }
      }
    }

    // Check for Aave Liquidation when HF < 1.0
    const finalCollateralUsd = collateralQty * price;
    const finalDebtUsd = (Number(currentDebtBase) / 10 ** debtAsset.decimals) * debtAsset.priceUsd;
    hf = finalDebtUsd <= 0 ? 999 : (finalCollateralUsd * liquidationThreshold) / finalDebtUsd;

    if (hf < 1.0 && currentDebtBase > 0n && collateralQty > 0) {
      liquidationsCount++;
      const debtLiquidatedBase = (currentDebtBase * BigInt(Math.round(AAVE_CLOSE_FACTOR * 10_000))) / 10_000n;
      const debtLiquidatedUsd =
        (Number(debtLiquidatedBase) / 10 ** debtAsset.decimals) * debtAsset.priceUsd;

      const collateralSeizedUsd = debtLiquidatedUsd * (1 + AAVE_LIQUIDATION_BONUS);
      const collateralSeizedQty = Math.min(collateralQty, collateralSeizedUsd / price);
      const actualLossUsd = debtLiquidatedUsd * AAVE_LIQUIDATION_BONUS;

      currentDebtBase -= debtLiquidatedBase;
      collateralQty -= collateralSeizedQty;
      liquidationLossUsd += actualLossUsd;

      const postLiqDebtUsd = (Number(currentDebtBase) / 10 ** debtAsset.decimals) * debtAsset.priceUsd;
      const postLiqColUsd = collateralQty * price;
      const hfAfterLiq = postLiqDebtUsd <= 0 ? 999 : (postLiqColUsd * liquidationThreshold) / postLiqDebtUsd;

      events.push({
        t: pt.t,
        isoDate: new Date(pt.t * 1000).toISOString(),
        price,
        regime: pt.regime,
        hfBefore: hf,
        hfAfter: hfAfterLiq,
        action: "HOLD",
        amountRepaidBase: 0n,
        repaidUsd: 0,
        collateralSoldBase: 0n,
        collateralSoldUsd: 0,
        slippageLossUsd: 0,
        liquidationOccurred: true,
        debtLiquidatedBase,
        debtLiquidatedUsd,
        collateralSeizedBase: BigInt(Math.ceil(collateralSeizedQty * 10 ** collateralAsset.decimals)),
        collateralSeizedUsd,
        liquidationLossUsd: actualLossUsd,
        unnecessaryAction: false,
        note: `LIQUIDATED: repaid $${debtLiquidatedUsd.toFixed(2)} debt, seized $${collateralSeizedUsd.toFixed(2)} collateral (loss: $${actualLossUsd.toFixed(2)})`,
      });
      hf = hfAfterLiq;
    }
  }

  // Calculate lead time: seconds between first preemptive action and either crash or trough
  let leadTimeSeconds = 0;
  if (firstActionTime !== null) {
    const targetRefTime = firstCrashTime !== null ? firstCrashTime : troughTime;
    if (targetRefTime > firstActionTime) {
      leadTimeSeconds = targetRefTime - firstActionTime;
    }
  }

  const finalColUsd = collateralQty * (scenario.points[scenario.points.length - 1]?.price ?? initialPrice);
  const finalDebtUsd = (Number(currentDebtBase) / 10 ** debtAsset.decimals) * debtAsset.priceUsd;
  const finalHf = finalDebtUsd <= 0 ? 999 : (finalColUsd * liquidationThreshold) / finalDebtUsd;
  const totalCostUsd = totalRepaidUsd + totalDeleveragedUsd + totalSlippageLossUsd;

  return {
    positionKey: config.positionKey,
    initialHf,
    minHf,
    finalHf,
    liquidationsCount,
    liquidationLossUsd,
    totalRepaidBase,
    totalRepaidUsd,
    totalDeleveragedBase,
    totalDeleveragedUsd,
    totalSlippageLossUsd,
    totalCostUsd,
    unnecessaryActionsInCalm,
    firstActionTime,
    firstCrashTime,
    leadTimeSeconds,
    events,
  };
}

/**
 * Replays an entire scenario across all its configured synthetic positions.
 */
export async function replayScenario(
  scenario: ProtectionScenario,
  decider: ProtectionDecider,
  deciderId: string,
  options?: ReplayOptions
): Promise<ScenarioReplayReport> {
  const positions = scenario.positions ?? [];
  const results: PositionReplayResult[] = [];

  for (const posConfig of positions) {
    const res = await replayPosition(posConfig, scenario, decider, { slippage: options?.slippage });
    results.push(res);
  }

  const totalLiquidations = results.reduce((acc, r) => acc + r.liquidationsCount, 0);
  const totalLiquidationLoss = results.reduce((acc, r) => acc + r.liquidationLossUsd, 0);
  const totalRepaidUsd = results.reduce((acc, r) => acc + r.totalRepaidUsd, 0);
  const totalDeleveragedUsd = results.reduce((acc, r) => acc + r.totalDeleveragedUsd, 0);
  const totalCostUsd = results.reduce((acc, r) => acc + r.totalCostUsd, 0);
  const totalUnnecessary = results.reduce((acc, r) => acc + r.unnecessaryActionsInCalm, 0);

  const activeLeadTimes = results.filter((r) => r.leadTimeSeconds > 0);
  const averageLeadTimeSeconds =
    activeLeadTimes.length > 0
      ? activeLeadTimes.reduce((acc, r) => acc + r.leadTimeSeconds, 0) / activeLeadTimes.length
      : 0;

  // Compute liquidations prevented relative to baseline
  let liquidationsPrevented = 0;
  if (options?.unassistedBaseline) {
    liquidationsPrevented = Math.max(0, options.unassistedBaseline.liquidationsCount - totalLiquidations);
  }

  return {
    scenarioId: scenario.id,
    scenarioTitle: scenario.title,
    deciderId,
    positionsCount: results.length,
    liquidationsCount: totalLiquidations,
    liquidationsPrevented,
    liquidationLossUsd: totalLiquidationLoss,
    totalRepaidUsd,
    totalDeleveragedUsd,
    totalCostUsd,
    unnecessaryActionsInCalm: totalUnnecessary,
    averageLeadTimeSeconds,
    positions: results,
  };
}

/**
 * A no-op decider that never intervenes, used to establish the unassisted baseline.
 */
export const unassistedDecider: ProtectionDecider = (state: PositionState): ProtectionPlan => ({
  positionKey: state.positionKey,
  strategyVersion: "unassisted-baseline",
  action: "HOLD",
  expectedHfAfter: state.healthFactor,
  urgency: "LOW",
  drivers: [],
  playbookIds: [],
  validUntil: new Date(state.at.getTime() + 3_600_000).toISOString(),
});

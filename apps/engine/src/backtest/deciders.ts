/**
 * Built-in deciders and decider registry for the protection backtest harness.
 * (spec m4-protection-strategy-agent §3.5, ADR 0002).
 */

import {
  clampTrigger,
  type Mandate,
  type PositionState,
  type ProtectionDecider,
  type ProtectionPlan,
  type Regime,
  type TriggerBand,
} from "@tahansoe/domain";

/** Default user risk band (PRD §7.3). */
export const DEFAULT_RISK_BAND: TriggerBand = {
  min: 1.25,
  max: 1.6,
};

/** Mapping from regime to recommended trigger HF (PRD §6.3, ADR 0002). */
export const REGIME_TRIGGER_MAP: Record<Regime, number> = {
  CALM: 1.2,
  ELEVATED: 1.35,
  STRESSED: 1.5,
  CRISIS: 1.6,
};

/**
 * Calculates debt base units required to bring position HF up to target HF.
 */
export function calculateRepayAmountBase(
  collateralUsd: number,
  debtUsd: number,
  lt: number,
  targetHf: number,
  decimals: number,
  priceUsd: number
): bigint {
  if (targetHf <= 0 || debtUsd <= 0) return 0n;
  const targetDebtUsd = (collateralUsd * lt) / targetHf;
  if (debtUsd <= targetDebtUsd) return 0n;
  const repayUsd = debtUsd - targetDebtUsd;
  const unit = 10 ** decimals;
  const rawBase = Math.ceil((repayUsd / priceUsd) * unit);
  return BigInt(Math.max(0, rawBase));
}

/**
 * Static Decider:
 * Acts only when healthFactor < policy.triggerHf (like Guardian v4 protect).
 * Evaluates wallet reserves first, then vault reserves.
 */
export const staticDecider = (state: PositionState, mandate: Mandate): ProtectionPlan => {
  const { healthFactor, policy, collateralUsd, debtUsd, liquidationThreshold, debtAsset, reserves } = state;

  // Never acts when HF >= static trigger
  if (healthFactor >= policy.triggerHf) {
    return {
      positionKey: state.positionKey,
      strategyVersion: "static-v4",
      action: "HOLD",
      expectedHfAfter: healthFactor,
      urgency: "LOW",
      drivers: [],
      playbookIds: [],
      validUntil: new Date(state.at.getTime() + 3_600_000).toISOString(),
    };
  }

  // Determine repay needed to reach target
  const rawNeededBase = calculateRepayAmountBase(
    collateralUsd,
    debtUsd,
    liquidationThreshold,
    policy.targetHf,
    debtAsset.decimals,
    debtAsset.priceUsd
  );

  // Apply policy and mandate limits
  const remaining24h = mandate.maxPer24h > state.spent24h ? mandate.maxPer24h - state.spent24h : 0n;
  let maxAllowed = policy.maxRepayPerAction;
  if (mandate.maxPerAction < maxAllowed) maxAllowed = mandate.maxPerAction;
  if (remaining24h < maxAllowed) maxAllowed = remaining24h;

  let repayBase = rawNeededBase > maxAllowed ? maxAllowed : rawNeededBase;

  // Choose funding source
  let action: "REPAY_WALLET" | "REPAY_VAULT" | "HOLD" = "HOLD";
  if (reserves.wallet > 0n) {
    action = "REPAY_WALLET";
    if (repayBase > reserves.wallet) repayBase = reserves.wallet;
  } else if (reserves.vault > 0n) {
    action = "REPAY_VAULT";
    if (repayBase > reserves.vault) repayBase = reserves.vault;
  }

  if (action === "HOLD" || repayBase <= 0n) {
    return {
      positionKey: state.positionKey,
      strategyVersion: "static-v4",
      action: "HOLD",
      expectedHfAfter: healthFactor,
      urgency: "HIGH",
      drivers: ["static:trigger-breach-no-reserves"],
      playbookIds: [],
      validUntil: new Date(state.at.getTime() + 3_600_000).toISOString(),
    };
  }

  const repaidUsd = (Number(repayBase) / 10 ** debtAsset.decimals) * debtAsset.priceUsd;
  const newDebtUsd = Math.max(0.0001, debtUsd - repaidUsd);
  const expectedHfAfter = (collateralUsd * liquidationThreshold) / newDebtUsd;

  return {
    positionKey: state.positionKey,
    strategyVersion: "static-v4",
    action,
    amount: repayBase.toString(),
    expectedHfAfter,
    urgency: healthFactor < 1.1 ? "HIGH" : "MEDIUM",
    drivers: ["static:hf-below-trigger"],
    playbookIds: ["pb-static-repay"],
    validUntil: new Date(state.at.getTime() + 3_600_000).toISOString(),
  };
};

/**
 * Creates a dynamic trigger decider.
 * Shifts trigger inside risk band based on market regime (ADR 0002).
 * When HF drops below the effective dynamic trigger, executes preemptive repayment.
 */
export function createDynamicTriggerDecider(options?: {
  band?: TriggerBand;
  regimeTriggerMap?: Record<Regime, number>;
}): ProtectionDecider {
  const band = options?.band ?? DEFAULT_RISK_BAND;
  const triggerMap = options?.regimeTriggerMap ?? REGIME_TRIGGER_MAP;

  return (state: PositionState, mandate: Mandate): ProtectionPlan => {
    // Graceful degradation: if regime is missing, fall back to static policy
    if (!state.regime) {
      return staticDecider(state, mandate);
    }

    const recommendedTrigger = triggerMap[state.regime];
    const dynamicTrigger = clampTrigger(recommendedTrigger, band);
    const { healthFactor, policy, collateralUsd, debtUsd, liquidationThreshold, debtAsset, reserves } = state;

    // If HF is below the dynamic trigger, protect position preemptively!
    if (healthFactor < dynamicTrigger) {
      const rawNeededBase = calculateRepayAmountBase(
        collateralUsd,
        debtUsd,
        liquidationThreshold,
        policy.targetHf,
        debtAsset.decimals,
        debtAsset.priceUsd
      );

      const remaining24h = mandate.maxPer24h > state.spent24h ? mandate.maxPer24h - state.spent24h : 0n;
      let maxAllowed = policy.maxRepayPerAction;
      if (mandate.maxPerAction < maxAllowed) maxAllowed = mandate.maxPerAction;
      if (remaining24h < maxAllowed) maxAllowed = remaining24h;

      let repayBase = rawNeededBase > maxAllowed ? maxAllowed : rawNeededBase;

      let action: "REPAY_WALLET" | "REPAY_VAULT" | "HOLD" = "HOLD";
      if (reserves.wallet > 0n) {
        action = "REPAY_WALLET";
        if (repayBase > reserves.wallet) repayBase = reserves.wallet;
      } else if (reserves.vault > 0n) {
        action = "REPAY_VAULT";
        if (repayBase > reserves.vault) repayBase = reserves.vault;
      }

      if (action !== "HOLD" && repayBase > 0n) {
        const repaidUsd = (Number(repayBase) / 10 ** debtAsset.decimals) * debtAsset.priceUsd;
        const newDebtUsd = Math.max(0.0001, debtUsd - repaidUsd);
        const expectedHfAfter = (collateralUsd * liquidationThreshold) / newDebtUsd;

        return {
          positionKey: state.positionKey,
          strategyVersion: "dynamic-trigger-v1",
          action,
          amount: repayBase.toString(),
          expectedHfAfter,
          urgency: healthFactor < 1.15 ? "HIGH" : "MEDIUM",
          drivers: [`regime:${state.regime}`, `dynamic-trigger:${dynamicTrigger}`],
          playbookIds: ["pb-dynamic-repay"],
          validUntil: new Date(state.at.getTime() + 3_600_000).toISOString(),
        };
      }
    }

    // If HF >= dynamicTrigger, check if trigger should be shifted
    const currentTrigger = policy.triggerHf;
    if (Math.abs(currentTrigger - dynamicTrigger) >= 0.01) {
      return {
        positionKey: state.positionKey,
        strategyVersion: "dynamic-trigger-v1",
        action: "SHIFT_TRIGGER",
        triggerHf: dynamicTrigger,
        expectedHfAfter: healthFactor,
        urgency: "LOW",
        drivers: [`regime:${state.regime}`, `shift-trigger-to:${dynamicTrigger}`],
        playbookIds: ["pb-dynamic-shift-trigger"],
        validUntil: new Date(state.at.getTime() + 3_600_000).toISOString(),
      };
    }

    return {
      positionKey: state.positionKey,
      strategyVersion: "dynamic-trigger-v1",
      action: "HOLD",
      expectedHfAfter: healthFactor,
      urgency: "LOW",
      drivers: [`regime:${state.regime}`],
      playbookIds: [],
      validUntil: new Date(state.at.getTime() + 3_600_000).toISOString(),
    };
  };
}

/** Standard dynamic trigger decider instance. */
export const dynamicTriggerDecider = createDynamicTriggerDecider();

/** Decider registry to allow easily registering and comparing new deciders. */
export class DeciderRegistry {
  private deciders = new Map<string, ProtectionDecider>();

  constructor() {
    this.register("static", staticDecider);
    this.register("dynamic", dynamicTriggerDecider);
  }

  register(id: string, decider: ProtectionDecider): void {
    this.deciders.set(id, decider);
  }

  get(id: string): ProtectionDecider | undefined {
    return this.deciders.get(id);
  }

  list(): string[] {
    return Array.from(this.deciders.keys());
  }

  has(id: string): boolean {
    return this.deciders.has(id);
  }
}

/** Default shared registry instance. */
export const defaultDeciderRegistry = new DeciderRegistry();

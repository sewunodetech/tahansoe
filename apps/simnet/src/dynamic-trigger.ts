/**
 * Dynamic trigger calculation and band clamping for simulation mode (spec §3.6).
 *
 * During scenario replays on the fork, the sim keeper acts as the risk agent,
 * mapping the scenario's regime series to a dynamic trigger inside the user's band.
 *
 * NOTE: The regime series in simulation fixtures represents hindsight labelling
 * for historical demonstration and testing, not a live AI/risk engine forecast.
 */

import type { Address } from "viem";
import type { ScenarioRegime } from "./scenario.ts";

export const WAD = 10n ** 18n;
export const WAD_0_10 = 100_000_000_000_000_000n; // 0.10 WAD
export const WAD_0_20 = 200_000_000_000_000_000n; // 0.20 WAD
export const TARGET_BUFFER_WAD = 100_000_000_000_000n; // 0.0001 WAD (matches GuardianCore.TARGET_BUFFER)

export interface TriggerBandInput {
  minTriggerHF: bigint;
  maxTriggerHF: bigint;
}

export interface DynamicTriggerParams {
  regime: ScenarioRegime;
  band: TriggerBandInput;
  staticTriggerHF: bigint;
  targetHF: bigint;
}

/**
 * Maps a market regime to a dynamic trigger inside the user's trigger band,
 * guaranteed to be strictly below the position's targetHF.
 *
 * Rules:
 * - CALM: static trigger (clamped to band)
 * - ELEVATED: static + 0.10 (clamped to band)
 * - STRESSED: static + 0.20 (clamped to band)
 * - CRISIS: band max trigger
 *
 * In all regimes, the resulting trigger is clamped to [minTriggerHF, maxTriggerHF]
 * and strictly capped below targetHF so the contract never reverts on InvalidTrigger.
 */
export function calculateDynamicTrigger(params: DynamicTriggerParams): bigint {
  const { regime, band, staticTriggerHF, targetHF } = params;

  let candidate: bigint;
  switch (regime) {
    case "CALM":
      candidate = staticTriggerHF;
      break;
    case "ELEVATED":
      candidate = staticTriggerHF + WAD_0_10;
      break;
    case "STRESSED":
      candidate = staticTriggerHF + WAD_0_20;
      break;
    case "CRISIS":
      candidate = band.maxTriggerHF;
      break;
    default:
      candidate = staticTriggerHF;
  }

  // 1. Clamp to user's trigger band [minTriggerHF, maxTriggerHF]
  let trigger = candidate;
  if (trigger < band.minTriggerHF) {
    trigger = band.minTriggerHF;
  }
  if (trigger > band.maxTriggerHF) {
    trigger = band.maxTriggerHF;
  }

  // 2. Enforce strictly below targetHF (contract requirement in GuardianCore: triggerHF < targetHF)
  if (trigger >= targetHF) {
    trigger = targetHF - TARGET_BUFFER_WAD;
    if (trigger < band.minTriggerHF) {
      trigger = band.minTriggerHF;
    }
  }

  return trigger;
}

export interface DefaultBandPolicy {
  triggerHF: bigint;
  targetHF: bigint;
}

export interface ConfiguredTriggerBand {
  minTriggerHF: bigint;
  maxTriggerHF: bigint;
  riskAgent: Address;
}

/**
 * Calculates default trigger band parameters for a simulation position.
 * The static trigger serves as the band minimum, and the maximum is set comfortably
 * below targetHF (capped at 1.60 WAD).
 */
export function calculateDefaultBand(policy: DefaultBandPolicy, riskAgent: Address): ConfiguredTriggerBand {
  const minTriggerHF = policy.triggerHF;
  const maxCap = 1_600_000_000_000_000_000n; // 1.60 WAD default ceiling
  const defaultBuffer = 50_000_000_000_000_000n; // 0.05 WAD buffer below targetHF

  let maxTriggerHF = policy.targetHF - defaultBuffer;
  if (maxTriggerHF > maxCap) {
    maxTriggerHF = maxCap;
  }
  if (maxTriggerHF < minTriggerHF) {
    maxTriggerHF = minTriggerHF;
  }
  if (maxTriggerHF >= policy.targetHF) {
    maxTriggerHF = policy.targetHF - TARGET_BUFFER_WAD;
  }

  return { minTriggerHF, maxTriggerHF, riskAgent };
}

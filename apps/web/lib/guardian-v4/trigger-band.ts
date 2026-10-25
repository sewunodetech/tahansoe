import type { Address } from "viem";

export const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";
export const MIN_TRIGGER_HF = 1.05;
export const MAX_TARGET_HF = 3.0;

export interface TriggerBandInput {
  minTriggerHf: number;
  maxTriggerHf: number;
  targetHf: number;
  riskAgent?: Address;
  enabled: boolean;
}

export interface TriggerBandValidationResult {
  valid: boolean;
  error?: string;
}

export interface SavedTriggerBand {
  minTriggerHf: number;
  maxTriggerHf: number;
  riskAgent: Address;
  enabled: boolean;
  updatedAt: number;
}

export interface DynamicTriggerState {
  active: boolean;
  dynamicTriggerHf: number;
  validUntil: number; // Unix timestamp in seconds
  riskAgent: Address;
  remainingSeconds: number;
}

/**
 * Computes default trigger band for Tahansoe risk agent:
 * - default min = static trigger
 * - max = min(target - 0.05, static trigger + 0.25)
 * Rounded to 2 decimal places.
 */
export function calculateDefaultBand(
  staticTriggerHf: number,
  targetHf: number
): { minTriggerHf: number; maxTriggerHf: number } {
  const minTriggerHf = Math.round(staticTriggerHf * 100) / 100;
  const rawMax = Math.min(targetHf - 0.05, staticTriggerHf + 0.25);
  // Ensure max is at least minTriggerHf and at most MAX_TARGET_HF
  const maxTriggerHf = Math.round(Math.max(minTriggerHf, rawMax) * 100) / 100;
  return { minTriggerHf, maxTriggerHf };
}

/**
 * Validates inputs for trigger band configuration.
 */
export function validateTriggerBandInputs(input: TriggerBandInput): TriggerBandValidationResult {
  if (!input.enabled) {
    return { valid: true };
  }

  if (!input.riskAgent || input.riskAgent === ZERO_ADDRESS) {
    return { valid: false, error: "Authorized risk agent address is required" };
  }

  if (input.minTriggerHf < MIN_TRIGGER_HF) {
    return {
      valid: false,
      error: `Min trigger HF cannot be below ${MIN_TRIGGER_HF.toFixed(2)}`,
    };
  }

  if (input.minTriggerHf > input.maxTriggerHf) {
    return { valid: false, error: "Min trigger HF cannot exceed Max trigger HF" };
  }

  if (input.maxTriggerHf >= input.targetHf) {
    return { valid: false, error: "Max trigger HF must be strictly less than target HF" };
  }

  if (input.maxTriggerHf > MAX_TARGET_HF) {
    return {
      valid: false,
      error: `Max trigger HF cannot exceed ${MAX_TARGET_HF.toFixed(2)}`,
    };
  }

  return { valid: true };
}

export interface TriggerBandArgs {
  minTriggerHf: number;
  maxTriggerHf: number;
  riskAgent: Address;
}

/**
 * Builds contract arguments for setTriggerBand:
 * - optIn = true: passes minTriggerHf, maxTriggerHf, riskAgent
 * - optIn = false: passes riskAgent = 0x0 to reset the band per GuardianCore
 */
export function buildTriggerBandArgs(options: {
  optIn: boolean;
  minTriggerHf?: number;
  maxTriggerHf?: number;
  riskAgent?: Address;
}): TriggerBandArgs {
  if (!options.optIn) {
    return {
      minTriggerHf: 0,
      maxTriggerHf: 0,
      riskAgent: ZERO_ADDRESS,
    };
  }

  return {
    minTriggerHf: options.minTriggerHf ?? 1.1,
    maxTriggerHf: options.maxTriggerHf ?? 1.35,
    riskAgent: options.riskAgent ?? ZERO_ADDRESS,
  };
}

const STORAGE_PREFIX = "tahansoe:v4:trigger-band:";

/**
 * Reads locally saved trigger band config by positionKey.
 */
export function getSavedTriggerBand(positionKey: string): SavedTriggerBand | null {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${positionKey.toLowerCase()}`);
    if (!raw) return null;
    return JSON.parse(raw) as SavedTriggerBand;
  } catch {
    return null;
  }
}

/**
 * Saves trigger band config locally by positionKey.
 */
export function saveTriggerBand(
  positionKey: string,
  data: { minTriggerHf: number; maxTriggerHf: number; riskAgent: Address; enabled: boolean }
): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    const record: SavedTriggerBand = {
      ...data,
      updatedAt: Date.now(),
    };
    window.localStorage.setItem(
      `${STORAGE_PREFIX}${positionKey.toLowerCase()}`,
      JSON.stringify(record)
    );
  } catch {
    // Ignore quota or private mode errors
  }
}

/**
 * Clears saved trigger band config locally by positionKey.
 */
export function clearSavedTriggerBand(positionKey: string): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    window.localStorage.removeItem(`${STORAGE_PREFIX}${positionKey.toLowerCase()}`);
  } catch {
    // Ignore errors
  }
}

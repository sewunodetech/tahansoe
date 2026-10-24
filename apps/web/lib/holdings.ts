import type { Address } from "viem";

export interface HoldingRow {
  symbol: string;
  address: Address | "native";
  decimals: number;
  balance: bigint;
  valueUsd: number | null;
  allowanceToGuardian: bigint | null;
  usedByLayer1: boolean;
}

/**
 * Calculates display USD value from token amount and AaveOracle base price (8 decimals).
 * Returns null if priceBase is null/undefined or non-positive.
 */
export function calculateTokenValueUsd(
  balance: bigint,
  decimals: number,
  priceBase: bigint | null | undefined
): number | null {
  if (priceBase === null || priceBase === undefined || priceBase <= 0n) {
    return null;
  }
  const tokenAmount = Number(balance) / 10 ** decimals;
  const tokenPriceUsd = Number(priceBase) / 1e8;
  return tokenAmount * tokenPriceUsd;
}

export interface CalculateL1CapacityParams {
  balance: bigint;
  allowance: bigint;
  maxRepayPerAction: bigint | null | undefined;
  decimals: number;
  priceBase: bigint | null | undefined;
  policyEnabled?: boolean;
}

/**
 * l1CapacityUsd = min(balance, allowance, policy.maxRepayPerAction) of the policy debt asset, valued in USD;
 * null when there is no policy or policy is disabled.
 */
export function calculateL1CapacityUsd({
  balance,
  allowance,
  maxRepayPerAction,
  decimals,
  priceBase,
  policyEnabled = true,
}: CalculateL1CapacityParams): number | null {
  if (maxRepayPerAction === null || maxRepayPerAction === undefined || !policyEnabled) {
    return null;
  }
  if (priceBase === null || priceBase === undefined || priceBase <= 0n) {
    return null;
  }

  const cap = [balance, allowance, maxRepayPerAction].reduce(
    (min, cur) => (cur < min ? cur : min),
    balance
  );

  if (cap <= 0n) {
    return 0;
  }

  const tokenAmount = Number(cap) / 10 ** decimals;
  const tokenPriceUsd = Number(priceBase) / 1e8;
  return tokenAmount * tokenPriceUsd;
}

export interface BuildHoldingRowParams {
  symbol: string;
  address: Address | "native";
  decimals: number;
  balance: bigint;
  priceBase: bigint | null | undefined;
  allowanceToGuardian: bigint | null;
  policyDebtAsset?: Address | null;
  policyEnabled?: boolean;
}

/**
 * Builds a single HoldingRow with formatted USD values and Layer 1 usage flag.
 */
export function buildHoldingRow({
  symbol,
  address,
  decimals,
  balance,
  priceBase,
  allowanceToGuardian,
  policyDebtAsset,
  policyEnabled = true,
}: BuildHoldingRowParams): HoldingRow {
  const isDebtAsset =
    address !== "native" &&
    policyDebtAsset !== undefined &&
    policyDebtAsset !== null &&
    address.toLowerCase() === policyDebtAsset.toLowerCase();

  return {
    symbol,
    address,
    decimals,
    balance,
    valueUsd: calculateTokenValueUsd(balance, decimals, priceBase),
    allowanceToGuardian: address === "native" ? null : allowanceToGuardian,
    usedByLayer1: isDebtAsset && policyEnabled,
  };
}

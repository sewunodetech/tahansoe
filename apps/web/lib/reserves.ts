import type { Address } from "viem";
import { parseAbi } from "viem";

export type ReserveKind = "erc4626" | "atoken";

export interface ReserveAsset {
  symbol: string;
  address: Address;
  decimals: number;
}

export interface ReserveState {
  enabled: boolean;
  kind: ReserveKind | null;
  source: Address | null;
  asset: ReserveAsset | null;
  shares: bigint | null;
  assetsValue: bigint | null;
  valueUsd: number | null;
  capPerAction: bigint | null;
  allowance: bigint | null;
  l2CapacityUsd: number | null;
  isLoading: boolean;
  error?: unknown;
}

export const erc4626Abi = parseAbi([
  "function asset() view returns (address)",
  "function convertToAssets(uint256 shares) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

export const aTokenAbi = parseAbi([
  "function UNDERLYING_ASSET_ADDRESS() view returns (address)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

/**
 * Parses Guardian layer2 raw uint8 kind into a typed kind or null.
 * 1 = ERC-4626, 2 = aToken.
 */
export function parseLayer2Kind(rawKind: number | undefined | null): ReserveKind | null {
  if (rawKind === 1) return "erc4626";
  if (rawKind === 2) return "atoken";
  return null;
}

export interface CalculateL2CapacityParams {
  assetsValue: bigint | null | undefined;
  capPerAction: bigint | null | undefined;
  allowance: bigint | null | undefined;
  decimals: number;
  priceBase: bigint | null | undefined;
}

/**
 * l2CapacityUsd = min(assets value, cap per action, allowance) in USD.
 * Returns null if any required parameter is null/undefined or if priceBase is non-positive.
 */
export function calculateL2CapacityUsd({
  assetsValue,
  capPerAction,
  allowance,
  decimals,
  priceBase,
}: CalculateL2CapacityParams): number | null {
  if (
    assetsValue === null ||
    assetsValue === undefined ||
    capPerAction === null ||
    capPerAction === undefined ||
    allowance === null ||
    allowance === undefined
  ) {
    return null;
  }
  if (priceBase === null || priceBase === undefined || priceBase <= 0n) {
    return null;
  }

  const cap = [assetsValue, capPerAction, allowance].reduce(
    (min, cur) => (cur < min ? cur : min),
    assetsValue
  );

  if (cap <= 0n) {
    return 0;
  }

  const tokenAmount = Number(cap) / 10 ** decimals;
  const tokenPriceUsd = Number(priceBase) / 1e8;
  return tokenAmount * tokenPriceUsd;
}

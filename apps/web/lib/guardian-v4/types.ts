import type { Address } from "viem";

export type ProtocolType = "aave-v3" | "morpho-blue";

export interface LivePolicyV4 {
  enabled: boolean;
  triggerHf: number;
  targetHf: number;
  maxRepayPerAction: bigint;
}

export interface LiveLayer2AaveV4 {
  kind: number; // 0 none, 1 ERC4626, 2 aToken
  source: Address;
  maxAssetsPerAction: bigint;
}

export interface LiveLayer3AaveV4 {
  enabled: boolean;
  collateralAsset: Address;
  maxCollateralPerAction: bigint;
  maxSlippageBps: number;
}

export interface LiveLayer2MorphoV4 {
  vault: Address;
  maxAssetsPerAction: bigint;
}

export interface LiveQuoteProtectAaveV4 {
  l1Repay: bigint;
  l2Repay: bigint;
  l3Repay: bigint;
  expectedHf: number;
}

export interface LiveQuoteProtectMorphoV4 {
  l1Repay: bigint;
  l2Repay: bigint;
  expectedHf: number;
}

export interface LiveQuoteFeeV4 {
  eligible: boolean;
  fee: bigint;
}

export interface ProtectedPositionV4 {
  protocol: ProtocolType;
  positionKey: string;
  chainId: number;
  guardianAddress: Address;
  /** Address for Aave debt asset; bytes32 hex string for Morpho marketId. */
  keyIdentifier: Address | `0x${string}`;
  debtSymbol?: string;
  policy: LivePolicyV4;
  layer2Aave?: LiveLayer2AaveV4 | null;
  layer3Aave?: LiveLayer3AaveV4 | null;
  layer2Morpho?: LiveLayer2MorphoV4 | null;
  feeQuote?: LiveQuoteFeeV4 | null;
  effectiveTrigger?: number | null;
  needsProtection?: boolean;
}

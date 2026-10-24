/**
 * ABI Guardian v4 (docs/specs/m4-guardian-v4-per-position.md §3.6).
 *
 * ABI terkunci untuk:
 * - TahansoeGuardianAaveV4 (Aave V3 per (user, debtAsset))
 * - TahansoeGuardianMorpho (Morpho Blue per (user, marketId))
 */

export const tahansoeGuardianAaveV4Abi = [
  {
    type: "constructor",
    inputs: [
      { name: "provider", type: "address" },
      { name: "swapRouter", type: "address" },
      { name: "swapFee", type: "uint24" },
      { name: "treasury", type: "address" },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setPolicy",
    inputs: [
      { name: "debtAsset", type: "address" },
      { name: "triggerHF", type: "uint256" },
      { name: "targetHF", type: "uint256" },
      { name: "maxRepayPerAction", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "disablePolicy",
    inputs: [{ name: "debtAsset", type: "address" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setLayer2",
    inputs: [
      { name: "debtAsset", type: "address" },
      { name: "kind", type: "uint8" },
      { name: "source", type: "address" },
      { name: "maxAssetsPerAction", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setLayer3",
    inputs: [
      { name: "debtAsset", type: "address" },
      { name: "enabled", type: "bool" },
      { name: "collateralAsset", type: "address" },
      { name: "maxCollateralPerAction", type: "uint256" },
      { name: "maxSlippageBps", type: "uint16" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setTriggerBand",
    inputs: [
      { name: "debtAsset", type: "address" },
      { name: "minTriggerHF", type: "uint256" },
      { name: "maxTriggerHF", type: "uint256" },
      { name: "riskAgent", type: "address" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setDynamicTrigger",
    inputs: [
      { name: "user", type: "address" },
      { name: "debtAsset", type: "address" },
      { name: "triggerHF", type: "uint256" },
      { name: "validUntil", type: "uint64" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setDebtPriority",
    inputs: [{ name: "debtAssets", type: "address[]" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "policyOf",
    inputs: [
      { name: "user", type: "address" },
      { name: "debtAsset", type: "address" },
    ],
    outputs: [
      { name: "enabled", type: "bool" },
      { name: "triggerHF", type: "uint256" },
      { name: "targetHF", type: "uint256" },
      { name: "maxRepayPerAction", type: "uint256" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "layer2Of",
    inputs: [
      { name: "user", type: "address" },
      { name: "debtAsset", type: "address" },
    ],
    outputs: [
      { name: "kind", type: "uint8" },
      { name: "source", type: "address" },
      { name: "maxAssetsPerAction", type: "uint256" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "layer3Of",
    inputs: [
      { name: "user", type: "address" },
      { name: "debtAsset", type: "address" },
    ],
    outputs: [
      { name: "enabled", type: "bool" },
      { name: "collateralAsset", type: "address" },
      { name: "maxCollateralPerAction", type: "uint256" },
      { name: "maxSlippageBps", type: "uint16" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "debtAssetsOf",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "address[]" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "healthFactor",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "effectiveTrigger",
    inputs: [
      { name: "user", type: "address" },
      { name: "debtAsset", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "needsProtection",
    inputs: [
      { name: "user", type: "address" },
      { name: "debtAsset", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "quoteProtect",
    inputs: [
      { name: "user", type: "address" },
      { name: "debtAsset", type: "address" },
    ],
    outputs: [
      { name: "l1Repay", type: "uint256" },
      { name: "l2Repay", type: "uint256" },
      { name: "l3Repay", type: "uint256" },
      { name: "expectedHf", type: "uint256" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "quoteFee",
    inputs: [
      { name: "user", type: "address" },
      { name: "debtAsset", type: "address" },
    ],
    outputs: [
      { name: "eligible", type: "bool" },
      { name: "fee", type: "uint256" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "positionCount",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "positionsPage",
    inputs: [
      { name: "offset", type: "uint256" },
      { name: "limit", type: "uint256" },
    ],
    outputs: [
      { name: "users", type: "address[]" },
      { name: "debtAssets", type: "address[]" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "protect",
    inputs: [
      { name: "user", type: "address" },
      { name: "debtAsset", type: "address" },
    ],
    outputs: [{ name: "repaid", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    name: "PolicySet",
    inputs: [
      { indexed: true, name: "user", type: "address" },
      { indexed: true, name: "debtAsset", type: "address" },
      { indexed: false, name: "triggerHF", type: "uint256" },
      { indexed: false, name: "targetHF", type: "uint256" },
      { indexed: false, name: "maxRepayPerAction", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "PolicyDisabled",
    inputs: [
      { indexed: true, name: "user", type: "address" },
      { indexed: true, name: "debtAsset", type: "address" },
    ],
  },
  {
    type: "event",
    name: "LayerUsed",
    inputs: [
      { indexed: true, name: "user", type: "address" },
      { indexed: true, name: "debtAsset", type: "address" },
      { indexed: true, name: "layer", type: "uint8" },
      { indexed: false, name: "amountIn", type: "uint256" },
      { indexed: false, name: "debtRepaid", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "Protected",
    inputs: [
      { indexed: true, name: "user", type: "address" },
      { indexed: true, name: "debtAsset", type: "address" },
      { indexed: true, name: "caller", type: "address" },
      { indexed: false, name: "repaid", type: "uint256" },
      { indexed: false, name: "healthFactorBefore", type: "uint256" },
      { indexed: false, name: "healthFactorAfter", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "FeeCharged",
    inputs: [
      { indexed: true, name: "user", type: "address" },
      { indexed: true, name: "debtAsset", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
      { indexed: false, name: "waived", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "DynamicTriggerSet",
    inputs: [
      { indexed: true, name: "user", type: "address" },
      { indexed: true, name: "debtAsset", type: "address" },
      { indexed: false, name: "agent", type: "address" },
      { indexed: false, name: "triggerHF", type: "uint256" },
      { indexed: false, name: "validUntil", type: "uint64" },
    ],
  },
] as const;

export const tahansoeGuardianMorphoAbi = [
  {
    type: "constructor",
    inputs: [
      { name: "morpho", type: "address" },
      { name: "treasury", type: "address" },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setPolicy",
    inputs: [
      { name: "marketId", type: "bytes32" },
      { name: "triggerHF", type: "uint256" },
      { name: "targetHF", type: "uint256" },
      { name: "maxRepayPerAction", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "disablePolicy",
    inputs: [{ name: "marketId", type: "bytes32" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setLayer2",
    inputs: [
      { name: "marketId", type: "bytes32" },
      { name: "vault", type: "address" },
      { name: "maxAssetsPerAction", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setTriggerBand",
    inputs: [
      { name: "marketId", type: "bytes32" },
      { name: "minTriggerHF", type: "uint256" },
      { name: "maxTriggerHF", type: "uint256" },
      { name: "riskAgent", type: "address" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setDynamicTrigger",
    inputs: [
      { name: "user", type: "address" },
      { name: "marketId", type: "bytes32" },
      { name: "triggerHF", type: "uint256" },
      { name: "validUntil", type: "uint64" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "policyOf",
    inputs: [
      { name: "user", type: "address" },
      { name: "marketId", type: "bytes32" },
    ],
    outputs: [
      { name: "enabled", type: "bool" },
      { name: "triggerHF", type: "uint256" },
      { name: "targetHF", type: "uint256" },
      { name: "maxRepayPerAction", type: "uint256" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "layer2Of",
    inputs: [
      { name: "user", type: "address" },
      { name: "marketId", type: "bytes32" },
    ],
    outputs: [
      { name: "vault", type: "address" },
      { name: "maxAssetsPerAction", type: "uint256" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "marketsOf",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "bytes32[]" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "healthFactor",
    inputs: [
      { name: "user", type: "address" },
      { name: "marketId", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "effectiveTrigger",
    inputs: [
      { name: "user", type: "address" },
      { name: "marketId", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "needsProtection",
    inputs: [
      { name: "user", type: "address" },
      { name: "marketId", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "quoteProtect",
    inputs: [
      { name: "user", type: "address" },
      { name: "marketId", type: "bytes32" },
    ],
    outputs: [
      { name: "l1Repay", type: "uint256" },
      { name: "l2Repay", type: "uint256" },
      { name: "expectedHf", type: "uint256" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "quoteFee",
    inputs: [
      { name: "user", type: "address" },
      { name: "marketId", type: "bytes32" },
    ],
    outputs: [
      { name: "eligible", type: "bool" },
      { name: "fee", type: "uint256" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "positionCount",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "positionsPage",
    inputs: [
      { name: "offset", type: "uint256" },
      { name: "limit", type: "uint256" },
    ],
    outputs: [
      { name: "users", type: "address[]" },
      { name: "marketIds", type: "bytes32[]" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "protect",
    inputs: [
      { name: "user", type: "address" },
      { name: "marketId", type: "bytes32" },
    ],
    outputs: [{ name: "repaid", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    name: "PolicySet",
    inputs: [
      { indexed: true, name: "user", type: "address" },
      { indexed: true, name: "marketId", type: "bytes32" },
      { indexed: false, name: "triggerHF", type: "uint256" },
      { indexed: false, name: "targetHF", type: "uint256" },
      { indexed: false, name: "maxRepayPerAction", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "PolicyDisabled",
    inputs: [
      { indexed: true, name: "user", type: "address" },
      { indexed: true, name: "marketId", type: "bytes32" },
    ],
  },
  {
    type: "event",
    name: "LayerUsed",
    inputs: [
      { indexed: true, name: "user", type: "address" },
      { indexed: true, name: "marketId", type: "bytes32" },
      { indexed: true, name: "layer", type: "uint8" },
      { indexed: false, name: "amountIn", type: "uint256" },
      { indexed: false, name: "debtRepaid", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "Protected",
    inputs: [
      { indexed: true, name: "user", type: "address" },
      { indexed: true, name: "marketId", type: "bytes32" },
      { indexed: true, name: "caller", type: "address" },
      { indexed: false, name: "repaid", type: "uint256" },
      { indexed: false, name: "healthFactorBefore", type: "uint256" },
      { indexed: false, name: "healthFactorAfter", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "FeeCharged",
    inputs: [
      { indexed: true, name: "user", type: "address" },
      { indexed: true, name: "marketId", type: "bytes32" },
      { indexed: false, name: "amount", type: "uint256" },
      { indexed: false, name: "waived", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "DynamicTriggerSet",
    inputs: [
      { indexed: true, name: "user", type: "address" },
      { indexed: true, name: "marketId", type: "bytes32" },
      { indexed: false, name: "agent", type: "address" },
      { indexed: false, name: "triggerHF", type: "uint256" },
      { indexed: false, name: "validUntil", type: "uint64" },
    ],
  },
] as const;

// Aliases for convenience across consumers
export const guardianAaveV4Abi = tahansoeGuardianAaveV4Abi;
export const guardianMorphoAbi = tahansoeGuardianMorphoAbi;
export const TahansoeGuardianAaveV4Abi = tahansoeGuardianAaveV4Abi;
export const TahansoeGuardianMorphoAbi = tahansoeGuardianMorphoAbi;

export type TahansoeGuardianAaveV4Abi = typeof tahansoeGuardianAaveV4Abi;
export type TahansoeGuardianMorphoAbi = typeof tahansoeGuardianMorphoAbi;

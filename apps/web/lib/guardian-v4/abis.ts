/**
 * LOCKED ABI for Guardian v4 (spec docs/specs/m4-guardian-v4-per-position.md §3.6).
 *
 * TODO: When Task B is merged into @tahansoe/domain, import from @tahansoe/domain instead.
 */

export const guardianAaveV4Abi = [
  {
    type: "function",
    name: "setPolicy",
    stateMutability: "nonpayable",
    inputs: [
      { name: "debtAsset", type: "address" },
      { name: "triggerHF", type: "uint256" },
      { name: "targetHF", type: "uint256" },
      { name: "maxRepayPerAction", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "disablePolicy",
    stateMutability: "nonpayable",
    inputs: [{ name: "debtAsset", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "setLayer2",
    stateMutability: "nonpayable",
    inputs: [
      { name: "debtAsset", type: "address" },
      { name: "kind", type: "uint8" },
      { name: "source", type: "address" },
      { name: "maxAssetsPerAction", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setLayer3",
    stateMutability: "nonpayable",
    inputs: [
      { name: "debtAsset", type: "address" },
      { name: "enabled", type: "bool" },
      { name: "collateralAsset", type: "address" },
      { name: "maxCollateralPerAction", type: "uint256" },
      { name: "maxSlippageBps", type: "uint16" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setTriggerBand",
    stateMutability: "nonpayable",
    inputs: [
      { name: "debtAsset", type: "address" },
      { name: "minTriggerHF", type: "uint256" },
      { name: "maxTriggerHF", type: "uint256" },
      { name: "riskAgent", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setDynamicTrigger",
    stateMutability: "nonpayable",
    inputs: [
      { name: "user", type: "address" },
      { name: "debtAsset", type: "address" },
      { name: "triggerHF", type: "uint256" },
      { name: "validUntil", type: "uint64" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setDebtPriority",
    stateMutability: "nonpayable",
    inputs: [{ name: "debtAssets", type: "address[]" }],
    outputs: [],
  },
  {
    type: "function",
    name: "policyOf",
    stateMutability: "view",
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
  },
  {
    type: "function",
    name: "layer2Of",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "debtAsset", type: "address" },
    ],
    outputs: [
      { name: "kind", type: "uint8" },
      { name: "source", type: "address" },
      { name: "maxAssetsPerAction", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "layer3Of",
    stateMutability: "view",
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
  },
  {
    type: "function",
    name: "debtAssetsOf",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "address[]" }],
  },
  {
    type: "function",
    name: "healthFactor",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "effectiveTrigger",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "debtAsset", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "needsProtection",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "debtAsset", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "quoteProtect",
    stateMutability: "view",
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
  },
  {
    type: "function",
    name: "quoteFee",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "debtAsset", type: "address" },
    ],
    outputs: [
      { name: "eligible", type: "bool" },
      { name: "fee", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "positionCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "positionsPage",
    stateMutability: "view",
    inputs: [
      { name: "offset", type: "uint256" },
      { name: "limit", type: "uint256" },
    ],
    outputs: [
      { name: "users", type: "address[]" },
      { name: "debtAssets", type: "address[]" },
    ],
  },
  {
    type: "function",
    name: "protect",
    stateMutability: "nonpayable",
    inputs: [
      { name: "user", type: "address" },
      { name: "debtAsset", type: "address" },
    ],
    outputs: [{ name: "repaid", type: "uint256" }],
  },
  {
    type: "event",
    name: "PolicySet",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "debtAsset", type: "address", indexed: true },
      { name: "triggerHF", type: "uint256", indexed: false },
      { name: "targetHF", type: "uint256", indexed: false },
      { name: "maxRepayPerAction", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "PolicyDisabled",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "debtAsset", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "LayerUsed",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "debtAsset", type: "address", indexed: true },
      { name: "layer", type: "uint8", indexed: true },
      { name: "amountIn", type: "uint256", indexed: false },
      { name: "debtRepaid", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Protected",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "debtAsset", type: "address", indexed: true },
      { name: "caller", type: "address", indexed: true },
      { name: "repaid", type: "uint256", indexed: false },
      { name: "healthFactorBefore", type: "uint256", indexed: false },
      { name: "healthFactorAfter", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "FeeCharged",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "debtAsset", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "waived", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "DynamicTriggerSet",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "debtAsset", type: "address", indexed: true },
      { name: "agent", type: "address", indexed: false },
      { name: "triggerHF", type: "uint256", indexed: false },
      { name: "validUntil", type: "uint64", indexed: false },
    ],
  },
] as const;

export const guardianMorphoAbi = [
  {
    type: "function",
    name: "setPolicy",
    stateMutability: "nonpayable",
    inputs: [
      { name: "marketId", type: "bytes32" },
      { name: "triggerHF", type: "uint256" },
      { name: "targetHF", type: "uint256" },
      { name: "maxRepayPerAction", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "disablePolicy",
    stateMutability: "nonpayable",
    inputs: [{ name: "marketId", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "setLayer2",
    stateMutability: "nonpayable",
    inputs: [
      { name: "marketId", type: "bytes32" },
      { name: "vault", type: "address" },
      { name: "maxAssetsPerAction", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setTriggerBand",
    stateMutability: "nonpayable",
    inputs: [
      { name: "marketId", type: "bytes32" },
      { name: "minTriggerHF", type: "uint256" },
      { name: "maxTriggerHF", type: "uint256" },
      { name: "riskAgent", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setDynamicTrigger",
    stateMutability: "nonpayable",
    inputs: [
      { name: "user", type: "address" },
      { name: "marketId", type: "bytes32" },
      { name: "triggerHF", type: "uint256" },
      { name: "validUntil", type: "uint64" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "policyOf",
    stateMutability: "view",
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
  },
  {
    type: "function",
    name: "layer2Of",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "marketId", type: "bytes32" },
    ],
    outputs: [
      { name: "vault", type: "address" },
      { name: "maxAssetsPerAction", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "marketsOf",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "bytes32[]" }],
  },
  {
    type: "function",
    name: "healthFactor",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "marketId", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "effectiveTrigger",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "marketId", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "needsProtection",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "marketId", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "quoteProtect",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "marketId", type: "bytes32" },
    ],
    outputs: [
      { name: "l1Repay", type: "uint256" },
      { name: "l2Repay", type: "uint256" },
      { name: "expectedHf", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "quoteFee",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "marketId", type: "bytes32" },
    ],
    outputs: [
      { name: "eligible", type: "bool" },
      { name: "fee", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "positionCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "positionsPage",
    stateMutability: "view",
    inputs: [
      { name: "offset", type: "uint256" },
      { name: "limit", type: "uint256" },
    ],
    outputs: [
      { name: "users", type: "address[]" },
      { name: "marketIds", type: "bytes32[]" },
    ],
  },
  {
    type: "function",
    name: "protect",
    stateMutability: "nonpayable",
    inputs: [
      { name: "user", type: "address" },
      { name: "marketId", type: "bytes32" },
    ],
    outputs: [{ name: "repaid", type: "uint256" }],
  },
  {
    type: "event",
    name: "PolicySet",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "marketId", type: "bytes32", indexed: true },
      { name: "triggerHF", type: "uint256", indexed: false },
      { name: "targetHF", type: "uint256", indexed: false },
      { name: "maxRepayPerAction", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "PolicyDisabled",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "marketId", type: "bytes32", indexed: true },
    ],
  },
  {
    type: "event",
    name: "LayerUsed",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "marketId", type: "bytes32", indexed: true },
      { name: "layer", type: "uint8", indexed: true },
      { name: "amountIn", type: "uint256", indexed: false },
      { name: "debtRepaid", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Protected",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "marketId", type: "bytes32", indexed: true },
      { name: "caller", type: "address", indexed: true },
      { name: "repaid", type: "uint256", indexed: false },
      { name: "healthFactorBefore", type: "uint256", indexed: false },
      { name: "healthFactorAfter", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "FeeCharged",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "marketId", type: "bytes32", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "waived", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "DynamicTriggerSet",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "marketId", type: "bytes32", indexed: true },
      { name: "agent", type: "address", indexed: false },
      { name: "triggerHF", type: "uint256", indexed: false },
      { name: "validUntil", type: "uint64", indexed: false },
    ],
  },
] as const;

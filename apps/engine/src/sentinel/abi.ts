import { parseAbi, parseAbiItem } from "viem";

// TODO: switch to @tahansoe/domain ABIs once Task B lands

// ─── Events ──────────────────────────────────────────────────────────────────

// V2/V3 & Shared Aave events
export const policySetEventAbi = parseAbiItem(
  "event PolicySet(address indexed user, address indexed debtAsset, uint256 triggerHF, uint256 targetHF, uint256 maxRepayPerAction)"
);

export const policyDisabledEventAbi = parseAbiItem(
  "event PolicyDisabled(address indexed user)"
);

export const protectedEventAbi = parseAbiItem(
  "event Protected(address indexed user, address indexed debtAsset, address indexed caller, uint256 repaid, uint256 healthFactorBefore, uint256 healthFactorAfter)"
);

export const layer2SetEventAbi = parseAbiItem(
  "event Layer2Set(address indexed user, uint8 kind, address source, uint256 maxAssetsPerAction)"
);

export const layer3SetEventAbi = parseAbiItem(
  "event Layer3Set(address indexed user, bool enabled, address collateralAsset, uint256 maxCollateralPerAction, uint16 maxSlippageBps)"
);

export const triggerBandSetEventAbi = parseAbiItem(
  "event TriggerBandSet(address indexed user, uint256 minTriggerHF, uint256 maxTriggerHF, address riskAgent)"
);

export const dynamicTriggerSetEventAbi = parseAbiItem(
  "event DynamicTriggerSet(address indexed user, address indexed agent, uint256 triggerHF, uint64 validUntil)"
);

// V4 Aave events (spec 3.6)
export const policyDisabledAaveV4EventAbi = parseAbiItem(
  "event PolicyDisabled(address indexed user, address indexed debtAsset)"
);

export const layerUsedAaveV4EventAbi = parseAbiItem(
  "event LayerUsed(address indexed user, address indexed debtAsset, uint8 indexed layer, uint256 amountIn, uint256 debtRepaid)"
);

export const feeChargedAaveEventAbi = parseAbiItem(
  "event FeeCharged(address indexed user, address indexed debtAsset, uint256 amount, uint256 waived)"
);

export const dynamicTriggerSetAaveV4EventAbi = parseAbiItem(
  "event DynamicTriggerSet(address indexed user, address indexed debtAsset, address agent, uint256 triggerHF, uint64 validUntil)"
);

// Morpho Blue events (spec 3.6)
export const policySetMorphoEventAbi = parseAbiItem(
  "event PolicySet(address indexed user, bytes32 indexed marketId, uint256 triggerHF, uint256 targetHF, uint256 maxRepayPerAction)"
);

export const policyDisabledMorphoEventAbi = parseAbiItem(
  "event PolicyDisabled(address indexed user, bytes32 indexed marketId)"
);

export const layerUsedMorphoEventAbi = parseAbiItem(
  "event LayerUsed(address indexed user, bytes32 indexed marketId, uint8 indexed layer, uint256 amountIn, uint256 debtRepaid)"
);

export const protectedMorphoEventAbi = parseAbiItem(
  "event Protected(address indexed user, bytes32 indexed marketId, address indexed caller, uint256 repaid, uint256 healthFactorBefore, uint256 healthFactorAfter)"
);

export const feeChargedMorphoEventAbi = parseAbiItem(
  "event FeeCharged(address indexed user, bytes32 indexed marketId, uint256 amount, uint256 waived)"
);

export const dynamicTriggerSetMorphoEventAbi = parseAbiItem(
  "event DynamicTriggerSet(address indexed user, bytes32 indexed marketId, address agent, uint256 triggerHF, uint64 validUntil)"
);

// ─── Contract ABIs ───────────────────────────────────────────────────────────

export const guardianAbi = parseAbi([
  "function needsProtection(address user) external view returns (bool)",
  "function quoteRepay(address user) external view returns (uint256 amount)",
  "function quoteProtect(address user) external view returns (uint256 l1Repay, uint256 l2Repay, uint256 l3Collateral, uint256 l3Repay, uint256 expectedHF)",
  "function effectiveTrigger(address user) external view returns (uint256)",
  "function healthFactor(address user) external view returns (uint256 hf)",
  "function protect(address user) external returns (uint256)",
]);

export const guardianV2Abi = parseAbi([
  "function needsProtection(address user) external view returns (bool)",
  "function quoteRepay(address user) external view returns (uint256 amount)",
  "function quoteProtect(address user) external view returns (uint256 l1Repay, uint256 l2Repay, uint256 l3Collateral, uint256 l3Repay, uint256 expectedHF)",
  "function effectiveTrigger(address user) external view returns (uint256)",
  "function healthFactor(address user) external view returns (uint256 hf)",
  "function policies(address user) external view returns (bool enabled, address debtAsset, uint256 triggerHF, uint256 targetHF, uint256 maxRepayPerAction)",
  "function usersPage(uint256 offset, uint256 limit) external view returns (address[] memory)",
  "function protect(address user) external returns (uint256)",
]);

export const guardianAaveV4Abi = parseAbi([
  "function setPolicy(address debtAsset, uint256 triggerHF, uint256 targetHF, uint256 maxRepayPerAction) external",
  "function disablePolicy(address debtAsset) external",
  "function setTriggerBand(address debtAsset, uint256 minTriggerHF, uint256 maxTriggerHF, address riskAgent) external",
  "function setDynamicTrigger(address user, address debtAsset, uint256 triggerHF, uint64 validUntil) external",
  "function triggerBandOf(address user, address debtAsset) external view returns (uint256 minTriggerHF, uint256 maxTriggerHF, address riskAgent, uint256 dynamicTriggerHF, uint64 validUntil)",
  "function setDebtPriority(address[] calldata debtAssets) external",
  "function policyOf(address user, address debtAsset) external view returns (bool enabled, uint256 triggerHF, uint256 targetHF, uint256 maxRepayPerAction)",
  "function debtAssetsOf(address user) external view returns (address[] memory)",
  "function healthFactor(address user) external view returns (uint256)",
  "function effectiveTrigger(address user, address debtAsset) external view returns (uint256)",
  "function needsProtection(address user, address debtAsset) external view returns (bool)",
  "function quoteProtect(address user, address debtAsset) external view returns (uint256 l1Repay, uint256 l2Repay, uint256 l3Repay, uint256 expectedHf)",
  "function quoteFee(address user, address debtAsset) external view returns (bool eligible, uint256 fee)",
  "function positionCount() external view returns (uint256)",
  "function positionsPage(uint256 offset, uint256 limit) external view returns (address[] memory users, address[] memory debtAssets)",
  "function protect(address user, address debtAsset) external returns (uint256 repaid)",
]);

export const guardianMorphoAbi = parseAbi([
  "function setPolicy(bytes32 marketId, uint256 triggerHF, uint256 targetHF, uint256 maxRepayPerAction) external",
  "function disablePolicy(bytes32 marketId) external",
  "function setTriggerBand(bytes32 marketId, uint256 minTriggerHF, uint256 maxTriggerHF, address riskAgent) external",
  "function setDynamicTrigger(address user, bytes32 marketId, uint256 triggerHF, uint64 validUntil) external",
  "function triggerBandOf(address user, bytes32 marketId) external view returns (uint256 minTriggerHF, uint256 maxTriggerHF, address riskAgent, uint256 dynamicTriggerHF, uint64 validUntil)",
  "function policyOf(address user, bytes32 marketId) external view returns (bool enabled, uint256 triggerHF, uint256 targetHF, uint256 maxRepayPerAction)",
  "function marketsOf(address user) external view returns (bytes32[] memory)",
  "function healthFactor(address user, bytes32 marketId) external view returns (uint256)",
  "function effectiveTrigger(address user, bytes32 marketId) external view returns (uint256)",
  "function needsProtection(address user, bytes32 marketId) external view returns (bool)",
  "function quoteProtect(address user, bytes32 marketId) external view returns (uint256 l1Repay, uint256 l2Repay, uint256 expectedHf)",
  "function quoteFee(address user, bytes32 marketId) external view returns (bool eligible, uint256 fee)",
  "function positionCount() external view returns (uint256)",
  "function positionsPage(uint256 offset, uint256 limit) external view returns (address[] memory users, bytes32[] memory marketIds)",
  "function protect(address user, bytes32 marketId) external returns (uint256 repaid)",
]);

export const aavePoolAbi = parseAbi([
  "function getUserAccountData(address user) external view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)",
]);

export const erc20Abi = parseAbi([
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
]);

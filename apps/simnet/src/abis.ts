/** ABI fragments simnet needs. Kept narrow on purpose. */

import { parseAbi } from "viem";

/**
 * SimPriceFeed (contracts/src/testnet/SimPriceFeed.sol, Task A). Locked interface:
 * decimals() = 8; `setAnswer` is callable only by the immutable updater (the deployer)
 * and bumps roundId/updatedAt/startedAt.
 */
export const simPriceFeedAbi = parseAbi([
  "function decimals() view returns (uint8)",
  "function setAnswer(int256 answer)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);
export const SIM_FEED_DECIMALS = 8;

export const chainlinkAggregatorAbi = parseAbi([
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);

export const guardianAbi = parseAbi([
  "function userCount() view returns (uint256)",
  "function usersPage(uint256 offset, uint256 limit) view returns (address[])",
  "function needsProtection(address user) view returns (bool)",
  "function protect(address user) returns (uint256 totalRepaid)",
  "function policyOf(address user) view returns (bool enabled, uint256 triggerHF, uint256 targetHF, uint256 maxRepayPerAction)",
  "function triggerBands(address user) view returns (uint256 minTriggerHF, uint256 maxTriggerHF, address riskAgent, uint256 dynamicTriggerHF, uint64 validUntil)",
  "function effectiveTrigger(address user) view returns (uint256)",
  "function setTriggerBand(uint256 minTriggerHF, uint256 maxTriggerHF, address riskAgent)",
  "function setDynamicTrigger(address user, uint256 triggerHF, uint64 validUntil)",
  "event LayerUsed(address indexed user, uint8 indexed layer, uint256 amountIn, uint256 debtRepaid)",
  "event Protected(address indexed user, address indexed debtAsset, address indexed caller, uint256 repaid, uint256 healthFactorBefore, uint256 healthFactorAfter)",
  // Guardian v3 (docs/specs/m4-guardian-success-fee.md); absent on v2, decoded when present.
  "event FeeCharged(address indexed user, address indexed debtAsset, uint256 amount, uint256 waived)",
  "event DynamicTriggerSet(address indexed user, address agent, uint256 triggerHF, uint64 validUntil)",
]);

export const guardianAaveV4Abi = parseAbi([
  "function positionCount() view returns (uint256)",
  "function positionsPage(uint256 offset, uint256 limit) view returns (address[] users, address[] debtAssets)",
  "function debtAssetsOf(address user) view returns (address[])",
  "function needsProtection(address user, address debtAsset) view returns (bool)",
  "function protect(address user, address debtAsset) returns (uint256 repaid)",
  "function policyOf(address user, address debtAsset) view returns (bool enabled, uint256 triggerHF, uint256 targetHF, uint256 maxRepayPerAction)",
  "function effectiveTrigger(address user, address debtAsset) view returns (uint256)",
  "function setTriggerBand(address debtAsset, uint256 minTriggerHF, uint256 maxTriggerHF, address riskAgent)",
  "function setDynamicTrigger(address user, address debtAsset, uint256 triggerHF, uint64 validUntil)",
  "event LayerUsed(address indexed user, address indexed debtAsset, uint8 indexed layer, uint256 amountIn, uint256 debtRepaid)",
  "event Protected(address indexed user, address indexed debtAsset, address indexed caller, uint256 repaid, uint256 healthFactorBefore, uint256 healthFactorAfter)",
  "event FeeCharged(address indexed user, address indexed debtAsset, uint256 amount, uint256 waived)",
  "event DynamicTriggerSet(address indexed user, address indexed debtAsset, address agent, uint256 triggerHF, uint64 validUntil)",
]);

export const guardianMorphoAbi = parseAbi([
  "function positionCount() view returns (uint256)",
  "function positionsPage(uint256 offset, uint256 limit) view returns (address[] users, bytes32[] marketIds)",
  "function marketsOf(address user) view returns (bytes32[])",
  "function needsProtection(address user, bytes32 marketId) view returns (bool)",
  "function protect(address user, bytes32 marketId) returns (uint256 repaid)",
  "function policyOf(address user, bytes32 marketId) view returns (bool enabled, uint256 triggerHF, uint256 targetHF, uint256 maxRepayPerAction)",
  "function effectiveTrigger(address user, bytes32 marketId) view returns (uint256)",
  "function setTriggerBand(bytes32 marketId, uint256 minTriggerHF, uint256 maxTriggerHF, address riskAgent)",
  "function setDynamicTrigger(address user, bytes32 marketId, uint256 triggerHF, uint64 validUntil)",
  "event LayerUsed(address indexed user, bytes32 indexed marketId, uint8 indexed layer, uint256 amountIn, uint256 debtRepaid)",
  "event Protected(address indexed user, bytes32 indexed marketId, address indexed caller, uint256 repaid, uint256 healthFactorBefore, uint256 healthFactorAfter)",
  "event FeeCharged(address indexed user, bytes32 indexed marketId, uint256 amount, uint256 waived)",
  "event DynamicTriggerSet(address indexed user, bytes32 indexed marketId, address agent, uint256 triggerHF, uint64 validUntil)",
]);

export const poolAddressesProviderAbi = parseAbi([
  "function getACLManager() view returns (address)",
  "function getACLAdmin() view returns (address)",
  "function getPriceOracle() view returns (address)",
]);

export const aclManagerAbi = parseAbi([
  "function isPoolAdmin(address admin) view returns (bool)",
  "function isAssetListingAdmin(address admin) view returns (bool)",
  "function addPoolAdmin(address admin)",
]);

export const aaveOracleAbi = parseAbi([
  "function setAssetSources(address[] assets, address[] sources)",
  "function getSourceOfAsset(address asset) view returns (address)",
  "function getAssetPrice(address asset) view returns (uint256)",
]);

export const erc20Abi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
]);

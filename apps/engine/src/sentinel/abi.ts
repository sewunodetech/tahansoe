import { parseAbi, parseAbiItem } from "viem";

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

export const guardianAbi = parseAbi([
  "function needsProtection(address user) external view returns (bool)",
  "function quoteRepay(address user) external view returns (uint256 amount)",
  "function quoteProtect(address user) external view returns (uint256 l1Repay, uint256 l2Repay, uint256 l3Collateral, uint256 l3Repay, uint256 expectedHF)",
  "function effectiveTrigger(address user) external view returns (uint256)",
  "function healthFactor(address user) external view returns (uint256 hf)",
  "function protect(address user) external returns (uint256)",
]);

export const aavePoolAbi = parseAbi([
  "function getUserAccountData(address user) external view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)",
]);

export const erc20Abi = parseAbi([
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
]);

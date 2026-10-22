import { arbitrumSepolia } from "wagmi/chains";
import { ARBITRUM_SEPOLIA, currentGuardian, legacyGuardians, type Address } from "@tahansoe/domain";

export { guardianAbi } from "./guardian-abi";
export { guardianV2Abi } from "./guardian-v2-abi";


/** Chain the live dashboard runs on until mainnet. */
export const LIVE_CHAIN = arbitrumSepolia;
export const LIVE_CHAIN_CONFIG = ARBITRUM_SEPOLIA;

export const AAVE_POOL = ARBITRUM_SEPOLIA.aave!.pool!;
export const AAVE_ORACLE = ARBITRUM_SEPOLIA.aave!.oracle!;

/** Guardian every new policy goes to. */
export const GUARDIAN = currentGuardian(ARBITRUM_SEPOLIA)!;
/** Older Guardian versions a user may still have a policy or allowance on. */
export const LEGACY_GUARDIANS = legacyGuardians(ARBITRUM_SEPOLIA);

export interface DebtAsset {
  symbol: string;
  address: Address;
  decimals: number;
}

/** Token decimals of the Arbitrum Sepolia reserves (read on-chain 22 Oct 2026). */
const DECIMALS: Record<string, number> = { USDC: 6, WETH: 18 };

/** Aave reserves a policy can repay with. */
export const DEBT_ASSETS: DebtAsset[] = Object.entries(ARBITRUM_SEPOLIA.tokens ?? {}).map(([symbol, address]) => ({
  symbol,
  address,
  decimals: DECIMALS[symbol] ?? 18,
}));

export function debtAssetSymbol(address: string | undefined): string {
  return DEBT_ASSETS.find((a) => a.address.toLowerCase() === address?.toLowerCase())?.symbol ?? "token";
}

export function explorerTx(hash: string): string {
  return `${ARBITRUM_SEPOLIA.explorer}/tx/${hash}`;
}

export function explorerAddress(address: string): string {
  return `${ARBITRUM_SEPOLIA.explorer}/address/${address}`;
}

export const aavePoolAbi = [
  {
    type: "function",
    name: "getUserAccountData",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [
      { name: "totalCollateralBase", type: "uint256" },
      { name: "totalDebtBase", type: "uint256" },
      { name: "availableBorrowsBase", type: "uint256" },
      { name: "currentLiquidationThreshold", type: "uint256" },
      { name: "ltv", type: "uint256" },
      { name: "healthFactor", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "getReserveData",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "configuration", type: "uint256" },
          { name: "liquidityIndex", type: "uint128" },
          { name: "currentLiquidityRate", type: "uint128" },
          { name: "variableBorrowIndex", type: "uint128" },
          { name: "currentVariableBorrowRate", type: "uint128" },
          { name: "currentStableBorrowRate", type: "uint128" },
          { name: "lastUpdateTimestamp", type: "uint40" },
          { name: "id", type: "uint16" },
          { name: "aTokenAddress", type: "address" },
          { name: "stableDebtTokenAddress", type: "address" },
          { name: "variableDebtTokenAddress", type: "address" },
          { name: "interestRateStrategyAddress", type: "address" },
          { name: "accruedToTreasury", type: "uint128" },
          { name: "unbacked", type: "uint128" },
          { name: "isolationModeTotalDebt", type: "uint128" },
        ],
      },
    ],
  },
] as const;

export const aaveOracleAbi = [
  {
    type: "function",
    name: "getAssetPrice",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

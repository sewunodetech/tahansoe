/**
 * Registry konfigurasi chain (docs/architecture.md §4).
 *
 * Mengelompokkan alamat kontrak, oracle, dan feeds per chain.
 * RPC URL tidak di-hardcode di kode; diterima dari parameter atau environment saat runtime.
 */

import type { Address } from "./types";

export interface ChainAaveConfig {
  poolAddressesProvider: Address;
  pool?: Address;
  oracle?: Address;
}

export interface ChainMorphoConfig {
  morpho: Address;
}

export interface ChainConfig {
  chainId: number;
  name: string;
  rpcUrls: string[];                  // dari env, bukan hardcode di kode
  blockTimeMs: number;
  aave?: ChainAaveConfig;
  morpho?: ChainMorphoConfig;
  guardian?: Address;
  sequencerUptimeFeed?: Address;      // wajib untuk L2
  priceFeeds: Record<string, Address>;
  tokens?: Record<string, Address>;   // alamat token ERC-20 (bukan price feed)
  explorer: string;
}

/**
 * Arbitrum Sepolia (testnet aktif saat ini).
 * Sumber: contracts/README.md & contracts/script/Deploy.s.sol.
 */
export const ARBITRUM_SEPOLIA: ChainConfig = {
  chainId: 421614,
  name: "Arbitrum Sepolia",
  rpcUrls: [],
  blockTimeMs: 250,
  aave: {
    poolAddressesProvider: "0xB25a5D144626a0D488e52AE717A051a2E9997076",
    pool: "0xBfC91D59fdAA134A4ED45f7B584cAf96D7792Eff",
  },
  guardian: "0x1A5D249A8e711E2288AdD7c01e31Eb7FFB05D97E",
  priceFeeds: {},
  explorer: "https://sepolia.arbiscan.io",
};

/**
 * Arbitrum One (mainnet).
 * Sumber: docs/knowledge/risk-transmission.md §4 (diverifikasi on-chain 8 Okt 2026).
 */
export const ARBITRUM_ONE: ChainConfig = {
  chainId: 42161,
  name: "Arbitrum One",
  rpcUrls: [],
  blockTimeMs: 250,
  aave: {
    poolAddressesProvider: "0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb",
    pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
    oracle: "0xb56c2F0B653B2e0b10C9b928C8580Ac5Df02C7C7",
  },
  sequencerUptimeFeed: "0xFdB631F5EE196F0ed6FAa767959853A9F217697D",
  priceFeeds: {
    "ETH/USD": "0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612",
    "USDC/USD": "0x50834F3163758fcC1Df9973b6e91f0F0F0434aD3",
    "USDT/USD": "0x3f3f5dF88dC9F13eac63DF89EC16ef6e7E25DdE7",
    "AaveOracle:WETH": "0xbd41b1548a5a06544cbcf87c0c54864312842c00",
    "AaveOracle:USDC": "0xb0c9a7122aab68f75cffd9851e867144dbff113b",
  },
  tokens: {
    WETH: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
    USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    /** USDC bridged (simbol on-chain juga "USDC"); dibedakan lewat alamat. */
    "USDC.e": "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8",
    /** USDT (kini USDT0; simbol on-chain "USD₮0"). */
    USDT: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
  },
  explorer: "https://arbiscan.io",
};

export const SUPPORTED_CHAINS: readonly ChainConfig[] = [
  ARBITRUM_SEPOLIA,
  ARBITRUM_ONE,
] as const;

export const CHAINS: Record<number, ChainConfig> = {
  [ARBITRUM_SEPOLIA.chainId]: ARBITRUM_SEPOLIA,
  [ARBITRUM_ONE.chainId]: ARBITRUM_ONE,
};

/**
 * Mengambil ChainConfig berdasarkan chainId.
 * Jika rpcUrls diberikan (dari parameter pemanggil atau env), rpcUrls akan diisi ke konfigurasi yang dikembalikan.
 *
 * @param chainId ID chain target
 * @param rpcUrls URL RPC opsional (satu string atau array string)
 * @returns Salinan konfigurasi chain atau undefined jika chainId tidak dikenali
 */
export function getChainConfig(
  chainId: number,
  rpcUrls: string | string[] = []
): ChainConfig | undefined {
  const base = CHAINS[chainId];
  if (!base) return undefined;

  const urls = typeof rpcUrls === "string" ? (rpcUrls ? [rpcUrls] : []) : [...rpcUrls];
  return {
    ...base,
    rpcUrls: urls,
  };
}

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

/**
 * Satu deployment TahansoeGuardian. Guardian immutable tanpa admin (security.md I2),
 * jadi "update" = deploy versi baru lalu user migrasi: disablePolicy + approve 0 di
 * versi lama, approve + setPolicy di versi baru. Versi lama tetap dicantumkan agar
 * UI bisa menemukan policy dan allowance yang masih aktif di sana.
 */
export interface GuardianFeatures {
  layer2?: boolean;
  layer3?: boolean;
  triggerBand?: boolean;
}

export interface GuardianDeployment {
  version: number;
  address: Address;
  /** Block deploy; batas bawah pencarian event. */
  deployedBlock: number;
  features?: GuardianFeatures;
  /** Protokol lending target (default: "aave-v3"). */
  protocol?: "aave-v3" | "morpho-blue";
}

export interface ChainMorphoConfig {
  /** Singleton Morpho Blue. */
  blue: Address;
  /** Block deploy Morpho Blue; batas bawah pemindaian event. */
  deployedBlock?: number;
}

/** Registry ERC-8004 Trustless Agents (ADR 0017). Validation Registry belum dipakai. */
export interface ChainErc8004Config {
  identity: Address;
  reputation: Address;
}

export interface ChainConfig {
  chainId: number;
  name: string;
  isSimulation?: boolean;
  rpcUrls: string[];                  // dari env, bukan hardcode di kode
  blockTimeMs: number;
  aave?: ChainAaveConfig;
  morpho?: ChainMorphoConfig;
  erc8004?: ChainErc8004Config;
  /** Guardian klasik (v1–v3, satu policy per user) versi tertinggi. Guardian v4 hanya di `guardians`. */
  guardian?: Address;
  /** Semua deployment Guardian, lama dan baru. */
  guardians?: GuardianDeployment[];
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
    oracle: "0xEf95A6B9e88Bd509Fd67BA741cf2b263DaC65c00",
  },
  guardian: "0x1A5D249A8e711E2288AdD7c01e31Eb7FFB05D97E",
  /** Diverifikasi on-chain 25 Okt 2026 (`name()` = "AgentIdentity"; Reputation → Identity). */
  erc8004: {
    identity: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    reputation: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
  },
  guardians: [
    { version: 1, address: "0x1A5D249A8e711E2288AdD7c01e31Eb7FFB05D97E", deployedBlock: 313944170 },
    /** TahansoeGuardianAaveV4, deploy & verify 25 Okt 2026 (contracts/broadcast/DeployAaveV4.s.sol). */
    {
      version: 4,
      address: "0xa7Bbab6366a723e17cd2f220D708757e449571b4",
      deployedBlock: 322451784,
      protocol: "aave-v3",
      features: { layer2: true, layer3: true, triggerBand: true },
    },
  ],
  priceFeeds: {},
  /** Reserve Aave V3 testnet (Pool.getReservesList, diverifikasi on-chain 22 Okt 2026). */
  tokens: {
    USDC: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
    WETH: "0x1dF462e2712496373A347f8ad10802a5E95f053D",
  },
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
  /**
   * Sumber: docs.morpho.org/addresses (24 Okt 2026). eth_getCode di arb1.arbitrum.io
   * tidak kosong (24 Okt 2026); log pertama kontrak ada di block 296446593.
   */
  /** Diverifikasi on-chain 25 Okt 2026 (`name()` = "AgentIdentity"; Reputation → Identity). */
  erc8004: {
    identity: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
    reputation: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63",
  },
  morpho: {
    blue: "0x6c247b1F6182318877311737BaC0844bAa518F5e",
    deployedBlock: 296446593,
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
    DAI: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
    GHO: "0x7dfF72693f6A4149b17e7C6314655f6A9F7c8B33",
  },
  explorer: "https://arbiscan.io",
};

/**
 * Arbitrum One Simulation (fork anvil lokal/VPS).
 * Sumber: docs/specs/m1-simulation-mode.md §3.2 & ADR 0014.
 */
export const ARBITRUM_ONE_SIM: ChainConfig = {
  chainId: 4216199,
  name: "Arbitrum One (Simulation)",
  rpcUrls: [],
  blockTimeMs: 250,
  aave: ARBITRUM_ONE.aave,
  tokens: ARBITRUM_ONE.tokens,
  priceFeeds: ARBITRUM_ONE.priceFeeds,
  guardians: [],
  explorer: "",
  isSimulation: true,
};

export const SUPPORTED_CHAINS: readonly ChainConfig[] = [
  ARBITRUM_SEPOLIA,
  ARBITRUM_ONE,
] as const;

export const CHAINS: Record<number, ChainConfig> = {
  [ARBITRUM_SEPOLIA.chainId]: ARBITRUM_SEPOLIA,
  [ARBITRUM_ONE.chainId]: ARBITRUM_ONE,
  [ARBITRUM_ONE_SIM.chainId]: ARBITRUM_ONE_SIM,
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

/** Semua deployment Guardian untuk protokol tertentu pada chain. */
export function guardiansFor(
  chain: ChainConfig,
  protocol: "aave-v3" | "morpho-blue"
): GuardianDeployment[] {
  return (chain.guardians ?? []).filter(
    (g) => (g.protocol ?? "aave-v3") === protocol
  );
}

/**
 * Guardian versi tertinggi untuk protokol tertentu pada suatu chain, atau undefined jika belum ada deployment.
 */
export function latestGuardian(
  chain: ChainConfig,
  protocol: "aave-v3" | "morpho-blue"
): GuardianDeployment | undefined {
  const list = guardiansFor(chain, protocol);
  return list.reduce<GuardianDeployment | undefined>(
    (best, g) => (best === undefined || g.version > best.version ? g : best),
    undefined
  );
}

/** Versi pertama dengan policy per posisi (ADR 0015); ABI-nya berbeda dari v1–v3. */
export const PER_POSITION_GUARDIAN_VERSION = 4;

/** True untuk Guardian v4+ (policy per posisi), yang tidak bisa dipanggil dengan ABI v1–v3. */
export function isPerPositionGuardian(deployment?: GuardianDeployment): boolean {
  return Boolean(deployment && deployment.version >= PER_POSITION_GUARDIAN_VERSION);
}

/** Guardian Aave klasik (v1–v3), yang memakai ABI satu policy per user. */
function classicGuardians(chain: ChainConfig): GuardianDeployment[] {
  return guardiansFor(chain, "aave-v3").filter((g) => !isPerPositionGuardian(g));
}

/**
 * Guardian Aave klasik (v1–v3) versi tertinggi, atau undefined jika belum ada.
 * Guardian v4 sengaja dikecualikan: pemanggil fungsi ini memakai ABI v1–v3.
 * Untuk v4 gunakan `latestGuardian(chain, protocol)`.
 */
export function currentGuardian(chain: ChainConfig): GuardianDeployment | undefined {
  return classicGuardians(chain).reduce<GuardianDeployment | undefined>(
    (best, g) => (best === undefined || g.version > best.version ? g : best),
    undefined
  );
}

/** Guardian Aave klasik selain `currentGuardian` (kandidat migrasi), dari versi terbaru ke terlama. */
export function legacyGuardians(chain: ChainConfig): GuardianDeployment[] {
  const current = currentGuardian(chain);
  return classicGuardians(chain)
    .filter((g) => g !== current)
    .sort((a, b) => b.version - a.version);
}

/** Memeriksa apakah suatu deployment Guardian mendukung fitur v2 (Layer 2, Layer 3, trigger band). */
export function isGuardianV2(deployment?: GuardianDeployment): boolean {
  if (!deployment) return false;
  return deployment.version >= 2 || Boolean(deployment.features?.layer2 || deployment.features?.layer3);
}

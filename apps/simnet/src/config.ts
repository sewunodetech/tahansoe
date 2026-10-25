/**
 * Simnet configuration (docs/specs/m1-simulation-mode.md §3.10).
 *
 * Addresses come from the chain registry in @tahansoe/domain (invariant: no hardcoded
 * chain data). Only simnet-local knobs (ports, limits, storage slots) live here.
 */

import { ARBITRUM_ONE } from "@tahansoe/domain";
import type { Address } from "viem";
import { z } from "zod";

const intFromEnv = (def: number, min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).default(def);

export const EnvSchema = z.object({
  ARB_ONE_RPC_URL: z.string().url(),
  SIMNET_API_KEY: z.string().min(16, "SIMNET_API_KEY must be at least 16 characters"),
  SIM_CHAIN_ID: intFromEnv(4216199, 1, 2 ** 31),
  SIM_MAX_PRIVATE_FORKS: intFromEnv(4, 0, 32),
  SIM_PRIVATE_TTL_MIN: intFromEnv(30, 1, 24 * 60),
  SIM_PORT: intFromEnv(8787, 1, 65535),
  /** Optional: path to the anvil binary (default: `anvil` on PATH). */
  SIM_ANVIL_BIN: z.string().default("anvil"),
  /** Optional: path to the forge binary used for DeploySim (default: `forge`). */
  SIM_FORGE_BIN: z.string().default("forge"),
  /** Optional: contracts/ directory (default: resolved relative to this workspace). */
  SIM_CONTRACTS_DIR: z.string().optional(),
  /** Optional: "1" to rate-limit by cf-connecting-ip / x-forwarded-for (only behind a tunnel/proxy). */
  SIM_TRUST_PROXY: z.enum(["0", "1"]).default("0"),
  /**
   * Optional: "1" accepts session API calls without `x-simnet-key` (public demo), with a per-client
   * cap on session creation. Calls that do send the key are unaffected. Forks hold no real funds and
   * stay capped by SIM_MAX_PRIVATE_FORKS and the container's memory limit.
   */
  SIM_PUBLIC_API: z.enum(["0", "1"]).default("0"),
  /** Optional: scenarios directory (default: apps/simnet/scenarios). */
  SIM_SCENARIOS_DIR: z.string().optional(),
});

export type SimnetEnv = z.infer<typeof EnvSchema>;

export function loadEnv(env: NodeJS.ProcessEnv = process.env): SimnetEnv {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid simnet environment: ${issues}`);
  }
  return parsed.data;
}

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`ARBITRUM_ONE registry is missing ${what}`);
  return value;
}

/** Arbitrum One addresses the fork relies on, read from the domain registry. */
export const FORK_SOURCE = {
  chainId: ARBITRUM_ONE.chainId,
  poolAddressesProvider: ARBITRUM_ONE.aave!.poolAddressesProvider as Address,
  pool: required(ARBITRUM_ONE.aave?.pool, "aave.pool") as Address,
  aaveOracle: required(ARBITRUM_ONE.aave?.oracle, "aave.oracle") as Address,
  ethUsdFeed: required(ARBITRUM_ONE.priceFeeds["ETH/USD"], 'priceFeeds["ETH/USD"]') as Address,
  weth: required(ARBITRUM_ONE.tokens?.WETH, "tokens.WETH") as Address,
  usdc: required(ARBITRUM_ONE.tokens?.USDC, "tokens.USDC") as Address,
  morpho: (ARBITRUM_ONE.morpho?.blue ?? "0x6c247b1F6182318877311737BaC0844bAa518F5e") as Address,
};

/**
 * ERC-20 balance mapping slots, used by the faucet (`anvil_setStorageAt`).
 *
 * - WETH (Arbitrum aeWETH, OZ ERC20Upgradeable behind a proxy): `_balances` sits after
 *   Initializable (slot 0) and ContextUpgradeable's `__gap[50]` → slot 51.
 * - USDC (Circle FiatTokenV2_2): `balanceAndBlacklistStates` → slot 9. The top bit is
 *   the blacklist flag; the faucet keeps balances far below it.
 *
 * The faucet verifies each write with `balanceOf` and re-probes slots 0..120 if the
 * value does not match (e.g. after a token upgrade), so a stale slot degrades into a
 * slower first top-up instead of a silent no-op.
 */
export const TOKEN_SLOTS: Record<"WETH" | "USDC", { address: Address; decimals: number; balanceSlot: number }> = {
  WETH: { address: FORK_SOURCE.weth, decimals: 18, balanceSlot: 51 },
  USDC: { address: FORK_SOURCE.usdc, decimals: 6, balanceSlot: 9 },
};

/** Uniswap V3 SwapRouter02 on Arbitrum One, used by Guardian L3 in the artifact fallback deploy. */
export const UNISWAP_SWAP_ROUTER_02: Address = "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45";
export const GUARDIAN_SWAP_FEE = 500;

export const LIMITS = {
  initialEth: 10,
  initialUsdc: 5_000,
  maxEth: 100,
  maxUsdc: 50_000,
  relayIntervalMs: 5_000,
  keeperIntervalMs: 2_000,
  scenarioTickMs: 1_000,
  /** Default replay compression: 24 h of scenario time → 3 min wall clock. */
  replayCompression: (24 * 60 * 60) / (3 * 60),
  crashRampMs: 20_000,
  rpcRatePerSec: 30,
  maxLogsBlockRange: 10_000,
  maxBodyBytes: 256 * 1024,
  /** Daily reset of the shared live fork: 04:00 Asia/Jakarta (UTC+7, no DST). */
  liveResetHourUtc: 21,
};

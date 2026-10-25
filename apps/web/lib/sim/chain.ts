/**
 * Simulation chain: an anvil fork of Arbitrum One run by apps/simnet (spec m1-simulation-mode §3.2).
 * The chain id differs from mainnet so a burner transaction can never be replayed there.
 */

import { defineChain } from "viem";
import { ARBITRUM_ONE_SIM, type ChainConfig } from "@tahansoe/domain";

export const SIM_CHAIN_ID = Number(process.env.NEXT_PUBLIC_SIM_CHAIN_ID ?? 4216199) || 4216199;

/** Public RPC proxy base; the per-session fork path is appended (see lib/sim/rpc.ts). */
/** Public simnet RPC proxy fallback (same host as PUBLIC_SIMNET_URL in simnet.server.ts). */
export const SIM_RPC_BASE = (process.env.NEXT_PUBLIC_SIM_RPC_BASE || "https://119-28-119-206.sslip.io").replace(/\/$/, "");

export const simChain = defineChain({
  id: SIM_CHAIN_ID,
  name: "Tahansoe Simulation (Arbitrum One fork)",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [SIM_RPC_BASE || "http://localhost:8546"] } },
  // Multicall3 exists on the forked Arbitrum One state; without it every contract read is its own RPC call.
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11", blockCreated: 7654707 } },
  testnet: true,
});

/**
 * Registry entry for the fork. Aave and token addresses are the Arbitrum One ones; the Guardian
 * address comes from the simnet session. The chain id and RPC base can be overridden per deploy.
 */
export const SIM_CHAIN_CONFIG: ChainConfig & { isSimulation: true } = {
  ...ARBITRUM_ONE_SIM,
  chainId: SIM_CHAIN_ID,
  rpcUrls: SIM_RPC_BASE ? [SIM_RPC_BASE] : [],
  isSimulation: true,
};

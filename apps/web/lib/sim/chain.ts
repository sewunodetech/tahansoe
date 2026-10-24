/**
 * Simulation chain: an anvil fork of Arbitrum One run by apps/simnet (spec m1-simulation-mode §3.2).
 * The chain id differs from mainnet so a burner transaction can never be replayed there.
 */

import { defineChain } from "viem";
import { ARBITRUM_ONE, type ChainConfig } from "@tahansoe/domain";

export const SIM_CHAIN_ID = Number(process.env.NEXT_PUBLIC_SIM_CHAIN_ID ?? 4216199) || 4216199;

/** Public RPC proxy base; the per-session fork path is appended (see lib/sim/rpc.ts). */
export const SIM_RPC_BASE = (process.env.NEXT_PUBLIC_SIM_RPC_BASE ?? "").replace(/\/$/, "");

export const simChain = defineChain({
  id: SIM_CHAIN_ID,
  name: "Tahansoe Simulation (Arbitrum One fork)",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [SIM_RPC_BASE || "http://localhost:8546"] } },
  testnet: true,
});

/**
 * Registry entry for the fork. Aave and token addresses are the Arbitrum One ones; the Guardian
 * address comes from the simnet session.
 * TODO: switch to ARBITRUM_ONE_SIM from @tahansoe/domain once the domain worker lands it.
 */
export const SIM_CHAIN_CONFIG: ChainConfig & { isSimulation: true } = {
  ...ARBITRUM_ONE,
  chainId: SIM_CHAIN_ID,
  name: "Arbitrum One (simulation fork)",
  rpcUrls: SIM_RPC_BASE ? [SIM_RPC_BASE] : [],
  guardian: undefined,
  guardians: [],
  explorer: "",
  isSimulation: true,
};

"use client";

/**
 * Where the Live code paths read and write: Arbitrum Sepolia normally, or the session's fork in
 * Simulation Mode (spec m1-simulation-mode §3.8). Chain, Aave, token and Guardian addresses come
 * from the chain registry or the simnet session, never from component code (security.md I7).
 */

import { useMemo } from "react";
import type { Address, Chain } from "viem";
import type { GuardianDeployment } from "@tahansoe/domain";
import {
  AAVE_ORACLE,
  AAVE_POOL,
  DEBT_ASSETS,
  GUARDIAN,
  LEGACY_GUARDIANS,
  LIVE_CHAIN,
  LIVE_CHAIN_CONFIG,
  type DebtAsset,
} from "@/lib/contracts";
import { useDashboardMode } from "@/lib/dashboard-mode";
import { SIM_CHAIN_CONFIG, simChain } from "@/lib/sim/chain";
import { useSimSession } from "@/lib/sim/hooks";

const ZERO = "0x0000000000000000000000000000000000000000" as Address;

export interface LiveTarget {
  chain: Chain;
  chainName: string;
  pool: Address;
  oracle: Address;
  guardian: GuardianDeployment;
  legacyGuardians: GuardianDeployment[];
  debtAssets: DebtAsset[];
  weth: Address;
  isSimulation: boolean;
  /** False while the simulation session is still loading; reads should wait. */
  ready: boolean;
  explorerTx: (hash: string) => string | null;
  explorerAddress: (address: string) => string | null;
}

const LIVE_TARGET: LiveTarget = {
  chain: LIVE_CHAIN,
  chainName: LIVE_CHAIN_CONFIG.name,
  pool: AAVE_POOL,
  oracle: AAVE_ORACLE,
  guardian: GUARDIAN,
  legacyGuardians: LEGACY_GUARDIANS,
  debtAssets: DEBT_ASSETS,
  weth: LIVE_CHAIN_CONFIG.tokens!.WETH,
  isSimulation: false,
  ready: true,
  explorerTx: (hash) => `${LIVE_CHAIN_CONFIG.explorer}/tx/${hash}`,
  explorerAddress: (address) => `${LIVE_CHAIN_CONFIG.explorer}/address/${address}`,
};

export function useLiveTarget(): LiveTarget {
  const { isSimulation } = useDashboardMode();
  const { data: sim } = useSimSession(isSimulation);

  return useMemo(() => {
    if (!isSimulation) return LIVE_TARGET;
    return {
      chain: simChain,
      chainName: "Simulation · Arbitrum One fork",
      pool: sim?.contracts.pool ?? SIM_CHAIN_CONFIG.aave!.pool!,
      oracle: SIM_CHAIN_CONFIG.aave!.oracle!,
      guardian: {
        version: 2,
        address: sim?.contracts.guardian ?? ZERO,
        deployedBlock: 0,
        features: { layer2: true, layer3: true, triggerBand: true },
      },
      legacyGuardians: [],
      debtAssets: [
        { symbol: "USDC", address: sim?.contracts.usdc ?? SIM_CHAIN_CONFIG.tokens!.USDC, decimals: 6 },
        { symbol: "WETH", address: sim?.contracts.weth ?? SIM_CHAIN_CONFIG.tokens!.WETH, decimals: 18 },
      ],
      weth: sim?.contracts.weth ?? SIM_CHAIN_CONFIG.tokens!.WETH,
      isSimulation: true,
      ready: Boolean(sim && !sim.mock),
      // The fork has no explorer; the simulation transaction list stands in for it.
      explorerTx: () => null,
      explorerAddress: () => null,
    };
  }, [isSimulation, sim]);
}

export function assetSymbol(target: LiveTarget, address: string | undefined): string {
  return target.debtAssets.find((a) => a.address.toLowerCase() === address?.toLowerCase())?.symbol ?? "token";
}

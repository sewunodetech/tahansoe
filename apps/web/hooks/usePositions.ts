"use client";

/**
 * usePositions
 *
 * Every borrow position of the connected wallet on the chains the dashboard reads
 * (spec m1-positions-holdings-guardian-view §2, §3.4; spec m4-guardian-v4-per-position §3.5):
 * - Live: the Live chain (Aave, where the Guardian is), plus Arbitrum One read-only (Aave and
 *   Morpho) when `includeArbitrumOne` is on, since the public RPC can be slow.
 * - Simulation: the session's fork only.
 * Read-only: nothing here signs or sends a transaction.
 */

import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import type { PublicClient } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { arbitrum } from "wagmi/chains";
import { ARBITRUM_ONE, type ChainConfig, type PositionDetail } from "@tahansoe/domain";
import { LIVE_CHAIN_CONFIG } from "@/lib/contracts";
import { useLiveTarget } from "@/lib/live-target";
import { SIM_CHAIN_CONFIG } from "@/lib/sim/chain";
import { protocolsOn, readerFor, type Protocol } from "@/lib/positions/source";
import { positionStatus, type GuardianContext, type PositionStatus } from "@/lib/positions/status";
import { positionStatusV4 } from "@/lib/guardian-v4";
import { useGuardian } from "./useGuardian";
import { useGuardianV4 } from "./useGuardianV4";

const STALE_MS = 60_000;
/** The fork's prices move every few seconds; refresh so cards follow the scenario. */
const SIM_REFRESH_MS = 15_000;

export interface PositionWithStatus {
  position: PositionDetail;
  status: PositionStatus;
  chainName: string;
}

export interface ChainRead {
  chainId: number;
  protocol: Protocol;
  chainName: string;
  isLoading: boolean;
  error: string | null;
}

interface ChainPlan {
  config: ChainConfig;
  client: PublicClient | undefined;
  canProtect: boolean;
}

/** One query per protocol per chain, so a slow Morpho scan never holds back Aave. */
interface ReadPlan extends ChainPlan {
  protocol: Protocol;
}

export function usePositions({ includeArbitrumOne = false }: { includeArbitrumOne?: boolean } = {}) {
  const { address: user } = useAccount();
  const target = useLiveTarget();
  const g = useGuardian();
  const g4 = useGuardianV4();

  const liveClient = usePublicClient({ chainId: target.chain.id });
  const oneClient = usePublicClient({ chainId: arbitrum.id });

  const plans: ChainPlan[] = useMemo(() => {
    if (target.isSimulation) {
      // The session's pool and tokens; the rest of the registry entry is the Arbitrum One fork.
      const config: ChainConfig = {
        ...SIM_CHAIN_CONFIG,
        aave: { ...SIM_CHAIN_CONFIG.aave!, pool: target.pool, oracle: target.oracle },
        // Morpho on the fork would mean scanning logs over the session RPC; the simulation is Aave only.
        morpho: undefined,
        tokens: Object.fromEntries(target.debtAssets.map((a) => [a.symbol, a.address])),
      };
      return [{ config, client: liveClient, canProtect: true }];
    }
    const list: ChainPlan[] = [{ config: LIVE_CHAIN_CONFIG, client: liveClient, canProtect: true }];
    if (includeArbitrumOne) list.push({ config: ARBITRUM_ONE, client: oneClient, canProtect: Boolean(g4.morphoGuardianAddress) });
    return list;
  }, [target.isSimulation, target.pool, target.oracle, target.debtAssets, liveClient, oneClient, includeArbitrumOne, g4.morphoGuardianAddress]);

  const reads: ReadPlan[] = useMemo(
    () => plans.flatMap((plan) => protocolsOn(plan.config).map((protocol) => ({ ...plan, protocol }))),
    [plans]
  );

  const queries = useQueries({
    queries: reads.map((plan) => ({
      queryKey: ["positions", plan.config.chainId, plan.protocol, plan.config.aave?.pool ?? "", user ?? ""],
      enabled: Boolean(user && plan.client) && (!target.isSimulation || target.ready),
      staleTime: STALE_MS,
      refetchInterval: target.isSimulation ? SIM_REFRESH_MS : false,
      retry: 1,
      queryFn: () => readerFor(plan.client!, plan.config, plan.protocol, plan.canProtect).read(user!),
    })),
  });

  const guardian: GuardianContext = useMemo(
    () => ({
      chainId: target.chain.id,
      policy: g.policy
        ? {
            enabled: g.policy.enabled,
            debtAsset: g.policy.debtAsset,
            triggerHf: g.effectiveTrigger ?? g.policy.triggerHf,
            targetHf: g.policy.targetHf,
          }
        : null,
    }),
    [target.chain.id, g.policy, g.effectiveTrigger]
  );

  const dataKey = queries.map((q) => q.dataUpdatedAt).join(":");
  const positions: PositionWithStatus[] = useMemo(
    () =>
      queries.flatMap((q, i) =>
        (q.data ?? []).map((position) => {
          const isTargetChain = reads[i].config.chainId === target.chain.id;
          let status: PositionStatus;

          if (g4.available) {
            status = positionStatusV4({
              position,
              aaveGuardianAddress: g4.aaveGuardianAddress,
              morphoGuardianAddress: g4.morphoGuardianAddress,
              aavePolicies: g4.aavePolicies,
              morphoPolicies: g4.morphoPolicies,
            });
          } else {
            status = positionStatus(position, reads[i].canProtect ? guardian : null);
          }

          return {
            position,
            status,
            chainName: isTargetChain ? target.chainName : reads[i].config.name,
          };
        })
      ),
    // queries is a new array every render; dataKey tracks the data that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      dataKey,
      reads,
      guardian,
      g4.available,
      g4.aaveGuardianAddress,
      g4.morphoGuardianAddress,
      g4.aavePolicies,
      g4.morphoPolicies,
      target.chain.id,
      target.chainName,
    ]
  );

  const chains: ChainRead[] = reads.map((plan, i) => ({
    chainId: plan.config.chainId,
    protocol: plan.protocol,
    chainName: plan.config.chainId === target.chain.id ? target.chainName : plan.config.name,
    isLoading: queries[i].isLoading,
    error: queries[i].error ? (queries[i].error as Error).message.split("\n")[0] : null,
  }));

  return {
    positions,
    chains,
    /** True until the first read of the Guardian chain finishes. */
    isLoading: chains[0]?.isLoading ?? false,
    /** Simulation chain not ready (mock simnet or session loading). */
    unavailable: target.isSimulation && !target.ready,
    guardianChainId: target.chain.id,
    refetch: () => Promise.all(queries.map((q) => q.refetch())),
  };
}

export type UsePositionsReturn = ReturnType<typeof usePositions>;

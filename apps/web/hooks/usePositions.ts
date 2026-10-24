"use client";

/**
 * usePositions
 *
 * Every borrow position of the connected wallet on the chains the dashboard reads
 * (spec m1-positions-holdings-guardian-view §2, §3.4):
 * - Live: the Live chain (Aave, where the Guardian is), plus Arbitrum One read-only (Aave and
 *   later Morpho) when `includeArbitrumOne` is on, since the public RPC can be slow.
 * - Simulation: the session's fork only.
 * Read-only: nothing here signs or sends a transaction.
 */

import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import type { PublicClient } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { arbitrum } from "wagmi/chains";
import { ARBITRUM_ONE, type ChainConfig } from "@tahansoe/domain";
import { LIVE_CHAIN_CONFIG } from "@/lib/contracts";
import { useLiveTarget } from "@/lib/live-target";
import { SIM_CHAIN_CONFIG } from "@/lib/sim/chain";
import { readersFor } from "@/lib/positions/source";
import { positionStatus, type GuardianContext, type PositionStatus } from "@/lib/positions/status";
import type { PositionDetail } from "@/lib/positions/types";
import { useGuardian } from "./useGuardian";

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
  chainName: string;
  isLoading: boolean;
  error: string | null;
}

interface ChainPlan {
  config: ChainConfig;
  client: PublicClient | undefined;
  canProtect: boolean;
}

export function usePositions({ includeArbitrumOne = false }: { includeArbitrumOne?: boolean } = {}) {
  const { address: user } = useAccount();
  const target = useLiveTarget();
  const g = useGuardian();

  const liveClient = usePublicClient({ chainId: target.chain.id });
  const oneClient = usePublicClient({ chainId: arbitrum.id });

  const plans: ChainPlan[] = useMemo(() => {
    if (target.isSimulation) {
      // The session's pool and tokens; the rest of the registry entry is the Arbitrum One fork.
      const config: ChainConfig = {
        ...SIM_CHAIN_CONFIG,
        aave: { ...SIM_CHAIN_CONFIG.aave!, pool: target.pool, oracle: target.oracle },
        tokens: Object.fromEntries(target.debtAssets.map((a) => [a.symbol, a.address])),
      };
      return [{ config, client: liveClient, canProtect: true }];
    }
    const list: ChainPlan[] = [{ config: LIVE_CHAIN_CONFIG, client: liveClient, canProtect: true }];
    if (includeArbitrumOne) list.push({ config: ARBITRUM_ONE, client: oneClient, canProtect: false });
    return list;
  }, [target.isSimulation, target.pool, target.oracle, target.debtAssets, liveClient, oneClient, includeArbitrumOne]);

  const queries = useQueries({
    queries: plans.map((plan) => ({
      queryKey: ["positions", plan.config.chainId, plan.config.aave?.pool ?? "", user ?? ""],
      enabled: Boolean(user && plan.client) && (!target.isSimulation || target.ready),
      staleTime: STALE_MS,
      refetchInterval: target.isSimulation ? SIM_REFRESH_MS : false,
      retry: 1,
      queryFn: async () => {
        const readers = readersFor(plan.client!, plan.config, plan.canProtect);
        const results = await Promise.all(readers.map((r) => r.read(user!)));
        return results.flat();
      },
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
        (q.data ?? []).map((position) => ({
          position,
          status: positionStatus(position, plans[i].canProtect ? guardian : null),
          chainName: plans[i].config.chainId === target.chain.id ? target.chainName : plans[i].config.name,
        }))
      ),
    // queries is a new array every render; dataKey tracks the data that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dataKey, plans, guardian, target.chain.id, target.chainName]
  );

  const chains: ChainRead[] = plans.map((plan, i) => ({
    chainId: plan.config.chainId,
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

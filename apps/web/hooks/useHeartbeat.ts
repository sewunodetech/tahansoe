"use client";

/**
 * useHeartbeat
 *
 * When the wallet's positions were last checked (spec m1-positions-holdings-guardian-view §3.8):
 * - Live: the Sentinel's `positions.last_checked_at`, from GET /api/positions/heartbeat (SIWE only).
 * - Simulation: `keeperCheckedAt` on the simnet status, written by the fork's keeper loop.
 * Both sources are optional: a missing route, a 401, or an older simnet yield `checkedAt: null`
 * with a reason, and the UI then says so instead of claiming live protection.
 */

import { useQuery } from "@tanstack/react-query";
import { useDashboardMode } from "@/lib/dashboard-mode";
import { useSimStatus } from "@/lib/sim/hooks";
import type { SimStatus } from "@/lib/sim/types";

const REFRESH_MS = 30_000;

export type HeartbeatUnavailable = "sign-in" | "not-deployed" | "error" | null;

interface HeartbeatResponse {
  checkedAt: string | null;
  positions?: { protocol: string; chainId: number; marketId: string | null; lastCheckedAt: string | null }[];
}

export interface Heartbeat {
  checkedAt: string | null;
  source: "sentinel" | "simulation";
  unavailable: HeartbeatUnavailable;
  isLoading: boolean;
}

async function fetchHeartbeat(): Promise<{ checkedAt: string | null; unavailable: HeartbeatUnavailable }> {
  const res = await fetch("/api/positions/heartbeat", { cache: "no-store" });
  if (res.status === 401) return { checkedAt: null, unavailable: "sign-in" };
  if (res.status === 404) return { checkedAt: null, unavailable: "not-deployed" };
  if (!res.ok) return { checkedAt: null, unavailable: "error" };
  const body = (await res.json().catch(() => null)) as HeartbeatResponse | null;
  const checkedAt = typeof body?.checkedAt === "string" ? body.checkedAt : null;
  return { checkedAt, unavailable: null };
}

export function useHeartbeat(): Heartbeat {
  const { isSimulation } = useDashboardMode();
  const sim = useSimStatus(isSimulation);
  const live = useQuery({
    queryKey: ["positions-heartbeat"],
    enabled: !isSimulation,
    refetchInterval: REFRESH_MS,
    retry: false,
    queryFn: fetchHeartbeat,
  });

  if (isSimulation) {
    // TODO(pos-d-heartbeat): drop the cast once SimStatus carries `keeperCheckedAt`.
    const checkedAt = (sim.data as (SimStatus & { keeperCheckedAt?: string | null }) | undefined)?.keeperCheckedAt ?? null;
    return {
      checkedAt,
      source: "simulation",
      unavailable: sim.error ? "error" : sim.data && !checkedAt ? "not-deployed" : null,
      isLoading: sim.isLoading,
    };
  }
  return {
    checkedAt: live.data?.checkedAt ?? null,
    source: "sentinel",
    unavailable: live.error ? "error" : live.data?.unavailable ?? null,
    isLoading: live.isLoading,
  };
}

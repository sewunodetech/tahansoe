"use client";

/**
 * Client hooks for Simulation Mode: the session from the sim cookie, the simnet status poll,
 * and the actions behind the scenario panel, faucet and exit (spec m1-simulation-mode §3.5).
 */

import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDisconnect } from "wagmi";
import { clearBurner } from "./burner";
import { setSimRpcPath } from "./rpc";
import type { FaucetAsset, SimMode, SimScenarioId, SimSessionInfo, SimStatus } from "./types";

export const SIM_SESSION_KEY = ["sim-session"] as const;
export const SIM_STATUS_KEY = ["sim-status"] as const;

export class SimApiError extends Error {
  constructor(message: string, readonly status: number, readonly body: Record<string, unknown>) {
    super(message);
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new SimApiError(typeof body.error === "string" ? body.error : `Request failed (${res.status})`, res.status, body);
  return body as T;
}

export function fetchSimSession(): Promise<SimSessionInfo> {
  return call<SimSessionInfo>("/api/sim/session");
}

/** Starts (or replaces) the simnet session and points the burner transport at its fork. */
export async function startSimSession(input: { address: string; mode: SimMode; scenario?: SimScenarioId }): Promise<SimSessionInfo> {
  const info = await call<SimSessionInfo>("/api/sim/session", { method: "POST", body: JSON.stringify(input) });
  setSimRpcPath(info.rpcPath);
  return info;
}

export function useSimSession(enabled = true) {
  return useQuery({
    queryKey: SIM_SESSION_KEY,
    enabled,
    retry: false,
    staleTime: 30_000,
    queryFn: async () => {
      const info = await fetchSimSession();
      setSimRpcPath(info.rpcPath);
      return info;
    },
  });
}

export function useSimStatus(enabled = true) {
  return useQuery({
    queryKey: SIM_STATUS_KEY,
    enabled,
    retry: false,
    refetchInterval: (q) => (q.state.error ? false : 3_000),
    queryFn: () => call<SimStatus>("/api/sim/status"),
  });
}

export function useSimActions() {
  const queryClient = useQueryClient();
  const { disconnectAsync } = useDisconnect();

  /** New fork session in another price mode; every on-chain read restarts against it. */
  const switchMode = useCallback(
    async (address: string, mode: SimMode, scenario?: SimScenarioId) => {
      const info = await startSimSession({ address, mode, scenario });
      queryClient.setQueryData(SIM_SESSION_KEY, info);
      await queryClient.resetQueries({ predicate: (q) => q.queryKey[0] !== SIM_SESSION_KEY[0] });
      return info;
    },
    [queryClient]
  );

  const runScenario = useCallback(
    async (body: { kind: "replay"; scenario: SimScenarioId } | { kind: "crash"; pct: 10 | 30 | 50 }) => {
      await call("/api/sim/scenario", { method: "POST", body: JSON.stringify(body) });
      await queryClient.invalidateQueries({ queryKey: SIM_STATUS_KEY });
    },
    [queryClient]
  );

  const topUp = useCallback(
    async (asset: FaucetAsset, amount: number) => {
      const res = await call<{ used: Partial<Record<FaucetAsset, number>> }>("/api/sim/faucet", {
        method: "POST",
        body: JSON.stringify({ asset, amount }),
      });
      await queryClient.invalidateQueries();
      return res;
    },
    [queryClient]
  );

  const markPositionOpened = useCallback(async () => {
    await call("/api/sim/session", { method: "PATCH", body: JSON.stringify({ event: "position_opened" }) }).catch(() => {});
  }, []);

  /** Leaves the simulation: ends the fork session, drops the burner key and the sim cookie. */
  const exit = useCallback(
    async (opts: { converted?: boolean } = {}) => {
      if (opts.converted) {
        await call("/api/sim/session", { method: "PATCH", body: JSON.stringify({ event: "converted" }) }).catch(() => {});
      } else {
        await call("/api/sim/session", { method: "DELETE" }).catch(() => {});
      }
      await disconnectAsync().catch(() => {});
      clearBurner();
      setSimRpcPath(null);
      queryClient.removeQueries({ queryKey: SIM_SESSION_KEY });
      queryClient.removeQueries({ queryKey: SIM_STATUS_KEY });
    },
    [disconnectAsync, queryClient]
  );

  return { switchMode, runScenario, topUp, markPositionOpened, exit };
}

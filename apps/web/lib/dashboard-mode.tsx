"use client";

/**
 * Live vs Demo switch for the dashboard (M1 spec §3.4.2), plus Simulation Mode
 * (spec m1-simulation-mode §3.8).
 * Live reads the connected wallet's Aave position and Guardian policy on Arbitrum Sepolia;
 * Demo keeps the in-memory simulation. The choice is remembered per browser.
 * Simulation is not a choice in the switch: it is on whenever the burner wallet is connected,
 * and runs the Live code paths against the simulation fork.
 */

import React, { createContext, useContext, useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { SIM_CONNECTOR_ID } from "@/lib/sim/connector";

export type DashboardMode = "live" | "demo" | "simulation";

const STORAGE_KEY = "tahansoe:mode";

interface DashboardModeValue {
  mode: DashboardMode;
  setMode: (mode: Exclude<DashboardMode, "simulation">) => void;
  /** True when pages should render the on-chain (Live) code paths: live and simulation. */
  isLive: boolean;
  isSimulation: boolean;
}

const DashboardModeContext = createContext<DashboardModeValue | null>(null);

export function DashboardModeProvider({ children }: { children: React.ReactNode }) {
  const [stored, setStored] = useState<Exclude<DashboardMode, "simulation">>("live");
  const { connector } = useAccount();
  const isSimulation = connector?.id === SIM_CONNECTOR_ID;

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate the saved choice after mount
      if (saved === "live" || saved === "demo") setStored(saved);
    } catch { /* storage blocked — keep the default */ }
  }, []);

  const setMode = (next: Exclude<DashboardMode, "simulation">) => {
    setStored(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch { /* storage blocked — the choice lasts for this session only */ }
  };

  const mode: DashboardMode = isSimulation ? "simulation" : stored;

  return (
    <DashboardModeContext.Provider value={{ mode, setMode, isLive: mode !== "demo", isSimulation }}>
      {children}
    </DashboardModeContext.Provider>
  );
}

export function useDashboardMode(): DashboardModeValue {
  const ctx = useContext(DashboardModeContext);
  if (!ctx) throw new Error("useDashboardMode must be used inside DashboardModeProvider");
  return ctx;
}

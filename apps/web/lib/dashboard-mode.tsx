"use client";

/**
 * Live vs Demo switch for the dashboard (M1 spec §3.4.2).
 * Live reads the connected wallet's Aave position and Guardian policy on Arbitrum Sepolia;
 * Demo keeps the in-memory simulation. The choice is remembered per browser.
 */

import React, { createContext, useContext, useEffect, useState } from "react";

export type DashboardMode = "live" | "demo";

const STORAGE_KEY = "tahansoe:mode";

interface DashboardModeValue {
  mode: DashboardMode;
  setMode: (mode: DashboardMode) => void;
  isLive: boolean;
}

const DashboardModeContext = createContext<DashboardModeValue | null>(null);

export function DashboardModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<DashboardMode>("live");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate the saved choice after mount
      if (saved === "live" || saved === "demo") setModeState(saved);
    } catch { /* storage blocked — keep the default */ }
  }, []);

  const setMode = (next: DashboardMode) => {
    setModeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch { /* storage blocked — the choice lasts for this session only */ }
  };

  return (
    <DashboardModeContext.Provider value={{ mode, setMode, isLive: mode === "live" }}>
      {children}
    </DashboardModeContext.Provider>
  );
}

export function useDashboardMode(): DashboardModeValue {
  const ctx = useContext(DashboardModeContext);
  if (!ctx) throw new Error("useDashboardMode must be used inside DashboardModeProvider");
  return ctx;
}

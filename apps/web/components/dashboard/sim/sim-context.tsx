"use client";

/**
 * Per-tab state for the simulation dashboard: the transactions the user sent from the wizard and
 * the position snapshot the "Without Tahansoe" panel compares against. In memory only; it resets
 * with the fork session.
 */

import React, { createContext, useCallback, useContext, useState } from "react";

export interface SimUserTx {
  hash: string;
  action: string;
  hfBefore: number | null;
  hfAfter: number | null;
  at: number;
}

export interface SimBaseline {
  collateralEth: number;
  debtUsd: number;
  liquidationThreshold: number;
  triggerHf?: number;
}

interface SimDashboardValue {
  txs: SimUserTx[];
  addTx: (tx: SimUserTx) => void;
  baseline: SimBaseline | null;
  setBaseline: (b: SimBaseline | null) => void;
  reset: () => void;
}

const SimDashboardContext = createContext<SimDashboardValue | null>(null);

export function SimDashboardProvider({ children }: { children: React.ReactNode }) {
  const [txs, setTxs] = useState<SimUserTx[]>([]);
  const [baseline, setBaseline] = useState<SimBaseline | null>(null);

  const addTx = useCallback((tx: SimUserTx) => setTxs((prev) => [tx, ...prev.filter((t) => t.hash !== tx.hash)]), []);
  const reset = useCallback(() => {
    setTxs([]);
    setBaseline(null);
  }, []);

  return (
    <SimDashboardContext.Provider value={{ txs, addTx, baseline, setBaseline, reset }}>
      {children}
    </SimDashboardContext.Provider>
  );
}

export function useSimDashboard(): SimDashboardValue {
  const ctx = useContext(SimDashboardContext);
  if (!ctx) throw new Error("useSimDashboard must be used inside SimDashboardProvider");
  return ctx;
}

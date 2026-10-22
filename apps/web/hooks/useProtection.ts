"use client";

import { useMemo, useState, useCallback } from "react";
import { useSimulation, type PolicySettings } from "@/lib/simulation-context";
import type { Position, HistoryEntry } from "@/lib/mock-data";

export type RiskZone = "Safe" | "Watch" | "Warning" | "Critical" | "Liquidated";

export interface ProtectionLayer {
  layer: 1 | 2 | 3;
  name: string;
  asset: string;
  enabled: boolean;
  approved: boolean;
  capacity: number;
  coversPct: number;
  balance?: number;
  allowance?: number;
  description: string;
}

export interface ProtectionLayers {
  l1: ProtectionLayer;
  l2: ProtectionLayer;
  l3: ProtectionLayer;
}

export interface ProtectionActions {
  enableLayer: (layer: 1 | 2 | 3, enabled: boolean) => void;
  setCap: (layer: 1 | 2 | 3, cap: number) => void;
  approve: (layer: 1 | 2 | 3) => void;
  revoke: (layer: 1 | 2 | 3) => void;
  revokeAll: () => void;
  setPolicy: (patch: Partial<PolicySettings>) => void;
  setTriggerHf: (trigger: number) => void;
  setTargetHf: (target: number) => void;
  simulatePriceDrop: (percent?: number) => void;
  resetSimulation: () => void;
  setPaused: (paused: boolean) => void;
}

export interface UseProtectionReturn {
  position: Position | null;
  positions: Position[];
  selectedPositionId: string;
  setSelectedPositionId: (id: string) => void;
  hf: number;
  zone: RiskZone;
  layers: ProtectionLayers;
  policy: PolicySettings;
  activity: HistoryEntry[];
  actions: ProtectionActions;
  isPaused: boolean;
  ethPrice: { price: number; change24h: number };
  hasPolicy: boolean;
}

export function calculateZone(hf: number, triggerHf: number): RiskZone {
  if (hf < 1.0) return "Liquidated";
  if (hf <= triggerHf) return "Critical";
  if (hf <= triggerHf + 0.15) return "Warning";
  if (hf < 1.6) return "Watch";
  return "Safe";
}

/**
 * useProtection
 *
 * Core data abstraction hook for Tahansoe liquidation protection.
 * In demo/simulation mode, it sources live state and actions from SimulationContext.
 * In on-chain production mode (Phase 5), the source will switch to contract hooks
 * without breaking the UI components consuming this contract.
 */
export function useProtection(preferredPositionId?: string): UseProtectionReturn {
  const {
    state,
    updatePolicy,
    simulatePriceDrop: simPriceDrop,
    resetSimulation: simReset,
    setPaused,
  } = useSimulation();

  const [selectedId, setSelectedId] = useState<string>(
    preferredPositionId ?? state.positions[0]?.id ?? "aave-base-eth"
  );

  const position = useMemo(() => {
    return (
      state.positions.find((p) => p.id === selectedId) ??
      state.positions[0] ??
      null
    );
  }, [state.positions, selectedId]);

  const hf = position?.hf ?? 1.82;
  const triggerHf = state.policy.triggerHF;
  const zone = useMemo(() => calculateZone(hf, triggerHf), [hf, triggerHf]);

  const debtUsd = position?.debtUsd ?? 5400;

  const layers: ProtectionLayers = useMemo(() => {
    const l1Cap = state.policy.l1Cap ?? 1000;
    const l2Cap = state.policy.l2Cap ?? 2500;
    const l3Cap = state.policy.l3Cap ?? 10000;

    const l1CoversPct = debtUsd > 0 ? Math.min(100, Math.round((l1Cap / debtUsd) * 100)) : 100;
    const l2CoversPct = debtUsd > 0 ? Math.min(100, Math.round((l2Cap / debtUsd) * 100)) : 100;
    const l3CoversPct = 100;

    return {
      l1: {
        layer: 1,
        name: "Wallet Reserve",
        asset: "USDC",
        enabled: state.policy.l1Enabled ?? state.policy.hotReserveEnabled,
        approved: state.policy.l1Approved ?? true,
        capacity: l1Cap,
        coversPct: l1CoversPct,
        balance: state.policy.l1Balance ?? 5000,
        allowance: state.policy.l1Allowance ?? 3000,
        description: "Pre-approved hot wallet USDC to repay debt directly.",
      },
      l2: {
        layer: 2,
        name: "Position Reserve",
        asset: "Vault Shares / aToken",
        enabled: state.policy.l2Enabled ?? false,
        approved: state.policy.l2Approved ?? true,
        capacity: l2Cap,
        coversPct: l2CoversPct,
        balance: state.policy.l2Balance ?? 10000,
        allowance: state.policy.l2Allowance ?? 10000,
        description: "Redeem secondary vault shares to fund debt repayment.",
      },
      l3: {
        layer: 3,
        name: "Flash Deleverage",
        asset: "Aave Flash Loan",
        enabled: state.policy.l3Enabled ?? (state.policy.flashLoanEnabled || state.policy.deleverageEnabled),
        approved: state.policy.l3Approved ?? true,
        capacity: l3Cap,
        coversPct: l3CoversPct,
        description: "Atomic flash loan to repay debt and withdraw collateral safely.",
      },
    };
  }, [state.policy, debtUsd]);

  const enableLayer = useCallback(
    (layer: 1 | 2 | 3, enabled: boolean) => {
      if (layer === 1) {
        updatePolicy({ l1Enabled: enabled, hotReserveEnabled: enabled });
      } else if (layer === 2) {
        updatePolicy({ l2Enabled: enabled });
      } else if (layer === 3) {
        updatePolicy({
          l3Enabled: enabled,
          flashLoanEnabled: enabled,
          deleverageEnabled: enabled,
        });
      }
    },
    [updatePolicy]
  );

  const setCap = useCallback(
    (layer: 1 | 2 | 3, cap: number) => {
      if (layer === 1) updatePolicy({ l1Cap: cap });
      else if (layer === 2) updatePolicy({ l2Cap: cap });
      else if (layer === 3) updatePolicy({ l3Cap: cap });
    },
    [updatePolicy]
  );

  const approve = useCallback(
    (layer: 1 | 2 | 3) => {
      if (layer === 1) {
        const cap = state.policy.l1Cap ?? 1000;
        updatePolicy({
          l1Approved: true,
          l1Enabled: true,
          l1Allowance: Math.max(state.policy.l1Allowance ?? 3000, cap * 3),
        });
      } else if (layer === 2) {
        updatePolicy({ l2Approved: true, l2Enabled: true });
      } else if (layer === 3) {
        updatePolicy({ l3Approved: true, l3Enabled: true });
      }
    },
    [updatePolicy, state.policy.l1Cap, state.policy.l1Allowance]
  );

  const revoke = useCallback(
    (layer: 1 | 2 | 3) => {
      if (layer === 1) updatePolicy({ l1Approved: false, l1Cap: 0, l1Allowance: 0, l1Enabled: false });
      else if (layer === 2) updatePolicy({ l2Approved: false, l2Cap: 0, l2Enabled: false });
      else if (layer === 3) updatePolicy({ l3Approved: false, l3Cap: 0, l3Enabled: false });
    },
    [updatePolicy]
  );

  const revokeAll = useCallback(() => {
    updatePolicy({
      l1Approved: false,
      l1Cap: 0,
      l1Allowance: 0,
      l1Enabled: false,
      l2Approved: false,
      l2Cap: 0,
      l2Enabled: false,
      l3Approved: false,
      l3Cap: 0,
      l3Enabled: false,
      hasPolicy: false,
    });
  }, [updatePolicy]);

  const setPolicy = useCallback(
    (patch: Partial<PolicySettings>) => {
      updatePolicy(patch);
    },
    [updatePolicy]
  );

  const setTriggerHf = useCallback(
    (trigger: number) => {
      updatePolicy({ triggerHF: trigger });
    },
    [updatePolicy]
  );

  const setTargetHf = useCallback(
    (target: number) => {
      updatePolicy({ targetHF: target });
    },
    [updatePolicy]
  );

  const actions: ProtectionActions = useMemo(
    () => ({
      enableLayer,
      setCap,
      approve,
      revoke,
      revokeAll,
      setPolicy,
      setTriggerHf,
      setTargetHf,
      simulatePriceDrop: simPriceDrop,
      resetSimulation: simReset,
      setPaused,
    }),
    [
      enableLayer,
      setCap,
      approve,
      revoke,
      revokeAll,
      setPolicy,
      setTriggerHf,
      setTargetHf,
      simPriceDrop,
      simReset,
      setPaused,
    ]
  );

  return {
    position,
    positions: state.positions,
    selectedPositionId: selectedId,
    setSelectedPositionId: setSelectedId,
    hf,
    zone,
    layers,
    policy: state.policy,
    activity: state.history,
    actions,
    isPaused: state.isPaused,
    ethPrice: state.ethPrice,
    hasPolicy: Boolean(state.policy.hasPolicy),
  };
}

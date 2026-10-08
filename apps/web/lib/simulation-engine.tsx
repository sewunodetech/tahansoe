"use client";

/**
 * SimulationEngine
 *
 * Renders nothing — purely a side-effect component.
 * Mount once inside DashboardLayout (after SimulationProvider).
 *
 * Core formula (same as Aave / Morpho):
 *   HF = (collateralUsd × liquidationThreshold) / debtUsd
 *
 * When HF ≤ policy.triggerHF the engine picks a remediation strategy:
 *   1. REPAY      — reduce debt (flash loan or hot reserve)
 *   2. TOP-UP     — add collateral (requires hot reserve enabled)
 *   3. DELEVERAGE — sell collateral → repay debt (last resort, user opted-in)
 *
 * The effective target after remediation is:
 *   effectiveTarget = targetHF × (1 + bufferPct / 100)
 *
 * The engine reads policy values live from SimulationContext so every
 * change in Settings takes effect on the very next tick.
 */

import { useEffect, useRef } from "react";
import { useSimulation, type PolicySettings } from "@/lib/simulation-context";
import type { Position, HistoryEntry, PositionStatus } from "@/lib/mock-data";
import type { AlertEvent, HFPoint, RemediationStrategy } from "@/lib/simulation-context";

/* ─────────────────────────────────────────────
   Constants
───────────────────────────────────────────── */
const TICK_MS          = 2_800;
const PRICE_VOLATILITY = 0.008;   // σ per tick — ~0.8% max swing
const WARN_HF_MARGIN   = 0.25;    // warn when HF < triggerHF + 0.25
const ALERT_COOLDOWN   = 30_000;  // ms between repeat alerts for same position+type
const RECOVERY_PAUSE   = 6_000;   // ms to hold post-repay state before resuming drift
const TREND_MAX_POINTS = 30;
const LIQ_THRESHOLD    = 0.825;   // Aave V3 ETH liquidation threshold

/* ─────────────────────────────────────────────
   Price helpers
───────────────────────────────────────────── */
function gaussianStep(sigma: number): number {
  const u1 = Math.random();
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1 + 1e-10)) * Math.cos(2 * Math.PI * u2) * sigma;
}

function nextEthPrice(current: number): number {
  return Math.max(1_800, Math.min(8_000, current + current * gaussianStep(PRICE_VOLATILITY)));
}

/* ─────────────────────────────────────────────
   HF formula
   HF = (collateralUsd × LIQ_THRESHOLD) / debtUsd
───────────────────────────────────────────── */
function calcHF(collateralUsd: number, debtUsd: number): number {
  if (debtUsd <= 0) return 99;
  return (collateralUsd * LIQ_THRESHOLD) / debtUsd;
}

function hfStatus(hf: number, triggerHF: number, warnThreshold: number): PositionStatus {
  if (hf <= triggerHF)     return "critical";
  if (hf <= warnThreshold) return "warning";
  return "safe";
}

/* ─────────────────────────────────────────────
   Remediation math
   All three strategies bring HF to effectiveTarget.
   effectiveTarget = targetHF × (1 + bufferPct/100)
───────────────────────────────────────────── */
type RemediationResult = {
  strategy:      RemediationStrategy;
  newCollateral: number;
  newDebt:       number;
  newHF:         number;
  actionLabel:   string;   // e.g. "Repay 1,240 USDC"
  amount:        number;
  asset:         string;
  source:        string;
};

function remediate(
  pos: Position,
  policy: PolicySettings
): RemediationResult | null {
  const effective = policy.targetHF * (1 + policy.bufferPct / 100);

  // ── Strategy 1: REPAY (reduce debt)
  // Solve for newDebt: (collateral × LIQ_THRESHOLD) / newDebt = effectiveTarget
  // → newDebt = (collateral × LIQ_THRESHOLD) / effectiveTarget
  if (policy.hotReserveEnabled || policy.flashLoanEnabled) {
    const newDebt    = (pos.collateralUsd * LIQ_THRESHOLD) / effective;
    const repayUsd   = Math.max(0, pos.debtUsd - newDebt);
    const newHF      = calcHF(pos.collateralUsd, newDebt);
    const source     = policy.hotReserveEnabled ? "Hot reserve" : "Flash loan";
    return {
      strategy:      "repay",
      newCollateral: pos.collateralUsd,
      newDebt,
      newHF,
      actionLabel:   `Repay ${Math.round(repayUsd).toLocaleString()} USDC`,
      amount:        Math.round(repayUsd),
      asset:         "USDC",
      source,
    };
  }

  // ── Strategy 2: DELEVERAGE (sell collateral, repay debt)
  // We sell enough collateral → USDC → repay debt until HF = effectiveTarget.
  // Let x = USD of collateral sold = USD of debt repaid (ignoring slippage for sim).
  // HF = ((collateral - x) × LIQ_THRESHOLD) / (debt - x) = effectiveTarget
  // Solve: (C - x) × L = T × (D - x)
  //        CL - xL = TD - Tx
  //        CL - TD = xL - Tx = x(L - T)
  //        x = (CL - TD) / (L - T)
  if (policy.deleverageEnabled) {
    const C = pos.collateralUsd;
    const D = pos.debtUsd;
    const L = LIQ_THRESHOLD;
    const T = effective;
    const denom = L - T;
    if (denom >= 0) return null; // can't solve (target too low)
    const x          = (C * L - T * D) / denom;
    const newCollateral = C - x;
    const newDebt       = D - x;
    if (newCollateral <= 0 || newDebt < 0) return null;
    const newHF      = calcHF(newCollateral, Math.max(0.01, newDebt));
    const slippageFactor = 1 - policy.slippageBps / 10_000;
    return {
      strategy:      "deleverage",
      newCollateral,
      newDebt,
      newHF,
      actionLabel:   `Deleverage ${Math.round(x).toLocaleString()} USD`,
      amount:        Math.round(x * slippageFactor),
      asset:         "ETH→USDC",
      source:        "Deleverage",
    };
  }

  return null; // no strategy available — alert only
}

/* ─────────────────────────────────────────────
   History entry builder
───────────────────────────────────────────── */
function makeId(): string { return Math.random().toString(36).slice(2, 9); }
function nowLabel(): string {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function makeHistoryEntry(
  pos:      Position,
  result:   RemediationResult,
  hfBefore: number,
): HistoryEntry {
  const actionMap: Record<RemediationStrategy, HistoryEntry["action"]> = {
    repay:       "REPAY",
    top_up:      "SUPPLY_COLLATERAL",
    deleverage:  "REPAY",
  };
  return {
    id:         `live-${makeId()}`,
    timestamp:  new Date().toISOString().replace("T", " ").slice(0, 19),
    positionId: pos.id,
    protocol:   pos.protocol,
    chain:      pos.chain,
    action:     actionMap[result.strategy],
    amount:     String(result.amount),
    asset:      result.asset,
    source:     result.source,
    hfBefore:   parseFloat(hfBefore.toFixed(2)),
    hfAfter:    parseFloat(result.newHF.toFixed(2)),
    txHash:     `0x${makeId()}${makeId()}…${makeId()}`,
    status:     "success",
    gasUsed:    `0.000${Math.floor(Math.random() * 400 + 180)} ETH`,
  };
}

/* ─────────────────────────────────────────────
   Telegram helper
───────────────────────────────────────────── */
type TelegramPayload = {
  type:        "hf_warning" | "trigger_fired" | "execution_success" | "execution_failed";
  positionId:  string;
  protocol:    string;
  chain:       string;
  hf:          number;
  triggerAt?:  number;
  targetHf?:   number;
  amount?:     number;
  asset?:      string;
};

async function sendTelegramAlert(payload: TelegramPayload) {
  try {
    await fetch("/api/alerts/notify", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });
  } catch { /* best-effort */ }
}

/* ─────────────────────────────────────────────
   Engine component
───────────────────────────────────────────── */
export function SimulationEngine() {
  const { state, dispatch } = useSimulation();

  const stateRef       = useRef(state);
  stateRef.current     = state;

  const baseEthRef     = useRef(3_400);
  const cooldownRef    = useRef<Map<string, number>>(new Map());
  const recoveryRef    = useRef<Map<string, number>>(new Map());
  const trendRef       = useRef<HFPoint[]>(state.hfTrend.slice(-TREND_MAX_POINTS));

  useEffect(() => {
    dispatch({ type: "SET_RUNNING", payload: true });

    const interval = setInterval(async () => {
      const s = stateRef.current;
      if (s.isPaused) return;

      const policy       = s.policy;
      const warnThreshold = policy.triggerHF + WARN_HF_MARGIN;

      /* ── 1. New ETH price ─────────────────────────────────────── */
      const newEthPrice  = nextEthPrice(s.ethPrice.price);
      const prevEthPrice = s.ethPrice.price;
      const change24h    = ((newEthPrice - baseEthRef.current) / baseEthRef.current) * 100;
      const now          = Date.now();

      /* ── 2. Recompute every position ─────────────────────────── */
      const updatedPositions: Position[] = s.positions.map((pos) => {
        const resumeAt = recoveryRef.current.get(pos.id) ?? 0;
        if (now < resumeAt) return pos;

        // Update collateral USD proportionally to price change
        const newCollateralUsd = pos.collateralUsd * (newEthPrice / prevEthPrice);
        const rawHF            = calcHF(newCollateralUsd, pos.debtUsd);
        const hf               = Math.max(1.01, Math.min(3.5, rawHF));
        const status           = hfStatus(hf, policy.triggerHF, warnThreshold);

        return {
          ...pos,
          hf:            parseFloat(hf.toFixed(3)),
          status,
          collateralUsd: Math.round(newCollateralUsd),
          lastChecked:   "just now",
        };
      });

      /* ── 3. Alert + remediation pass ─────────────────────────── */
      const newAlerts:   AlertEvent[]   = [];
      const newHistory:  HistoryEntry[] = [];
      const remediated:  Position[]     = updatedPositions.map((p) => ({ ...p }));
      const cdMap = cooldownRef.current;

      for (let i = 0; i < updatedPositions.length; i++) {
        const pos = updatedPositions[i];

        /* ── CRITICAL: trigger fired ──── */
        if (pos.status === "critical") {
          const cdKey  = `${pos.id}:critical`;
          const lastAt = cdMap.get(cdKey) ?? 0;
          if (now - lastAt < ALERT_COOLDOWN) continue;
          cdMap.set(cdKey, now);

          const result = remediate(pos, policy);

          /* alert: trigger fired */
          newAlerts.push({
            id:            makeId(),
            positionId:    pos.id,
            protocol:      pos.protocol,
            chain:         pos.chain,
            hf:            pos.hf,
            triggerAt:     policy.triggerHF,
            type:          "critical",
            strategy:      result?.strategy ?? null,
            message:       `🚨 TRIGGER FIRED — ${pos.protocol} (${pos.chain})\nHF ${pos.hf.toFixed(2)} ≤ trigger ${policy.triggerHF.toFixed(2)}\n${result ? `Executing: ${result.actionLabel}` : "⚠️ No strategy available — manual action required"}`,
            timestamp:     now,
            dismissed:     false,
            sentToTelegram: false,
          });

          if (result) {
            /* apply remediation to simulated position */
            remediated[i] = {
              ...pos,
              collateralUsd: Math.round(result.newCollateral),
              debtUsd:       Math.round(result.newDebt),
              hf:            parseFloat(result.newHF.toFixed(3)),
              status:        "safe",
            };

            newHistory.push(makeHistoryEntry(pos, result, pos.hf));
            recoveryRef.current.set(pos.id, now + RECOVERY_PAUSE);

            /* alert: executed */
            newAlerts.push({
              id:            makeId(),
              positionId:    pos.id,
              protocol:      pos.protocol,
              chain:         pos.chain,
              hf:            result.newHF,
              triggerAt:     policy.triggerHF,
              type:          "executed",
              strategy:      result.strategy,
              message:       `✅ EXECUTED — ${pos.protocol} (${pos.chain})\n${result.actionLabel} via ${result.source}\nHF: ${pos.hf.toFixed(2)} → ${result.newHF.toFixed(2)} (target ${policy.targetHF.toFixed(2)})`,
              timestamp:     now + 1_200,
              dismissed:     false,
              sentToTelegram: false,
            });

            if (s.telegramEnabled) {
              if (s.policy.notifTriggerFired)
                sendTelegramAlert({ type: "trigger_fired",     positionId: pos.id, hf: pos.hf,         triggerAt: policy.triggerHF, protocol: pos.protocol, chain: pos.chain });
              if (s.policy.notifExecSuccess)
                sendTelegramAlert({ type: "execution_success", positionId: pos.id, hf: result.newHF,   targetHf:  result.newHF,     protocol: pos.protocol, chain: pos.chain, amount: result.amount, asset: result.asset });
            }
          } else {
            if (s.telegramEnabled && s.policy.notifExecFailed) {
              sendTelegramAlert({ type: "execution_failed", positionId: pos.id, hf: pos.hf, triggerAt: policy.triggerHF, protocol: pos.protocol, chain: pos.chain });
            }
          }

        /* ── WARNING: approaching trigger ── */
        } else if (pos.status === "warning") {
          const cdKey  = `${pos.id}:warning`;
          const lastAt = cdMap.get(cdKey) ?? 0;
          if (now - lastAt < ALERT_COOLDOWN) continue;
          cdMap.set(cdKey, now);

          newAlerts.push({
            id:            makeId(),
            positionId:    pos.id,
            protocol:      pos.protocol,
            chain:         pos.chain,
            hf:            pos.hf,
            triggerAt:     policy.triggerHF,
            type:          "warning",
            strategy:      null,
            message:       `⚠️ WARNING — ${pos.protocol} (${pos.chain})\nHF ${pos.hf.toFixed(2)} — ${(pos.hf - policy.triggerHF).toFixed(2)} above trigger ${policy.triggerHF.toFixed(2)}\nTahansoe is watching.`,
            timestamp:     now,
            dismissed:     false,
            sentToTelegram: false,
          });

          if (s.telegramEnabled && s.policy.notifHfWarning) {
            sendTelegramAlert({ type: "hf_warning", positionId: pos.id, hf: pos.hf, triggerAt: policy.triggerHF, protocol: pos.protocol, chain: pos.chain });
          }
        }
      }

      /* ── 4. Roll the trend chart ──────────────────────────────── */
      const aaveHF   = remediated.find((p) => p.protocol === "Aave V3")?.hf   ?? 1.5;
      const morphoHF = remediated.find((p) => p.protocol === "Morpho Blue")?.hf ?? 1.5;
      const newPoint: HFPoint = {
        t:      nowLabel(),
        aave:   parseFloat(aaveHF.toFixed(3)),
        morpho: parseFloat(morphoHF.toFixed(3)),
      };
      const newTrend = [...trendRef.current, newPoint].slice(-TREND_MAX_POINTS);
      trendRef.current = newTrend;

      /* ── 5. Dispatch ──────────────────────────────────────────── */
      dispatch({
        type:    "TICK",
        payload: {
          positions: remediated,
          hfTrend:   newTrend,
          ethPrice:  {
            price:    Math.round(newEthPrice * 100) / 100,
            change24h: parseFloat(change24h.toFixed(2)),
          },
        },
      });

      for (const h of newHistory) dispatch({ type: "ADD_HISTORY", payload: h });
      for (const a of newAlerts)  dispatch({ type: "ADD_ALERT",   payload: a });

    }, TICK_MS);

    return () => {
      clearInterval(interval);
      dispatch({ type: "SET_RUNNING", payload: false });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

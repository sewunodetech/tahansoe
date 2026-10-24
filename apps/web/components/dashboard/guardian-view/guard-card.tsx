"use client";

import React from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, ShieldCheck } from "lucide-react";
import type { Heartbeat } from "@/hooks/useHeartbeat";
import type { PositionWithStatus } from "@/hooks/usePositions";
import { hfLabel, hfTone, TONE_VAR, usd } from "@/lib/positions/format";
import { heartbeatState } from "@/lib/positions/heartbeat";
import { PROTOCOL_LABEL } from "@/components/dashboard/positions/status-badge";
import type { Capacity } from "./capacity";
import { HeartbeatLine, useNow } from "./heartbeat-line";
import { HfTrack } from "./hf-track";
import { ReserveMeters } from "./reserve-meters";
import { ThresholdLine } from "./threshold-line";

export interface GuardCardProps {
  item: PositionWithStatus & { status: { kind: "protected" } };
  hf: number | null;
  heartbeat: Heartbeat;
  capacity: Capacity;
  rescueUsd: number;
}

/** One Protected position: how far it is from the trigger and from liquidation, and who is watching. */
export function GuardCard({ item, hf, heartbeat, capacity, rescueUsd }: GuardCardProps) {
  const reduce = useReducedMotion();
  const now = useNow(5_000);
  const { position, status } = item;
  const tone = hfTone(hf, status.triggerHf);
  // "On watch" only when a recent check backs it up (I6); otherwise the policy is merely armed.
  const watching = heartbeatState(heartbeat.checkedAt, now).kind === "fresh";

  return (
    <motion.article
      className="glass-surface relative overflow-hidden rounded-xl p-5 md:p-6"
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      aria-label={`${PROTOCOL_LABEL[position.protocol]} position on ${item.chainName}`}
    >
      {/* Status glow along the top edge */}
      <span
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{ background: `linear-gradient(90deg, transparent, ${TONE_VAR[tone]}, transparent)` }}
        aria-hidden="true"
      />

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1.5">
          <div className="flex items-center gap-2">
            <span
              className="inline-flex size-7 items-center justify-center rounded-lg border"
              style={{ borderColor: watching ? "var(--safe-border)" : "var(--warning-border)", background: watching ? "var(--safe-bg)" : "var(--warning-bg)" }}
            >
              <ShieldCheck className="size-4" style={{ color: watching ? "var(--safe)" : "var(--warning)" }} />
            </span>
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">
                {watching ? "Guardian on watch" : "Guardian armed"}
              </p>
              <p className="text-[11px] font-mono text-[var(--text-tertiary)]">
                {PROTOCOL_LABEL[position.protocol]} · {item.chainName} · {usd(Number(position.collateralValueUsd) / 1e8)} collateral ·{" "}
                {usd(Number(position.debtValueUsd) / 1e8)} debt
              </p>
            </div>
          </div>
          <HeartbeatLine heartbeat={heartbeat} />
        </div>

        <div className="text-right">
          <p className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]">Health Factor</p>
          <p className="font-display text-5xl leading-none tabular-nums transition-colors duration-300" style={{ color: TONE_VAR[tone] }}>
            {hfLabel(hf)}
          </p>
        </div>
      </header>

      <div className="mt-5">
        <HfTrack hf={hf} trigger={status.triggerHf} target={status.targetHf} />
      </div>

      <ThresholdLine position={position} trigger={status.triggerHf} className="mt-2" />

      {status.note && (
        <p className="mt-2 text-[11px] text-[var(--warning)]">{status.note}. Guardian v2 protects one debt asset per wallet.</p>
      )}

      <div className="mt-5 pt-5 border-t border-[var(--border)]">
        <ReserveMeters capacity={capacity} rescueUsd={rescueUsd} />
      </div>

      <footer className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--text-tertiary)]">
        <span>
          Below HF {status.triggerHf.toFixed(2)} the Guardian repays {status.debtSymbol} until HF is back at {status.targetHf.toFixed(2)}.
        </span>
        <Link href="/dashboard/protection" className="inline-flex items-center gap-1 text-[12px] text-[var(--brand)] hover:underline">
          Manage protection <ArrowRight className="size-3" />
        </Link>
      </footer>
    </motion.article>
  );
}

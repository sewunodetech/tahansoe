"use client";

import React from "react";
import { motion, useReducedMotion } from "motion/react";
import { LayerBadge } from "@/components/ui/layer-badge";
import { usd } from "@/lib/positions/format";
import type { Capacity, LayerCapacity } from "./capacity";

const LAYERS = [
  { id: 1 as const, key: "l1" as const, name: "Wallet reserve", hint: "Repays from your wallet" },
  { id: 2 as const, key: "l2" as const, name: "Position reserve", hint: "Redeems from your vault" },
  { id: 3 as const, key: "l3" as const, name: "Flash deleverage", hint: "Sells collateral as a last resort" },
];

/**
 * Reserve meters L1 / L2 / L3 (spec §3.7). Each bar shows how much of one rescue at the trigger
 * that layer covers on its own; a layer that is off says "off".
 */
export function ReserveMeters({ capacity, rescueUsd }: { capacity: Capacity; rescueUsd: number }) {
  const reduce = useReducedMotion();
  const covered = rescueUsd > 0 ? Math.min(capacity.totalUsd / rescueUsd, 9.99) : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]">Ready reserves</p>
        {rescueUsd > 0 && (
          <p className="text-[11px] font-mono text-[var(--text-tertiary)]">
            One rescue at the trigger repays ≈ <span className="text-[var(--text-secondary)]">{usd(rescueUsd)}</span>
            {covered !== null && (
              <>
                {" · "}
                <span style={{ color: covered >= 1 ? "var(--safe)" : "var(--warning)" }}>
                  {covered >= 1 ? "covered" : `${Math.round(covered * 100)}% covered`}
                </span>
              </>
            )}
          </p>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        {LAYERS.map((l) => {
          const cap = capacity[l.key] as LayerCapacity;
          const share = cap.on && rescueUsd > 0 ? Math.min(cap.usd / rescueUsd, 1) : 0;
          return (
            <div key={l.id} className="rounded-xl border border-[var(--border)] bg-[var(--bg-subtle)] px-3 py-2.5" data-off={!cap.on || undefined}>
              <div className="flex items-center justify-between gap-2">
                <LayerBadge layer={l.id} />
                <span className={`font-mono text-[13px] tabular-nums ${cap.on ? "text-[var(--text-primary)]" : "text-[var(--text-tertiary)]"}`}>
                  {cap.on ? cap.label : "off"}
                </span>
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-[var(--bg)] overflow-hidden">
                <motion.div
                  className="h-full rounded-full bg-[var(--brand)]"
                  initial={reduce ? false : { width: 0 }}
                  animate={{ width: `${share * 100}%` }}
                  transition={reduce ? { duration: 0 } : { duration: 0.6, ease: "easeOut" }}
                />
              </div>
              <p className="mt-1.5 text-[10.5px] text-[var(--text-tertiary)] truncate">
                {l.name} · {l.hint}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

"use client";

import React from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { hfLabel, hfTone, TONE_VAR } from "@/lib/positions/format";

export interface HfTrackProps {
  hf: number | null;
  trigger: number;
  target: number;
  className?: string;
}

const MIN = 0.9;

/** Scale end: room past the target and the current HF, without squeezing 1.0 → trigger. */
function scaleMax(hf: number | null, target: number): number {
  const wanted = Math.max(target + 0.6, (hf ?? 0) + 0.25, 2);
  return Math.min(wanted, Math.max(target + 1.2, 3));
}

/**
 * Horizontal Health Factor gauge (spec §3.7): liquidation at 1.0, the trigger where the Guardian
 * acts, the target it repays to, and the current HF. The marker glides to new values; with
 * prefers-reduced-motion it jumps.
 */
export function HfTrack({ hf, trigger, target, className }: HfTrackProps) {
  const reduce = useReducedMotion();
  const max = scaleMax(hf, target);
  const pct = (v: number) => Math.min(Math.max(((v - MIN) / (max - MIN)) * 100, 0), 100);
  const tone = hfTone(hf, trigger);
  const current = hf === null ? 100 : pct(hf);
  const offScale = hf !== null && hf > max;
  const spring = reduce ? { duration: 0 } : { type: "spring" as const, stiffness: 90, damping: 18, mass: 0.8 };

  const liq = pct(1);
  const trig = pct(trigger);
  const warnEnd = pct(trigger + 0.25);
  const tgt = pct(target);

  return (
    <div className={cn("w-full", className)}>
      {/* Current HF bubble */}
      <div className="relative h-9">
        <motion.div
          className="absolute bottom-1 -translate-x-1/2 flex flex-col items-center"
          initial={false}
          animate={{ left: `${Math.min(Math.max(current, 7), 93)}%` }}
          transition={spring}
        >
          <span
            className="rounded-md px-1.5 py-0.5 font-mono text-[11px] leading-none tabular-nums text-[var(--bg)] whitespace-nowrap"
            style={{ background: TONE_VAR[tone] }}
          >
            HF {hfLabel(hf)}
            {offScale ? " →" : ""}
          </span>
          <span className="mt-[3px] size-0 border-x-[4px] border-x-transparent border-t-[5px]" style={{ borderTopColor: TONE_VAR[tone] }} />
        </motion.div>
      </div>

      {/* Track */}
      <div
        className="relative h-3 rounded-full overflow-hidden bg-[var(--bg-subtle)] border border-[var(--border)]"
        role="meter"
        aria-label="Health Factor"
        aria-valuemin={MIN}
        aria-valuemax={Number(max.toFixed(2))}
        aria-valuenow={hf === null ? undefined : Number(Math.min(hf, max).toFixed(2))}
        aria-valuetext={`Health Factor ${hfLabel(hf)}. Guardian acts at ${trigger.toFixed(2)}, repays to ${target.toFixed(2)}, liquidation at 1.00.`}
      >
        <Zone from={0} to={liq} color="var(--danger)" opacity={0.55} />
        <Zone from={liq} to={trig} color="var(--danger)" opacity={0.18} />
        <Zone from={trig} to={warnEnd} color="var(--warning)" opacity={0.2} />
        <Zone from={warnEnd} to={100} color="var(--safe)" opacity={0.14} />

        {/* Fill up to the current HF */}
        <motion.div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ background: `linear-gradient(90deg, transparent, ${TONE_VAR[tone]})`, opacity: 0.55 }}
          initial={false}
          animate={{ width: `${current}%` }}
          transition={spring}
        />

        <Tick at={liq} className="bg-[var(--danger)]" />
        <Tick at={trig} className="bg-[var(--warning)]" />
        <Tick at={tgt} className="bg-[var(--safe)]" />

        <motion.span
          className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--bg-elevated)] shadow"
          style={{ background: TONE_VAR[tone] }}
          initial={false}
          animate={{ left: `${current}%` }}
          transition={spring}
        />
      </div>

      {/* Marker labels */}
      <div className="relative h-8 mt-1.5 text-[10px] font-mono leading-tight">
        <Label at={liq} align="start" color="var(--danger)" value="1.00" name="Liquidation" />
        <Label at={trig} align="center" color="var(--warning)" value={trigger.toFixed(2)} name="We act" />
        <Label at={tgt} align="center" color="var(--safe)" value={target.toFixed(2)} name="Target" />
      </div>
    </div>
  );
}

function Zone({ from, to, color, opacity }: { from: number; to: number; color: string; opacity: number }) {
  if (to <= from) return null;
  return <div className="absolute inset-y-0" style={{ left: `${from}%`, width: `${to - from}%`, background: color, opacity }} />;
}

function Tick({ at, className }: { at: number; className: string }) {
  return <span className={cn("absolute inset-y-0 w-[2px] -translate-x-1/2", className)} style={{ left: `${at}%` }} />;
}

function Label({ at, align, color, value, name }: { at: number; align: "start" | "center"; color: string; value: string; name: string }) {
  return (
    <span
      className={cn("absolute top-0 flex flex-col whitespace-nowrap", align === "center" ? "-translate-x-1/2 items-center" : "items-start")}
      style={{ left: `${at}%` }}
    >
      <span className="tabular-nums" style={{ color }}>
        {value}
      </span>
      <span className="text-[var(--text-tertiary)] uppercase tracking-wide text-[9px]">{name}</span>
    </span>
  );
}

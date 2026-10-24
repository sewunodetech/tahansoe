"use client";

import React, { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Heartbeat } from "@/hooks/useHeartbeat";
import { formatAge, heartbeatState } from "@/lib/positions/heartbeat";

/** Re-renders every second so "12 s ago" counts up. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

const UNAVAILABLE_COPY = {
  "sign-in": "Sign in with your wallet to see when the Sentinel last checked this position.",
  "not-deployed": "No check has been recorded for this position yet.",
  error: "Could not load the last check.",
} as const;

/**
 * "Checked 12 s ago by the Sentinel" with a pulsing dot (spec §3.7). A check older than
 * 10 minutes, or none at all, shows a warning and never claims live protection (I6).
 */
export function HeartbeatLine({ heartbeat, className }: { heartbeat: Heartbeat; className?: string }) {
  const now = useNow();
  const state = heartbeatState(heartbeat.checkedAt, now);
  const by = heartbeat.source === "simulation" ? "the simulation keeper" : "the Sentinel";

  if (heartbeat.isLoading) {
    return <p className={cn("text-[11px] font-mono text-[var(--text-tertiary)]", className)}>Looking up the last check…</p>;
  }

  if (state.kind === "fresh") {
    return (
      <p className={cn("flex items-center gap-2 text-[11px] font-mono text-[var(--text-secondary)]", className)} aria-live="polite">
        <span className="relative flex size-2 shrink-0" aria-hidden="true">
          <span className="absolute inline-flex size-full rounded-full bg-[var(--safe)] opacity-60 motion-safe:animate-ping" />
          <span className="relative inline-flex size-2 rounded-full bg-[var(--safe)]" />
        </span>
        <span>
          Checked <span className="tabular-nums text-[var(--text-primary)]">{formatAge(state.ageMs)}</span> ago by {by}
        </span>
      </p>
    );
  }

  const message =
    state.kind === "stale"
      ? `Last checked ${formatAge(state.ageMs)} ago by ${by}. Checks are late, so do not count on an automatic rescue right now.`
      : UNAVAILABLE_COPY[heartbeat.unavailable ?? "not-deployed"];

  return (
    <p
      className={cn(
        "flex items-start gap-2 rounded-lg border border-[var(--warning-border)] bg-[var(--warning-bg)] px-2.5 py-1.5 text-[11px] text-[var(--warning)]",
        className
      )}
      role="status"
    >
      <AlertTriangle className="size-3.5 shrink-0 mt-px" />
      <span>{message}</span>
    </p>
  );
}

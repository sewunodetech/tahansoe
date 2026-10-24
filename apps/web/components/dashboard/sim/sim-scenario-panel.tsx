"use client";

import React, { useState } from "react";
import { Activity, Clock, TrendingDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SimApiError, useSimActions, useSimSession, useSimStatus } from "@/lib/sim/hooks";
import { CRASH_PCTS, SIM_MODES, SIM_SCENARIOS, type SimMode, type SimScenarioId } from "@/lib/sim/types";
import { useSimDashboard } from "./sim-context";

const MODE_COPY: Record<SimMode, { label: string; hint: string }> = {
  live: { label: "Live", hint: "Shared fork, ETH follows Arbitrum One in real time." },
  replay: { label: "Replay", hint: "Private fork, replays a historical crash in about 3 minutes." },
  stress: { label: "Stress", hint: "Private fork, live price until you press a crash button." },
};

/** Price mode switch, replay picker and crash buttons (spec m1-simulation-mode §2, §3.3). */
export function SimScenarioPanel() {
  const { data: session } = useSimSession();
  const { data: status } = useSimStatus(Boolean(session));
  const { switchMode, runScenario } = useSimActions();
  const { reset } = useSimDashboard();
  const [scenario, setScenario] = useState<SimScenarioId>(session?.scenario ?? SIM_SCENARIOS[0].id);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mode = session?.mode ?? "live";

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (err) {
      if (err instanceof SimApiError && err.status === 409) {
        const wait = Number(err.body.retryAfterSec ?? 60);
        setError(`All private forks are in use. Try again in about ${Math.ceil(wait / 60)} min, or stay in Live mode.`);
      } else {
        setError(err instanceof Error ? err.message : "Request failed");
      }
    } finally {
      setBusy(null);
    }
  };

  const handleMode = (next: SimMode) => {
    if (!session || next === mode) return;
    run(`mode:${next}`, async () => {
      await switchMode(session.address, next, next === "replay" ? scenario : undefined);
      reset();
    });
  };

  const handleReplay = () => {
    if (!session) return;
    run("replay", async () => {
      if (mode !== "replay") {
        await switchMode(session.address, "replay", scenario);
        reset();
      } else {
        await runScenario({ kind: "replay", scenario });
      }
    });
  };

  const selected = SIM_SCENARIOS.find((s) => s.id === scenario);
  const progress = status?.scenarioProgress;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <Activity className="size-4 text-[var(--brand)]" /> Market scenario
        </CardTitle>
        <CardDescription className="text-xs">{MODE_COPY[mode].hint}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div role="radiogroup" aria-label="Price mode" className="grid grid-cols-3 gap-1 p-1 rounded-full border border-[var(--border)] bg-[var(--bg-subtle)]">
          {SIM_MODES.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              disabled={busy !== null}
              onClick={() => handleMode(m)}
              className={`h-8 rounded-full text-xs font-mono transition-colors cursor-pointer disabled:cursor-wait ${
                mode === m
                  ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-sm"
                  : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
              }`}
            >
              {busy === `mode:${m}` ? "…" : MODE_COPY[m].label}
            </button>
          ))}
        </div>
        {mode !== "live" && (
          <p className="text-[11px] text-[var(--text-tertiary)]">
            Switching mode opens a new fork, so set up the position again (Auto-fill takes a few seconds).
          </p>
        )}

        <div className="space-y-2">
          <label htmlFor="sim-scenario" className="text-[11px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]">
            Historical replay
          </label>
          <div className="flex flex-col sm:flex-row gap-2">
            <select
              id="sim-scenario"
              value={scenario}
              onChange={(e) => setScenario(e.target.value as SimScenarioId)}
              className="flex-1 h-9 px-3 rounded-[10px] border border-[var(--border)] bg-[var(--bg-subtle)] text-xs text-[var(--text-primary)]"
            >
              {SIM_SCENARIOS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <Button size="sm" variant="secondary" onClick={handleReplay} disabled={busy !== null}>
              <Clock /> {mode === "replay" ? "Restart replay" : "Replay"}
            </Button>
          </div>
          {selected?.normalized && (
            <p className="text-[11px] text-[var(--text-tertiary)]">Prices normalized to the fork&apos;s starting ETH price (no Arbitrum data for 2020).</p>
          )}
          {mode === "replay" && typeof progress === "number" && (
            <div className="h-1.5 rounded-full bg-[var(--bg-overlay)] overflow-hidden" aria-label="Replay progress">
              <div className="h-full bg-[var(--brand)] transition-[width] duration-700" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-[11px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]">Crash the price</p>
          <div className="grid grid-cols-3 gap-2">
            {CRASH_PCTS.map((pct) => (
              <Button
                key={pct}
                size="sm"
                variant="danger"
                disabled={mode !== "stress" || busy !== null}
                onClick={() => run(`crash:${pct}`, () => runScenario({ kind: "crash", pct }))}
              >
                <TrendingDown /> −{pct}%
              </Button>
            ))}
          </div>
          <p className="text-[11px] text-[var(--text-tertiary)]">
            {mode === "stress"
              ? "The price ramps down over about 20 seconds so the keeper and the dashboard can follow."
              : "Available in Stress mode."}
          </p>
        </div>

        {error && (
          <p role="alert" className="text-[11px] text-[var(--danger)]">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

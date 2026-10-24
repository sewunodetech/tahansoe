"use client";

import React, { useState } from "react";
import { Activity, Clock, Loader2, Radio, TrendingDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SimApiError, useSimActions, useSimSession, useSimStatus } from "@/lib/sim/hooks";
import { CRASH_PCTS, SIM_SCENARIOS, type SimMode, type SimScenarioId } from "@/lib/sim/types";
import { useSimDashboard } from "./sim-context";

const MARKETS: { mode: SimMode; title: string; body: string; icon: React.ElementType }[] = [
  { mode: "replay", title: "Replay a real crash", body: "Relive a historical ETH crash in about 3 minutes.", icon: Clock },
  { mode: "stress", title: "Stress test", body: "Live price, then you drop it by 10, 30 or 50%.", icon: TrendingDown },
  { mode: "live", title: "Live market", body: "ETH follows Arbitrum One in real time. Usually calm.", icon: Radio },
];

/** Turns a 409 from simnet into a sentence; other errors pass through. */
function describe(err: unknown): string {
  if (err instanceof SimApiError && err.status === 409) {
    const wait = Number(err.body.retryAfterSec ?? 60);
    return `All private forks are in use. Try again in about ${Math.ceil(wait / 60)} min, or pick Live market.`;
  }
  return err instanceof Error ? err.message : "Request failed";
}

/**
 * Step 1: pick the market before opening a position. Each choice runs on its own fork, so picking
 * it first means the position is never lost to a later switch.
 */
export function SimChooseMarket() {
  const { data: session } = useSimSession();
  const { switchMode } = useSimActions();
  const { reset, setMarketChosen } = useSimDashboard();
  const [scenario, setScenario] = useState<SimScenarioId>(session?.scenario ?? SIM_SCENARIOS[0].id);
  const [busy, setBusy] = useState<SimMode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const choose = async (mode: SimMode) => {
    if (!session) return;
    setBusy(mode);
    setError(null);
    try {
      const same = mode === session.mode && (mode !== "replay" || scenario === session.scenario);
      if (!same) {
        await switchMode(session.address, mode, mode === "replay" ? scenario : undefined);
        reset();
      }
      setMarketChosen(true);
    } catch (err) {
      setError(describe(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <Activity className="size-4 text-[var(--brand)]" /> What should the market do?
        </CardTitle>
        <CardDescription className="text-xs">Pick one. You can come back and try another later.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {MARKETS.map(({ mode, title, body, icon: Icon }) => (
          <div key={mode} className="rounded-md border border-[var(--border)] p-3.5 flex flex-col sm:flex-row sm:items-center gap-3">
            <Icon className="size-4 text-[var(--text-secondary)] shrink-0 hidden sm:block" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-[var(--text-primary)]">{title}</p>
              <p className="text-[11px] text-[var(--text-tertiary)]">{body}</p>
              {mode === "replay" && (
                <select
                  aria-label="Historical crash"
                  value={scenario}
                  onChange={(e) => setScenario(e.target.value as SimScenarioId)}
                  className="mt-2 w-full sm:max-w-[300px] h-8 px-2.5 rounded-md border border-[var(--border)] bg-[var(--bg-subtle)] text-xs text-[var(--text-primary)]"
                >
                  {SIM_SCENARIOS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <Button size="sm" variant={mode === "live" ? "secondary" : "primary"} disabled={busy !== null} onClick={() => choose(mode)} className="shrink-0 self-start sm:self-center">
              {busy === mode ? <Loader2 className="animate-spin" /> : null} Choose
            </Button>
          </div>
        ))}
        {busy && busy !== "live" && <p className="text-[11px] text-[var(--text-tertiary)]">Starting a private fork of Arbitrum One, about 20 seconds…</p>}
        {error && (
          <p role="alert" className="text-[11px] text-[var(--danger)]">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** Step 3: run the market the visitor picked and watch the Guardian react. */
export function SimRunMarket() {
  const { data: session } = useSimSession();
  const { data: status } = useSimStatus(Boolean(session));
  const { runScenario } = useSimActions();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mode = session?.mode ?? "live";
  const scenario = SIM_SCENARIOS.find((s) => s.id === session?.scenario) ?? SIM_SCENARIOS[0];
  const progress = status?.scenarioProgress;

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(describe(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">
          {mode === "replay" ? `Replay: ${scenario.label}` : mode === "stress" ? "Drop the ETH price" : "Watching the live market"}
        </CardTitle>
        <CardDescription className="text-xs">
          {mode === "live"
            ? "The price follows Arbitrum One. The Guardian acts only if the real market falls to your trigger."
            : "Keep an eye on the Health Factor above: when it reaches your trigger, the Guardian repays debt on its own."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {mode === "replay" && (
          <>
            <Button size="sm" disabled={busy !== null} onClick={() => run("replay", () => runScenario({ kind: "replay", scenario: scenario.id }))}>
              {busy === "replay" ? <Loader2 className="animate-spin" /> : <Clock />} {typeof progress === "number" ? "Restart replay" : "Start replay"}
            </Button>
            {typeof progress === "number" && (
              <div className="h-1.5 rounded-full bg-[var(--bg-overlay)] overflow-hidden" aria-label="Replay progress">
                <div className="h-full bg-[var(--brand)] transition-[width] duration-700" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
            )}
            {scenario.normalized && <p className="text-[11px] text-[var(--text-tertiary)]">Prices are scaled to today&apos;s ETH price (no Arbitrum data for 2020).</p>}
          </>
        )}

        {mode === "stress" && (
          <>
            <div className="grid grid-cols-3 gap-2">
              {CRASH_PCTS.map((pct) => (
                <Button key={pct} size="sm" variant="danger" disabled={busy !== null} onClick={() => run(`crash:${pct}`, () => runScenario({ kind: "crash", pct }))}>
                  <TrendingDown /> −{pct}%
                </Button>
              ))}
            </div>
            <p className="text-[11px] text-[var(--text-tertiary)]">The price slides down over about 20 seconds.</p>
          </>
        )}

        {status && (
          <p className="text-[11px] font-mono text-[var(--text-secondary)]">
            ETH ${status.price.toLocaleString("en-US", { maximumFractionDigits: 2 })} · source {status.priceSource}
          </p>
        )}
        {error && (
          <p role="alert" className="text-[11px] text-[var(--danger)]">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

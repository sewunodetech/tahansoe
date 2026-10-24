"use client";

import React, { useState } from "react";
import { Check, ChevronDown, MessageCircleOff, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LiveOverview } from "@/components/dashboard/live/live-overview";
import { LivePage } from "@/components/dashboard/live/live-page";
import { useGuardian } from "@/hooks/useGuardian";
import { useSimSession, useSimStatus } from "@/lib/sim/hooks";
import { SimChooseMarket, SimRunMarket } from "./sim-scenario-panel";
import { SimSetupWizard } from "./sim-setup-wizard";
import { SimTxList } from "./sim-tx-list";
import { SimWithoutPanel } from "./sim-without-panel";
import { SimTopUp } from "./sim-topup";
import { SimCta } from "./sim-cta";
import { useSimDashboard } from "./sim-context";

const STEPS = [
  { title: "Pick a market", hint: "A real crash, a stress test, or live prices" },
  { title: "Open a position", hint: "Borrow against ETH with fake funds" },
  { title: "Run it", hint: "Watch the Guardian step in" },
] as const;

const usd = (v: number) => `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

/**
 * Overview in Simulation Mode: one guided path (open → move the market → result) so a first-time
 * visitor sees one thing at a time. The step follows the fork state; finished steps stay clickable.
 */
export function SimDashboard() {
  const g = useGuardian();
  const { data: session } = useSimSession();
  const { data: status } = useSimStatus(Boolean(session));
  const { marketChosen } = useSimDashboard();

  const hasPosition = (g.account?.debtUsd ?? 0) > 0;
  const protectionOn = Boolean(g.policy?.enabled);
  const protections = status?.events.filter((e) => e.type === "protected").length ?? 0;
  // After a reload the in-memory choice is gone, but an open position proves the market was picked.
  const auto = !(marketChosen || hasPosition) ? 0 : !hasPosition || !protectionOn ? 1 : 2;

  // A manual pick only holds while the fork stays at the step it was made on.
  const [picked, setPicked] = useState<{ step: number; at: number } | null>(null);
  const step = picked && picked.at === auto ? picked.step : auto;

  return (
    <LivePage
      eyebrow="Simulation"
      title="Try the Guardian on a fork"
      subtitle="Three steps, fake funds, real contracts. About two minutes."
    >
      <PositionStrip
        collateralUsd={g.account?.collateralUsd ?? 0}
        debtUsd={g.account?.debtUsd ?? 0}
        hf={g.account?.hf ?? null}
        trigger={g.policy?.enabled ? g.policy.triggerHf : null}
      />

      <ol className="grid grid-cols-3 gap-2" aria-label="Simulation steps">
        {STEPS.map((s, i) => {
          const done = i < auto;
          const active = i === step;
          const locked = i > auto;
          return (
            <li key={s.title}>
              <button
                type="button"
                disabled={locked}
                aria-current={active ? "step" : undefined}
                onClick={() => setPicked({ step: i, at: auto })}
                className={`w-full h-full text-left rounded-[14px] border px-3 py-2.5 transition-colors ${
                  active
                    ? "border-[var(--brand)] bg-[var(--brand-bg)]"
                    : locked
                      ? "border-[var(--border)] opacity-50 cursor-not-allowed"
                      : "border-[var(--border)] hover:bg-[var(--bg-hover)] cursor-pointer"
                }`}
              >
                <span className="flex items-center gap-2">
                  <span
                    className={`size-5 shrink-0 rounded-full flex items-center justify-center text-[10px] font-mono ${
                      done ? "bg-[var(--safe)] text-white" : active ? "bg-[var(--brand)] text-white" : "border border-[var(--border-strong)] text-[var(--text-tertiary)]"
                    }`}
                  >
                    {done ? <Check className="size-3" /> : i + 1}
                  </span>
                  <span className="text-xs font-medium text-[var(--text-primary)] truncate">{s.title}</span>
                </span>
                <span className="hidden sm:block mt-1 pl-7 text-[11px] text-[var(--text-tertiary)]">{s.hint}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="max-w-[760px]">
        {step === 0 && <SimChooseMarket />}
        {step === 1 && <SimSetupWizard />}
        {step === 2 && (
          <div className="space-y-5">
            <SimRunMarket />
            {protections > 0 && <ResultStep hf={g.account?.hf ?? null} protections={protections} />}
          </div>
        )}
      </div>

      <details className="group max-w-[760px]">
        <summary className="cursor-pointer list-none inline-flex items-center gap-1.5 text-[11px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] select-none">
          <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" /> Advanced: transactions, top-up, full position details
        </summary>
        <div className="mt-4 space-y-5">
          {protections === 0 && <SimTxList />}
          <SimTopUp />
          <LiveOverview />
        </div>
      </details>
    </LivePage>
  );
}

function PositionStrip({ collateralUsd, debtUsd, hf, trigger }: { collateralUsd: number; debtUsd: number; hf: number | null; trigger: number | null }) {
  const hfColor =
    hf === null ? "text-[var(--text-tertiary)]" : hf < 1 ? "text-[var(--danger)]" : trigger !== null && hf < trigger + 0.25 ? "text-[var(--warning)]" : "text-[var(--safe)]";
  const items = [
    { label: "Collateral", value: collateralUsd > 0 ? usd(collateralUsd) : "—" },
    { label: "Debt", value: debtUsd > 0 ? usd(debtUsd) : "—" },
    { label: "Health Factor", value: hf === null ? "—" : hf.toFixed(2), className: hfColor },
    { label: "Protection", value: trigger !== null ? `On · trigger ${trigger.toFixed(2)}` : "Off" },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 rounded-[16px] border border-[var(--border)] divide-x divide-y md:divide-y-0 divide-[var(--border)] overflow-hidden">
      {items.map((it) => (
        <div key={it.label} className="px-4 py-3">
          <p className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]">{it.label}</p>
          <p className={`mt-0.5 text-lg font-mono font-light ${it.className ?? "text-[var(--text-primary)]"}`}>{it.value}</p>
        </div>
      ))}
    </div>
  );
}

function ResultStep({ hf, protections }: { hf: number | null; protections: number }) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
        <Card className="border-[var(--safe-border)]">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <ShieldCheck className="size-4 text-[var(--safe)]" /> With Tahansoe
            </CardTitle>
            <CardDescription className="text-xs">
              The Guardian stepped in {protections} {protections === 1 ? "time" : "times"}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-[12px] border border-[var(--border)] bg-[var(--bg-subtle)] p-3">
              <p className="text-[10px] font-mono uppercase text-[var(--text-tertiary)]">Health Factor now</p>
              <p className="text-xl font-mono font-light text-[var(--safe)]">{hf === null ? "—" : hf.toFixed(2)}</p>
            </div>
            <p className="mt-3 text-[11px] text-[var(--text-tertiary)] leading-relaxed">
              {hf === null || hf >= 1
                ? "Still above 1.0: no liquidation, no penalty. The success fee applies only when HF fell below your own trigger."
                : "The drop outran the reserves you approved. Bigger caps or Layer 3 would have repaid more."}
            </p>
          </CardContent>
        </Card>
        <SimWithoutPanel />
      </div>
      <SimTxList />
      <SimCta />
    </div>
  );
}

/** Shown instead of pages that need a real account (Telegram linking) while simulating. */
export function SimUnavailable({ feature }: { feature: string }) {
  return (
    <div className="w-full p-5 md:p-8">
      <Card className="p-6 flex items-start gap-3 max-w-[640px]">
        <MessageCircleOff className="size-5 text-[var(--text-tertiary)] shrink-0 mt-0.5" />
        <div>
          <p className="text-sm text-[var(--text-primary)]">{feature} is not available in Simulation Mode</p>
          <p className="text-xs text-[var(--text-tertiary)] mt-1">
            The simulation wallet has no account. Connect a real wallet to use {feature.toLowerCase()}.
          </p>
        </div>
      </Card>
    </div>
  );
}

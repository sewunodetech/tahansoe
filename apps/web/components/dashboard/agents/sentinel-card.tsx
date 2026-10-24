"use client";

import React, { useState } from "react";
import {
  Bot,
  Sparkles,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { StatusPill } from "@/components/ui/status-pill";
import { ZoneBar } from "@/components/ui/zone-bar";
import { Eyebrow } from "@/components/ui/eyebrow";
import { useProtection } from "@/hooks/useProtection";

export interface SentinelAlertEvent {
  id: string;
  type: "warning" | "critical" | "remediated" | "normal";
  hf: number;
  triggerHf: number;
  timestamp: string;
  headline: string;
  aiExplanation: string;
  actionTaken: string;
}

const SENTINEL_LOG: SentinelAlertEvent[] = [
  {
    id: "sentinel-01",
    type: "warning",
    hf: 1.42,
    triggerHf: 1.30,
    timestamp: "Today 14:22 UTC",
    headline: "HF Approaching Trigger Margin (1.42 vs 1.30 trigger)",
    aiExplanation:
      "ETH spot declined 3.6% over a 15-minute window following concentrated sell pressure. Position collateral compressed from $14,280 to $13,760 while USDC debt stayed fixed at $5,400. Sentinel generated advisory early alert.",
    actionTaken: "Advisory alert pushed via Telegram. Readying Layer 1 Hot Reserve (500 USDC available).",
  },
  {
    id: "sentinel-02",
    type: "remediated",
    hf: 1.28,
    triggerHf: 1.30,
    timestamp: "Oct 19, 2026 14:32 UTC",
    headline: "Trigger Fired: Cascade Repay Executed at HF 1.28",
    aiExplanation:
      "Rapid wick down to $3,210 pushed HF below user policy trigger (1.28 ≤ 1.30). Deterministic contract keeper triggered Layer 1 Wallet Reserve. $500 USDC transferred to Aave V3 debt repayment.",
    actionTaken: "Repay successful. Position HF safely restored to 1.62 (+0.34 delta). Zero liquidation penalties incurred.",
  },
  {
    id: "sentinel-03",
    type: "normal",
    hf: 1.82,
    triggerHf: 1.30,
    timestamp: "Oct 18, 2026 09:00 UTC",
    headline: "Routine Keeper Multicall Health Verification",
    aiExplanation:
      "Oracle prices stable across Uniswap V3 and Chainlink feeds. Position collateralization ratio is 264% with an optimal safety margin. All 3 protection layers verified ready.",
    actionTaken: "Status logged. No on-chain action required.",
  },
];

export function SentinelCard() {
  const { hf, zone, policy, actions } = useProtection();
  const [selectedEventId, setSelectedEventId] = useState<string>(SENTINEL_LOG[0].id);

  const selectedEvent =
    SENTINEL_LOG.find((e) => e.id === selectedEventId) ?? SENTINEL_LOG[0];

  return (
    <Card className="flex flex-col justify-between">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="size-9 rounded-lg bg-[var(--safe-bg)] border border-[var(--border)] flex items-center justify-center">
              <Bot className="size-4 text-[var(--safe)]" strokeWidth={1.8} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <CardTitle className="text-base">Agent 2: HF Sentinel</CardTitle>
                <StatusPill zone={zone} size="sm" />
              </div>
              <CardDescription>Deterministic keeper + AI risk telemetry advisor</CardDescription>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* 'AI explains, rules execute' Architectural Framing Banner */}
        <div className="p-3.5 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border)] space-y-1.5">
          <div className="flex items-center gap-2">
            <Eyebrow dot variant="brand">
              Core Principle
            </Eyebrow>
            <span className="text-[11px] font-semibold text-[var(--text-primary)]">
              AI Explains, Rules Execute
            </span>
          </div>
          <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
            Smart contract keepers execute mathematical rules deterministically when HF drops below your trigger threshold. The Sentinel AI acts purely as an advisor to explain volatility. <strong>AI never signs transactions or holds keys</strong>.
          </p>
        </div>

        {/* Thresholds and Health Factor Gauge Bar */}
        <div className="p-4 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border)] space-y-3">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-[var(--text-tertiary)] uppercase tracking-wider">
              Selected Position Health
            </span>
            <span className="text-sm font-semibold text-[var(--text-primary)]">
              HF {hf.toFixed(2)}
            </span>
          </div>

          <ZoneBar hf={hf} trigger={policy.triggerHF} target={policy.targetHF} />

          <div className="grid grid-cols-3 gap-2 pt-2 border-t border-[var(--border)] text-xs font-mono">
            <div className="p-2 rounded bg-[var(--bg-elevated)] border border-[var(--border)]">
              <span className="text-[9px] uppercase text-[var(--text-tertiary)]">Trigger HF</span>
              <p className="text-xs font-semibold text-[var(--warning)]">
                {policy.triggerHF.toFixed(2)}
              </p>
              <span className="text-[9px] text-[var(--text-tertiary)]">Keeper executes</span>
            </div>
            <div className="p-2 rounded bg-[var(--bg-elevated)] border border-[var(--border)]">
              <span className="text-[9px] uppercase text-[var(--text-tertiary)]">Warning Margin</span>
              <p className="text-xs font-semibold text-[var(--brand)]">
                {(policy.triggerHF + 0.15).toFixed(2)}
              </p>
              <span className="text-[9px] text-[var(--text-tertiary)]">AI alerts user</span>
            </div>
            <div className="p-2 rounded bg-[var(--bg-elevated)] border border-[var(--border)]">
              <span className="text-[9px] uppercase text-[var(--text-tertiary)]">Target HF</span>
              <p className="text-xs font-semibold text-[var(--safe)]">
                {policy.targetHF.toFixed(2)}
              </p>
              <span className="text-[9px] text-[var(--text-tertiary)]">Restored goal</span>
            </div>
          </div>
        </div>

        {/* Sentinel Alert Log with AI Explanation */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[var(--text-primary)] font-mono uppercase tracking-wider">
              Sentinel Telemetry Log ({SENTINEL_LOG.length})
            </span>
            <span className="text-[10px] font-mono text-[var(--text-tertiary)]">
              Multicall keeper 60s cadence
            </span>
          </div>

          {/* Event selector tabs */}
          <div className="flex items-center gap-1 p-1 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border)]">
            {SENTINEL_LOG.map((evt) => (
              <button
                key={evt.id}
                type="button"
                onClick={() => setSelectedEventId(evt.id)}
                className={`flex-1 py-1.5 px-2 rounded-md text-xs font-mono text-center transition-all cursor-pointer truncate ${
                  selectedEventId === evt.id
                    ? "bg-[var(--item-active-bg)] text-[var(--text-primary)] font-medium shadow-xs"
                    : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                }`}
              >
                {evt.type === "warning" ? "Warning Alert" : evt.type === "remediated" ? "Execution Log" : "Routine Check"}
              </button>
            ))}
          </div>

          {/* Detailed Selected Event AI Explanation Card */}
          <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--bg-subtle)] space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono text-[var(--text-tertiary)]">
                {selectedEvent.timestamp}
              </span>
              <span
                className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                  selectedEvent.type === "warning"
                    ? "bg-[var(--warning-bg)] border-[var(--warning-border)] text-[var(--warning)]"
                    : selectedEvent.type === "remediated"
                    ? "bg-[var(--safe-bg)] border-[var(--safe-border)] text-[var(--safe)]"
                    : "bg-[var(--bg-elevated)] border-[var(--border)] text-[var(--text-secondary)]"
                }`}
              >
                HF {selectedEvent.hf.toFixed(2)}
              </span>
            </div>

            <p className="text-xs font-semibold text-[var(--text-primary)]">
              {selectedEvent.headline}
            </p>

            {/* AI Explanation Box */}
            <div className="p-3 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)] space-y-1.5">
              <div className="flex items-center gap-1.5 text-[10px] font-mono text-[var(--brand)] uppercase tracking-wider font-semibold">
                <Sparkles className="size-3" />
                <span>Sentinel AI Diagnostic Analysis</span>
              </div>
              <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                {selectedEvent.aiExplanation}
              </p>
            </div>

            {/* Action Taken */}
            <div className="text-[11px] font-mono text-[var(--text-tertiary)] flex items-start gap-1.5 pt-1">
              <span className="text-[var(--safe)] shrink-0">✓</span>
              <span><strong>Action:</strong> {selectedEvent.actionTaken}</span>
            </div>
          </div>
        </div>

        {/* Early Warning Notification Switch */}
        <div className="flex items-center justify-between p-3.5 rounded-xl border border-[var(--border)] bg-[var(--card)]">
          <div className="space-y-0.5">
            <p className="text-xs font-medium text-[var(--text-primary)]">
              Early Warning Alerts
            </p>
            <p className="text-[11px] text-[var(--text-tertiary)]">
              Receive Sentinel AI advisory warning before trigger fires
            </p>
          </div>
          <Switch
            checked={policy.notifHfWarning}
            onCheckedChange={(checked) => actions.setPolicy({ notifHfWarning: checked })}
          />
        </div>
      </CardContent>
    </Card>
  );
}

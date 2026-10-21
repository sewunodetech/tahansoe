"use client";

import React, { useState } from "react";
import { Bot, Newspaper } from "lucide-react";
import { useProtection } from "@/hooks/useProtection";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { StatusPill } from "@/components/ui/status-pill";

export default function AgentsPage() {
  const { hf, zone, policy, actions } = useProtection();
  const [pulseSubscribed, setPulseSubscribed] = useState(true);

  return (
    <div className="w-full p-5 md:p-7 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="font-display text-2xl md:text-3xl font-light text-[var(--text-primary)]">
          AI Intelligence Agents
        </h1>
        <p className="text-xs text-[var(--text-tertiary)] mt-1 font-mono">
          Market Pulse research briefs and 24/7 HF Sentinel rule monitoring
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Agent 1: Market Pulse */}
        <Card className="flex flex-col justify-between">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-[var(--brand-bg)] border border-[var(--border)] flex items-center justify-center">
                  <Newspaper className="w-4 h-4 text-[var(--brand)]" strokeWidth={1.8} />
                </div>
                <div>
                  <CardTitle>Agent 1: Market Pulse</CardTitle>
                  <CardDescription>DeFi risk research & macro broadcast</CardDescription>
                </div>
              </div>
              <Badge variant="brand" dot>Active</Badge>
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="p-4 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border)] space-y-2">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-[var(--text-tertiary)]">Latest Pulse · 08:00 UTC</span>
                <span className="text-[var(--safe)]">Arbitrum / Aave V3</span>
              </div>
              <p className="text-xs text-[var(--text-secondary)] leading-relaxed font-sans">
                &ldquo;ETH lending utilisation remains elevated at 78.4%. Arbitrum base borrow APY is 3.12%. Liquidations across lending markets spiked 4% in past 24h as spot tested $3,350 support. No debt caps at risk.&rdquo;
              </p>
              <div className="text-[10px] text-[var(--text-tertiary)] font-mono flex items-center gap-2 pt-1 border-t border-[var(--border)]">
                <span>Structured data → LLM verified</span>
                <span>•</span>
                <span>Not financial advice</span>
              </div>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg border border-[var(--border)] bg-[var(--card)]">
              <div>
                <p className="text-xs font-medium text-[var(--text-primary)]">Telegram Broadcast</p>
                <p className="text-[11px] text-[var(--text-tertiary)]">Receive daily brief in your Telegram feed</p>
              </div>
              <Switch checked={pulseSubscribed} onCheckedChange={setPulseSubscribed} />
            </div>
          </CardContent>
        </Card>

        {/* Agent 2: HF Sentinel */}
        <Card className="flex flex-col justify-between">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-[var(--safe-bg)] border border-[var(--border)] flex items-center justify-center">
                  <Bot className="w-4 h-4 text-[var(--safe)]" strokeWidth={1.8} />
                </div>
                <div>
                  <CardTitle>Agent 2: HF Sentinel</CardTitle>
                  <CardDescription>Deterministic keeper + AI risk advisory</CardDescription>
                </div>
              </div>
              <StatusPill zone={zone} />
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="p-4 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border)] space-y-3">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-[var(--text-tertiary)]">Current Health Factor</span>
                <span className="text-[var(--text-primary)] font-medium text-sm">{hf.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-[var(--text-tertiary)]">Trigger Threshold</span>
                <span className="text-[var(--warning)]">{policy.triggerHF.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-[var(--text-tertiary)]">Target Restored HF</span>
                <span className="text-[var(--safe)]">{policy.targetHF.toFixed(2)}</span>
              </div>
              <div className="p-2.5 rounded bg-[var(--bg-elevated)] border border-[var(--border)] text-[11px] text-[var(--text-secondary)]">
                <p className="font-semibold text-[var(--brand)] mb-0.5 font-mono text-[10px] uppercase">
                  Rule execution policy
                </p>
                Execution is 100% deterministic via smart contract checks. The AI Sentinel acts as an advisor to explain volatility and never signs transactions.
              </div>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg border border-[var(--border)] bg-[var(--card)]">
              <div>
                <p className="text-xs font-medium text-[var(--text-primary)]">Early Warning Alerts</p>
                <p className="text-[11px] text-[var(--text-tertiary)]">Alert when HF approaches within 0.15 of trigger</p>
              </div>
              <Switch
                checked={policy.notifHfWarning}
                onCheckedChange={(checked) => actions.setPolicy({ notifHfWarning: checked })}
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

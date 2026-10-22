"use client";

import React, { useState } from "react";
import { Send, CheckCircle2, Newspaper, Bot, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { TELEGRAM_BOT_USERNAME } from "@/lib/telegram";

export interface StepTelegramProps {
  onComplete: () => void;
  telegramUsername?: string;
}

export function StepTelegram({ onComplete, telegramUsername: defaultUsername }: StepTelegramProps) {
  const [handle, setHandle] = useState(defaultUsername ?? "");
  const [marketPulseOptIn, setMarketPulseOptIn] = useState(true);
  const [sentinelAlertsOptIn, setSentinelAlertsOptIn] = useState(true);
  const [connected, setConnected] = useState(false);

  const botUsername = TELEGRAM_BOT_USERNAME;

  const handleConnect = () => {
    if (handle.trim()) {
      setConnected(true);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-light text-[var(--text-primary)] font-display">
          Connect Telegram & AI Agents
        </h2>
        <p className="text-xs text-[var(--text-tertiary)] mt-1">
          Receive real-time HF Sentinel emergency notifications and Agent 1 Market Pulse daily intelligence.
        </p>
      </div>

      <Card className="p-5 space-y-5">
        {/* Telegram Connect Section */}
        <div className="p-4 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border)] space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-[var(--brand-bg)] border border-[var(--border)] flex items-center justify-center">
                <Send className="w-4 h-4 text-[var(--brand)]" />
              </div>
              <div>
                <span className="text-xs font-medium text-[var(--text-primary)] block">
                  Tahansoe Telegram Bot
                </span>
                <span className="text-[11px] text-[var(--text-tertiary)] font-mono">
                  @{botUsername}
                </span>
              </div>
            </div>

            <a
              href={`https://t.me/${botUsername}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs font-mono text-[var(--brand)] hover:underline"
            >
              Open in Telegram <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 pt-1">
            <Input
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="@your_telegram_handle"
              className="text-xs font-mono"
            />
            <Button
              variant={connected ? "outline" : "secondary"}
              size="sm"
              onClick={handleConnect}
              className="text-xs font-mono shrink-0"
            >
              {connected ? "Connected ✓" : "Link Handle"}
            </Button>
          </div>
        </div>

        {/* AI Agent Toggles */}
        <div className="space-y-3">
          <span className="text-xs font-mono uppercase text-[var(--text-tertiary)] block">
            AI Agent Subscriptions
          </span>

          {/* Agent 1: Market Pulse */}
          <div className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--card)] flex items-center justify-between">
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-lg bg-[var(--brand-bg)] border border-[var(--border)] flex items-center justify-center shrink-0 mt-0.5">
                <Newspaper className="w-3.5 h-3.5 text-[var(--brand)]" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-[var(--text-primary)]">
                    Agent 1: Market Pulse Brief
                  </span>
                  <Badge variant="brand" size="sm">Daily 08:00 UTC</Badge>
                </div>
                <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">
                  Single daily LLM synthesis covering lending rates, utilization, and liquidation heatmaps.
                </p>
              </div>
            </div>
            <Switch checked={marketPulseOptIn} onCheckedChange={setMarketPulseOptIn} />
          </div>

          {/* Agent 2: HF Sentinel */}
          <div className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--card)] flex items-center justify-between">
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-lg bg-[var(--safe-bg)] border border-[var(--border)] flex items-center justify-center shrink-0 mt-0.5">
                <Bot className="w-3.5 h-3.5 text-[var(--safe)]" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-[var(--text-primary)]">
                    Agent 2: Sentinel Alerts
                  </span>
                  <Badge variant="safe" size="sm">24/7 Watch</Badge>
                </div>
                <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">
                  Instant Telegram ping when position enters Warning, triggers defense, or executes remediations.
                </p>
              </div>
            </div>
            <Switch checked={sentinelAlertsOptIn} onCheckedChange={setSentinelAlertsOptIn} />
          </div>
        </div>

        {/* Completion CTA */}
        <div className="pt-2">
          <Button
            variant="primary"
            size="lg"
            onClick={onComplete}
            className="w-full gap-2 font-medium"
          >
            <CheckCircle2 className="w-4 h-4" />
            Complete Setup & Open Dashboard
          </Button>
        </div>
      </Card>
    </div>
  );
}

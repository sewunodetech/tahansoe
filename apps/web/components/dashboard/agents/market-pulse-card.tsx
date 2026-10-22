"use client";

import React, { useState } from "react";
import {
  Newspaper,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Sparkles,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { TELEGRAM_BOT_USERNAME } from "@/lib/telegram";

export interface MarketPulseBrief {
  id: string;
  date: string;
  time: string;
  chain: string;
  protocol: string;
  headline: string;
  content: string;
  metrics: {
    utilization: string;
    borrowApy: string;
    liquidations24h: string;
    riskLevel: "Low" | "Moderate" | "Elevated";
  };
}

const PULSE_ARCHIVE: MarketPulseBrief[] = [
  {
    id: "pulse-01",
    date: "Oct 22, 2026",
    time: "08:00 UTC",
    chain: "Arbitrum",
    protocol: "Aave V3 & Morpho",
    headline: "ETH Lending Utilization Cools; Liquidity Depth Holds Strong",
    content:
      "ETH borrow utilization on Arbitrum settled at 76.2% following overnight deleveraging. Base borrow APY holds steady at 2.94%. Lending pools saw $1.2M in orderly position adjustments without triggering cascade liquidations. Collateral debt buffers across major vaults remain within safe boundaries.",
    metrics: {
      utilization: "76.2%",
      borrowApy: "2.94%",
      liquidations24h: "$1.2M",
      riskLevel: "Low",
    },
  },
  {
    id: "pulse-02",
    date: "Oct 21, 2026",
    time: "08:00 UTC",
    chain: "Arbitrum",
    protocol: "Aave V3",
    headline: "Spot Volatility Tests Support; Collateral Ratio Defenses Intact",
    content:
      "ETH spot tested $3,350 support amid macro CPI data release. Arbitrum base borrow APY briefly rose to 3.45% as stablecoin demand spiked. 14 high-LTV positions were auto-repaired by Tahansoe Guardian Module before public liquidation bots could extract penalties.",
    metrics: {
      utilization: "81.5%",
      borrowApy: "3.45%",
      liquidations24h: "$4.8M",
      riskLevel: "Moderate",
    },
  },
  {
    id: "pulse-03",
    date: "Oct 20, 2026",
    time: "08:00 UTC",
    chain: "Arbitrum",
    protocol: "Aave V3 & Morpho",
    headline: "Stablecoin Peg Stability Verified; No Oracle Deviations Detected",
    content:
      "USDC liquidity depth on Uniswap V3 and Camelot remains exceptionally resilient. Chainlink ETH/USD oracle heartbeat frequency registered normal cadence (sub-1s deviations). Protocol debt ceilings have ample available room for organic borrowing.",
    metrics: {
      utilization: "74.8%",
      borrowApy: "2.80%",
      liquidations24h: "$650K",
      riskLevel: "Low",
    },
  },
  {
    id: "pulse-04",
    date: "Oct 19, 2026",
    time: "08:00 UTC",
    chain: "Arbitrum",
    protocol: "Aave V3",
    headline: "Weekend Leverage Flush Completed; Gas Spikes Subsided",
    content:
      "Over the weekend, concentrated short liquidations cleared $8.5M in speculative open interest across derivative DEXs. Lending rates returned to baseline. Gas costs on Arbitrum remain below 0.1 Gwei, ensuring nominal execution fees for Tahansoe automated keepers.",
    metrics: {
      utilization: "72.1%",
      borrowApy: "2.75%",
      liquidations24h: "$8.5M",
      riskLevel: "Moderate",
    },
  },
];

export function MarketPulseCard() {
  const [optedIn, setOptedIn] = useState(true);
  const [showArchive, setShowArchive] = useState(false);
  const [selectedBrief, setSelectedBrief] = useState<MarketPulseBrief>(PULSE_ARCHIVE[0]);

  return (
    <Card className="flex flex-col justify-between">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="size-9 rounded-lg bg-[var(--brand-bg)] border border-[var(--border)] flex items-center justify-center">
              <Newspaper className="size-4 text-[var(--brand)]" strokeWidth={1.8} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <CardTitle className="text-base">Agent 1: Market Pulse</CardTitle>
                <Badge variant="brand" size="sm" dot>
                  Daily 08:00 UTC
                </Badge>
              </div>
              <CardDescription>DeFi macro risk research & multi-channel broadcast</CardDescription>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Latest Brief Box */}
        <div className="p-4 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border)] space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]">
                {selectedBrief.date} · {selectedBrief.time}
              </span>
              <span className="text-[10px] font-mono text-[var(--brand)]">
                {selectedBrief.protocol} ({selectedBrief.chain})
              </span>
            </div>
            <span
              className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                selectedBrief.metrics.riskLevel === "Low"
                  ? "bg-[var(--safe-bg)] border-[var(--safe-border)] text-[var(--safe)]"
                  : selectedBrief.metrics.riskLevel === "Moderate"
                  ? "bg-[var(--warning-bg)] border-[var(--warning-border)] text-[var(--warning)]"
                  : "bg-[var(--danger-bg)] border-[var(--danger-border)] text-[var(--danger)]"
              }`}
            >
              {selectedBrief.metrics.riskLevel} Risk
            </span>
          </div>

          <h4 className="text-sm font-semibold text-[var(--text-primary)] leading-snug">
            {selectedBrief.headline}
          </h4>

          <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
            {selectedBrief.content}
          </p>

          {/* Key Metrics Grid */}
          <div className="grid grid-cols-3 gap-2 pt-2 border-t border-[var(--border)]">
            <div className="p-2 rounded bg-[var(--bg-elevated)] border border-[var(--border)]">
              <span className="text-[9px] font-mono uppercase text-[var(--text-tertiary)]">
                Utilization
              </span>
              <p className="font-mono text-xs font-medium text-[var(--text-primary)]">
                {selectedBrief.metrics.utilization}
              </p>
            </div>
            <div className="p-2 rounded bg-[var(--bg-elevated)] border border-[var(--border)]">
              <span className="text-[9px] font-mono uppercase text-[var(--text-tertiary)]">
                Borrow APY
              </span>
              <p className="font-mono text-xs font-medium text-[var(--text-primary)]">
                {selectedBrief.metrics.borrowApy}
              </p>
            </div>
            <div className="p-2 rounded bg-[var(--bg-elevated)] border border-[var(--border)]">
              <span className="text-[9px] font-mono uppercase text-[var(--text-tertiary)]">
                24h Liq. Volume
              </span>
              <p className="font-mono text-xs font-medium text-[var(--text-primary)]">
                {selectedBrief.metrics.liquidations24h}
              </p>
            </div>
          </div>

          <div className="text-[10px] text-[var(--text-tertiary)] font-mono flex items-center justify-between pt-1">
            <div className="flex items-center gap-1.5">
              <Sparkles className="size-3 text-[var(--brand)]" />
              <span>1 research run → verified by LLM → broadcast to all subscribers</span>
            </div>
            <span>Not financial advice</span>
          </div>
        </div>

        {/* Opt-in and broadcast control */}
        <div className="flex items-center justify-between p-3.5 rounded-xl border border-[var(--border)] bg-[var(--card)]">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <p className="text-xs font-medium text-[var(--text-primary)]">
                Telegram Morning Broadcast
              </p>
              {optedIn && (
                <span className="text-[10px] font-mono text-[var(--safe)] flex items-center gap-1">
                  <CheckCircle2 className="size-3" /> Subscribed
                </span>
              )}
            </div>
            <p className="text-[11px] text-[var(--text-tertiary)]">
              Receive daily market pulses via @{TELEGRAM_BOT_USERNAME}
            </p>
          </div>
          <Switch checked={optedIn} onCheckedChange={setOptedIn} />
        </div>

        {/* Archive toggle button */}
        <div className="pt-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowArchive(!showArchive)}
            className="w-full justify-between text-xs font-mono"
          >
            <span className="flex items-center gap-1.5">
              <Calendar className="size-3.5 text-[var(--text-tertiary)]" />
              Research Brief Archive ({PULSE_ARCHIVE.length})
            </span>
            {showArchive ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </Button>

          {showArchive && (
            <div className="mt-2.5 space-y-1.5 rounded-xl border border-[var(--border)] bg-[var(--bg-subtle)] p-2">
              {PULSE_ARCHIVE.map((brief) => {
                const isSelected = selectedBrief.id === brief.id;
                return (
                  <button
                    key={brief.id}
                    type="button"
                    onClick={() => setSelectedBrief(brief)}
                    className={`w-full text-left p-2.5 rounded-lg transition-all text-xs cursor-pointer ${
                      isSelected
                        ? "bg-[var(--item-active-bg)] border border-[var(--border-strong)]"
                        : "hover:bg-[var(--item-hover)]"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono text-[10px] text-[var(--text-tertiary)]">
                        {brief.date} · {brief.time}
                      </span>
                      <span className="font-mono text-[10px] text-[var(--brand)]">
                        {brief.protocol}
                      </span>
                    </div>
                    <p className="font-medium text-[var(--text-primary)] text-xs line-clamp-1">
                      {brief.headline}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

"use client";

import React from "react";
import { Newspaper, Bot, Shield, CheckCircle2 } from "lucide-react";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Card } from "@/components/ui/card";
import { MarketPulseCard } from "@/components/dashboard/agents/market-pulse-card";
import { SentinelCard } from "@/components/dashboard/agents/sentinel-card";

export default function AgentsPage() {
  return (
    <div className="w-full p-5 md:p-7 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <Eyebrow dot variant="brand">
            Dual AI Architecture
          </Eyebrow>
          <span className="text-[11px] font-mono text-[var(--text-tertiary)]">
            Arbitrum Sepolia
          </span>
        </div>
        <h1 className="font-display text-2xl md:text-3xl font-light text-[var(--text-primary)]">
          AI Intelligence Agents
        </h1>
        <p className="text-xs text-[var(--text-secondary)] mt-1 font-mono">
          Market Pulse research briefs and 24/7 HF Sentinel telemetry · AI explains, rules execute
        </p>
      </div>

      {/* Architecture Highlights Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          {
            title: "Market Pulse",
            detail: "Daily 08:00 UTC",
            sub: "1 research run → all subscribers",
            icon: Newspaper,
          },
          {
            title: "HF Sentinel",
            detail: "Multicall every 60s",
            sub: "Early warning + keeper check",
            icon: Bot,
          },
          {
            title: "Execution Safety",
            detail: "Deterministic rules",
            sub: "AI never signs transactions",
            icon: Shield,
          },
          {
            title: "Chainlink Backup",
            detail: "Automation live",
            sub: "Decentralized fallback runner",
            icon: CheckCircle2,
          },
        ].map((item) => (
          <Card key={item.title} className="p-3.5 flex flex-col justify-between">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-mono uppercase text-[var(--text-tertiary)]">
                {item.title}
              </span>
              <item.icon className="w-3.5 h-3.5 text-[var(--brand)]" strokeWidth={1.8} />
            </div>
            <div>
              <p className="font-mono text-sm font-medium text-[var(--text-primary)]">
                {item.detail}
              </p>
              <p className="text-[10px] font-mono text-[var(--text-tertiary)] mt-0.5">
                {item.sub}
              </p>
            </div>
          </Card>
        ))}
      </div>

      {/* Dual Agent Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <MarketPulseCard />
        <SentinelCard />
      </div>
    </div>
  );
}

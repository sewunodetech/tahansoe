"use client";

import React from "react";
import {
  Play,
  Pause,
  RefreshCw,
  TrendingDown,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LayerBadge } from "@/components/ui/layer-badge";
import type { SimState } from "@/lib/simulation-context";

interface DemoModeSectionProps {
  state: SimState;
  onPauseToggle: (paused: boolean) => void;
  onSimulateDrop: (percent: number) => void;
  onReset: () => void;
}

export function DemoModeSection({
  state,
  onPauseToggle,
  onSimulateDrop,
  onReset,
}: DemoModeSectionProps) {
  const { isPaused, tickCount, lastTick, ethPrice, policy } = state;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <CardTitle className="text-base">Demo Mode & Simulation Engine</CardTitle>
            <Badge variant={isPaused ? "outline" : "safe"} size="sm" dot={!isPaused}>
              {isPaused ? "Paused" : "Live Ticker"}
            </Badge>
          </div>
          <CardDescription>
            Simulate live oracle price ticks, test liquidation cascades, and observe reactive protections
          </CardDescription>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant={isPaused ? "primary" : "secondary"}
            size="sm"
            onClick={() => onPauseToggle(!isPaused)}
            className="gap-1.5 text-xs font-mono"
          >
            {isPaused ? (
              <>
                <Play className="size-3 text-[var(--safe)]" /> Resume Engine
              </>
            ) : (
              <>
                <Pause className="size-3 text-[var(--warning)]" /> Pause Engine
              </>
            )}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={onReset}
            className="gap-1.5 text-xs font-mono"
          >
            <RefreshCw className="size-3" /> Reset Defaults
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Real-time telemetry strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3.5 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border)]">
          <div>
            <span className="text-[10px] font-mono uppercase text-[var(--text-tertiary)]">
              Simulated ETH Price
            </span>
            <p className="font-mono text-sm font-semibold text-[var(--text-primary)]">
              ${ethPrice.price.toLocaleString("en-US", { minimumFractionDigits: 2 })}
            </p>
            <span
              className={`text-[10px] font-mono ${
                ethPrice.change24h < 0 ? "text-[var(--danger)]" : "text-[var(--safe)]"
              }`}
            >
              {ethPrice.change24h > 0 ? "+" : ""}
              {ethPrice.change24h.toFixed(2)}% (24h)
            </span>
          </div>

          <div>
            <span className="text-[10px] font-mono uppercase text-[var(--text-tertiary)]">
              Engine Status
            </span>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span
                className={`size-2 rounded-full ${
                  isPaused ? "bg-[var(--text-tertiary)]" : "bg-[var(--safe)] animate-pulse"
                }`}
              />
              <p className="font-mono text-sm text-[var(--text-primary)]">
                {isPaused ? "Paused" : "Running"}
              </p>
            </div>
            <span className="text-[10px] font-mono text-[var(--text-tertiary)]">
              Tick #{tickCount}
            </span>
          </div>

          <div>
            <span className="text-[10px] font-mono uppercase text-[var(--text-tertiary)]">
              Last Ticker Update
            </span>
            <p className="font-mono text-sm text-[var(--text-primary)]">
              {new Date(lastTick).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </p>
            <span className="text-[10px] font-mono text-[var(--text-tertiary)]">
              Heartbeat OK
            </span>
          </div>

          <div>
            <span className="text-[10px] font-mono uppercase text-[var(--text-tertiary)]">
              Trigger Volatility
            </span>
            <div className="pt-0.5">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onSimulateDrop(15)}
                className="w-full text-xs font-mono gap-1 text-[var(--warning)] hover:bg-[var(--warning-bg)]"
              >
                <TrendingDown className="size-3" /> Drop 15%
              </Button>
            </div>
          </div>
        </div>

        {/* 3-Layer Priority Cascade Order Preview */}
        <div className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--card)] space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono uppercase text-[var(--text-tertiary)] tracking-wider">
              Autonomous Remediation Cascade Priority
            </span>
            <span className="text-[10px] font-mono text-[var(--brand)]">
              Strict Deterministic Order
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 pt-1">
            <div className="p-2.5 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <LayerBadge layer={1} size="sm" />
                <div>
                  <p className="text-xs font-medium text-[var(--text-primary)]">Wallet Reserve</p>
                  <p className="text-[10px] font-mono text-[var(--text-tertiary)]">
                    {policy.l1Enabled ? `$${policy.l1Cap} USDC` : "Disabled"}
                  </p>
                </div>
              </div>
              <span className="text-[10px] font-mono text-[var(--text-secondary)]">Priority 1</span>
            </div>

            <div className="p-2.5 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <LayerBadge layer={2} size="sm" />
                <div>
                  <p className="text-xs font-medium text-[var(--text-primary)]">Position Reserve</p>
                  <p className="text-[10px] font-mono text-[var(--text-tertiary)]">
                    {policy.l2Enabled ? `$${policy.l2Cap} Vault` : "Disabled"}
                  </p>
                </div>
              </div>
              <span className="text-[10px] font-mono text-[var(--text-secondary)]">Priority 2</span>
            </div>

            <div className="p-2.5 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <LayerBadge layer={3} size="sm" />
                <div>
                  <p className="text-xs font-medium text-[var(--text-primary)]">Flash Deleverage</p>
                  <p className="text-[10px] font-mono text-[var(--text-tertiary)]">
                    {policy.l3Enabled ? "Atomic Flash Loan" : "Disabled"}
                  </p>
                </div>
              </div>
              <span className="text-[10px] font-mono text-[var(--text-secondary)]">Priority 3</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

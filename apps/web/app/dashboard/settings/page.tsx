"use client";

import React, { useState } from "react";
import {
  CheckCircle,
  Gauge,
  Info,
  Shield,
  Zap,
  TrendingDown,
} from "lucide-react";
import { useSimulation, type PolicySettings } from "@/lib/simulation-context";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Card } from "@/components/ui/card";
import { NumberInput } from "@/components/ui/number-input";
import { ThresholdsSection } from "@/components/dashboard/settings/thresholds-section";
import { NotificationsSection } from "@/components/dashboard/settings/notifications-section";
import { ThemeSection } from "@/components/dashboard/settings/theme-section";
import { DemoModeSection } from "@/components/dashboard/settings/demo-mode-section";
import { WalletSection } from "@/components/dashboard/settings/wallet-section";

export default function SettingsPage() {
  const {
    state,
    updatePolicy,
    setPaused,
    setTelegramEnabled,
    simulatePriceDrop,
    resetSimulation,
  } = useSimulation();

  const { policy, telegramEnabled } = state;
  const [flash, setFlash] = useState(false);

  function handleUpdatePolicy(patch: Partial<PolicySettings>) {
    updatePolicy(patch);
    setFlash(true);
    setTimeout(() => setFlash(false), 1200);
  }

  return (
    <div className="w-full p-5 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <Eyebrow dot variant="brand">
              Configuration
            </Eyebrow>
            <span className="text-[11px] font-mono text-[var(--text-tertiary)]">
              Local Policy & Ticker
            </span>
          </div>
          <h1 className="font-display text-2xl md:text-3xl font-light text-[var(--text-primary)]">
            Settings & Policy
          </h1>
          <p className="text-xs text-[var(--text-secondary)] mt-1 font-mono">
            Protection thresholds · notifications · appearance · simulation engine
          </p>
        </div>

        {/* Live settings indicator badge */}
        <div
          className={`flex items-center gap-2 h-8 px-3 rounded-lg text-xs font-mono transition-all border ${
            flash
              ? "bg-[var(--safe-bg)] border-[var(--safe-border)] text-[var(--safe)]"
              : "bg-[var(--bg-elevated)] border-[var(--border)] text-[var(--text-tertiary)]"
          }`}
        >
          {flash ? (
            <>
              <CheckCircle className="size-3.5 text-[var(--safe)]" strokeWidth={2} />
              <span>Policy Applied</span>
            </>
          ) : (
            <>
              <Gauge className="size-3.5" strokeWidth={1.5} />
              <span>Live Reactive State</span>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6 items-start">
        {/* Left column */}
        <div className="space-y-6">
          {/* Thresholds */}
          <ThresholdsSection policy={policy} onUpdatePolicy={handleUpdatePolicy} />

          {/* Theme */}
          <ThemeSection />

          {/* Notifications */}
          <NotificationsSection
            policy={policy}
            telegramEnabled={telegramEnabled}
            onToggleTelegram={setTelegramEnabled}
            onUpdatePolicy={handleUpdatePolicy}
          />

          {/* Demo Mode */}
          <DemoModeSection
            state={state}
            onPauseToggle={setPaused}
            onSimulateDrop={(p) => simulatePriceDrop(p)}
            onReset={resetSimulation}
          />

          {/* Wallet */}
          <WalletSection />
        </div>

        {/* Right column sidebar */}
        <div className="space-y-4">
          {/* Active Cascade Strategies Card */}
          <Card className="p-4 space-y-3">
            <p className="text-[10px] font-mono text-[var(--text-tertiary)] uppercase tracking-wider">
              Cascade Layer Status
            </p>

            <div className="space-y-2">
              {[
                {
                  label: "Layer 1: Wallet Reserve",
                  on: policy.l1Enabled ?? policy.hotReserveEnabled,
                  icon: Shield,
                  detail: `$${policy.l1Cap} USDC cap`,
                },
                {
                  label: "Layer 2: Position Reserve",
                  on: policy.l2Enabled,
                  icon: Zap,
                  detail: `$${policy.l2Cap} Vault cap`,
                },
                {
                  label: "Layer 3: Flash Deleverage",
                  on: policy.l3Enabled ?? (policy.flashLoanEnabled || policy.deleverageEnabled),
                  icon: TrendingDown,
                  detail: `${policy.slippageBps} bps max slippage`,
                },
              ].map((s) => (
                <div
                  key={s.label}
                  className="flex items-center justify-between p-2 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border)]"
                >
                  <div className="flex items-center gap-2">
                    <s.icon className="size-3.5 text-[var(--brand)]" strokeWidth={1.8} />
                    <div>
                      <p className="text-xs font-medium text-[var(--text-primary)]">
                        {s.label}
                      </p>
                      <p className="text-[10px] font-mono text-[var(--text-tertiary)]">
                        {s.detail}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                      s.on
                        ? "bg-[var(--safe-bg)] border-[var(--safe-border)] text-[var(--safe)]"
                        : "bg-[var(--bg-elevated)] border-[var(--border)] text-[var(--text-tertiary)]"
                    }`}
                  >
                    {s.on ? "ACTIVE" : "OFF"}
                  </span>
                </div>
              ))}
            </div>
          </Card>

          {/* Max Slippage Config Card */}
          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono text-[var(--text-tertiary)] uppercase tracking-wider">
                Deleverage Max Slippage
              </span>
              <span className="font-mono text-xs font-semibold text-[var(--text-primary)]">
                {policy.slippageBps} bps
              </span>
            </div>

            <div className="w-full">
              <NumberInput
                value={policy.slippageBps}
                onChange={(v) => handleUpdatePolicy({ slippageBps: v })}
                min={10}
                max={500}
                step={10}
                token="bps"
              />
            </div>

            <p className="text-[10px] text-[var(--text-tertiary)] font-mono leading-relaxed">
              Acceptable swap tolerance when Layer 3 unwinds collateral on Uniswap V3 during market stress.
            </p>
          </Card>

          {/* Risk Disclosure */}
          <Card className="p-4 space-y-2 bg-[var(--bg-subtle)]">
            <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase text-[var(--text-tertiary)]">
              <Info className="size-3.5 text-[var(--brand)]" strokeWidth={1.8} />
              <span>Smart Contract Security</span>
            </div>
            <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
              Tahansoe executes remediations at HF {policy.triggerHF.toFixed(2)}, well above the protocol liquidation threshold (1.00). Funds are strictly transferred to repay your own debt.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}

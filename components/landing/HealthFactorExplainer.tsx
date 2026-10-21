"use client";

import { useState } from "react";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Stat } from "@/components/ui/stat";
import { StatusPill } from "@/components/ui/status-pill";

const LT = 0.825;
const TRIGGER = 1.3;
const TARGET = 1.6;

type ZoneInfo = {
  zone: "Safe" | "Watch" | "Warning" | "Critical";
  action: string;
};

function getZoneInfo(hf: number): ZoneInfo {
  if (hf < 1.0) {
    return {
      zone: "Critical",
      action: "Liquidators can seize collateral and impose a 5-10% penalty. Tahansoe aims to trigger before this threshold.",
    };
  }
  if (hf <= TRIGGER) {
    return {
      zone: "Warning",
      action: "Trigger reached. Tahansoe fires remediation across Layer 1, 2, or 3 until Health Factor reaches the 1.60 target.",
    };
  }
  if (hf < TARGET) {
    return {
      zone: "Watch",
      action: "Position is in the caution zone. Sentinel monitors each block and dispatches Telegram warnings.",
    };
  }
  return {
    zone: "Safe",
    action: "Comfortable collateral buffer. Sentinel monitors quietly in the background without intervention.",
  };
}

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

export function HealthFactorExplainer() {
  const [collateralEth, setCollateralEth] = useState(10);
  const [ethPrice, setEthPrice] = useState(3200);
  const [debt, setDebt] = useState(14000);
  const [drop, setDrop] = useState(0);

  const price = ethPrice * (1 - drop / 100);
  const collateralUsd = collateralEth * price;
  const hf = debt > 0 ? (collateralUsd * LT) / debt : Infinity;
  const liqPrice = debt / (collateralEth * LT);
  const triggerPrice = (debt * TRIGGER) / (collateralEth * LT);
  const repayNeeded = Math.max(0, debt - (collateralUsd * LT) / TARGET);
  const zoneInfo = getZoneInfo(hf);

  const gaugePct = Math.min(100, Math.max(0, ((Math.min(hf, 2.5) - 0.8) / 1.7) * 100));

  return (
    <section id="health-factor" className="py-20 md:py-28 border-b border-[var(--border)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-start">
          <div className="lg:col-span-5 flex flex-col gap-6">
            <Eyebrow dot variant="brand">
              Market Mechanics
            </Eyebrow>

            <h2 className="font-display font-light text-3xl sm:text-4xl lg:text-5xl tracking-tight text-[var(--text-primary)] leading-tight">
              Liquidation happens while you sleep.
            </h2>

            <div className="space-y-4 text-sm text-[var(--text-secondary)] leading-relaxed">
              <p>
                When you borrow against collateral on Aave or Morpho, your loan is protected by a{" "}
                <span className="text-[var(--text-primary)] font-medium">Health Factor</span>. If market
                volatility drives your Health Factor below{" "}
                <span className="text-[var(--danger)] font-medium">1.0</span>, liquidators can liquidate
                your debt and seize your collateral with a bonus fee.
              </p>
              <p>
                A sudden 20% pullback overnight can breach your safety margins before you can log in to a
                wallet. Manual position management fails during sharp selloffs.
              </p>
              <p>
                Tahansoe watches your Health Factor every block. Drag the price drop slider to observe how
                Tahansoe intervenes when prices decline.
              </p>
            </div>
          </div>

          <div className="lg:col-span-7 rounded-2xl border border-[var(--border)] bg-[var(--bg-subtle)] p-6 sm:p-8 flex flex-col gap-6 shadow-sm">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <label className="flex flex-col gap-1.5">
                <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--text-tertiary)]">
                  Collateral (ETH)
                </span>
                <input
                  type="number"
                  value={collateralEth}
                  step={0.5}
                  min={0.1}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v) && v > 0) setCollateralEth(v);
                  }}
                  className="h-10 px-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--text-primary)] text-sm font-mono outline-none focus:border-[var(--brand)] transition-colors"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--text-tertiary)]">
                  ETH Initial Price ($)
                </span>
                <input
                  type="number"
                  value={ethPrice}
                  step={50}
                  min={1}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v) && v > 0) setEthPrice(v);
                  }}
                  className="h-10 px-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--text-primary)] text-sm font-mono outline-none focus:border-[var(--brand)] transition-colors"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--text-tertiary)]">
                  Debt (USDC)
                </span>
                <input
                  type="number"
                  value={debt}
                  step={500}
                  min={0}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v) && v >= 0) setDebt(v);
                  }}
                  className="h-10 px-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--text-primary)] text-sm font-mono outline-none focus:border-[var(--brand)] transition-colors"
                />
              </label>
            </div>

            <div className="flex flex-col gap-2 pt-2">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="uppercase text-[var(--text-tertiary)]">Simulate Market Drop</span>
                <span className="text-[var(--text-primary)] font-medium">
                  −{drop}% · ETH @ ${fmt(price)}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={50}
                value={drop}
                onChange={(e) => setDrop(Number(e.target.value))}
                className="w-full h-1.5 bg-[var(--bg-elevated)] rounded-lg appearance-none cursor-pointer accent-[var(--brand)]"
              />
            </div>

            <div className="p-5 rounded-xl border border-[var(--border)] bg-[var(--bg)] flex flex-col gap-4">
              <div className="flex items-end justify-between">
                <div>
                  <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--text-tertiary)] block mb-1">
                    Current Health Factor
                  </span>
                  <div className="font-display text-5xl sm:text-6xl font-light text-[var(--text-primary)] leading-none tabular-nums">
                    {Number.isFinite(hf) ? hf.toFixed(2) : "∞"}
                  </div>
                </div>
                <StatusPill zone={zoneInfo.zone} size="md" />
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="relative h-2 w-full rounded-full bg-[var(--bg-elevated)] overflow-hidden">
                  <div className="absolute inset-0 flex">
                    <div className="w-[15%] bg-[var(--danger)] h-full" />
                    <div className="w-[15%] bg-[var(--warning)] h-full" />
                    <div className="w-[25%] bg-[var(--warning)]/50 h-full" />
                    <div className="w-[45%] bg-[var(--safe)] h-full" />
                  </div>
                  <div
                    className="absolute top-0 bottom-0 w-1.5 bg-white shadow-xs rounded-full -translate-x-1/2 transition-all duration-150"
                    style={{ left: `${gaugePct}%` }}
                  />
                </div>

                <div className="flex justify-between text-[10px] font-mono text-[var(--text-tertiary)] uppercase">
                  <span>Critical 1.0</span>
                  <span>Trigger 1.30</span>
                  <span>Target 1.60</span>
                  <span>Safe 2.0+</span>
                </div>
              </div>

              <p className="text-xs text-[var(--text-secondary)] leading-relaxed pt-1">
                {zoneInfo.action}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-3.5 rounded-lg border border-[var(--border)] bg-[var(--bg)]">
                <Stat
                  label="Tahansoe Triggers"
                  value={`$${fmt(triggerPrice)}`}
                  sub="HF reaches 1.30"
                  size="sm"
                />
              </div>
              <div className="p-3.5 rounded-lg border border-[var(--border)] bg-[var(--bg)]">
                <Stat
                  label="Liquidation Point"
                  value={`$${fmt(liqPrice)}`}
                  sub="HF reaches 1.00"
                  size="sm"
                />
              </div>
              <div className="p-3.5 rounded-lg border border-[var(--border)] bg-[var(--bg)]">
                <Stat
                  label="Repayment Needed"
                  value={repayNeeded > 0 ? `$${fmt(repayNeeded)}` : "None"}
                  sub="To restore HF to 1.60"
                  size="sm"
                />
              </div>
            </div>

            <p className="text-[11px] text-[var(--text-tertiary)] leading-relaxed">
              Illustrative calculation based on Aave V3 ETH Liquidation Threshold (82.5%). Actual parameters vary per asset and market.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

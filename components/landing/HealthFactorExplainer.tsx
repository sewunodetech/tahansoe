"use client";

import { useState } from "react";

const LT = 0.825; // liquidation threshold used across the app
const TRIGGER = 1.3;
const TARGET = 1.6;

type Zone = { label: string; color: string; action: string };

function zoneFor(hf: number): Zone {
  if (hf < 1) return {
    label: "Liquidatable",
    color: "#f87171",
    action: "Liquidators can repay part of your debt and seize collateral plus a bonus. Tahansoe aims to never let you get here.",
  };
  if (hf <= TRIGGER) return {
    label: "Tahansoe acts",
    color: "#fbbf24",
    action: "Trigger reached. Tahansoe repays debt (hot reserve → flash loan → deleverage) until HF is back at the 1.60 target.",
  };
  if (hf < TARGET) return {
    label: "Watching",
    color: "#e6c07b",
    action: "Above trigger but below target. Tahansoe keeps monitoring every block and sends a Telegram warning as HF approaches 1.30.",
  };
  return {
    label: "Safe",
    color: "#4ab5e0",
    action: "Comfortable buffer. Tahansoe monitors quietly in the background.",
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
  const zone = zoneFor(hf);
  const gaugePct = Math.min(100, Math.max(0, ((Math.min(hf, 2.2) - 0.8) / 1.4) * 100));

  return (
    <section id="health-factor" className="py-20 md:py-[80px]">
      <div className="max-w-[1400px] mx-auto px-6">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.2fr] gap-12 lg:gap-16 items-start">
          <div>
            <p className="text-[12px] font-medium tracking-[0.08em] uppercase text-[#4ab5e0] mb-5">
              The problem
            </p>
            <h2 className="text-4xl md:text-5xl font-display font-medium leading-[1.1] tracking-[-0.02em] text-[#fdf1e1] mb-6">
              Liquidation happens while you sleep.
            </h2>
            <div className="space-y-4 text-[15px] leading-[1.65] text-[#c8bca9] max-w-[480px]">
              <p>
                When you borrow on Aave or Morpho, your collateral must stay worth more than your debt.
                The <span className="text-[#fdf1e1]">Health Factor</span> tracks that ratio. If it drops
                below <span className="text-[#f87171]">1.0</span>, anyone can liquidate you: they repay
                part of your debt and take your collateral at a discount, usually a 5–10% penalty.
              </p>
              <p>
                Crypto prices move 24/7. A 30% drop overnight is enough to wipe out a position you set
                up carefully in the afternoon. Watching it manually doesn&apos;t scale, and you
                can&apos;t always react in time.
              </p>
              <p>
                Tahansoe does the watching and the reacting for you. Try it: drag the price drop
                slider and see when Tahansoe would step in.
              </p>
            </div>
          </div>

          <div className="rounded-[24px] border border-[#fdf1e1]/10 bg-[#15201d] p-6 md:p-8">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              <NumberField label="Collateral (ETH)" value={collateralEth} step={0.5} min={0.1} onChange={setCollateralEth} />
              <NumberField label="ETH price ($)" value={ethPrice} step={50} min={1} onChange={setEthPrice} />
              <NumberField label="Debt (USDC)" value={debt} step={500} min={0} onChange={setDebt} />
            </div>

            <label className="block mb-8">
              <span className="flex justify-between text-[11px] font-medium tracking-[0.08em] uppercase text-[#8f897c] mb-3">
                <span>ETH price drop</span>
                <span className="text-[#fdf1e1]">−{drop}% · ${fmt(price)}</span>
              </span>
              <input
                type="range" min={0} max={60} value={drop}
                onChange={(e) => setDrop(Number(e.target.value))}
                className="w-full accent-[#4ab5e0]"
              />
            </label>

            <div className="flex items-end justify-between gap-4 mb-3">
              <div>
                <p className="text-[11px] font-medium tracking-[0.08em] uppercase text-[#8f897c] mb-1">Health Factor</p>
                <p className="font-display text-7xl leading-none tabular-nums" style={{ color: zone.color }}>
                  {Number.isFinite(hf) ? hf.toFixed(2) : "∞"}
                </p>
              </div>
              <span
                className="text-[11px] font-medium tracking-[0.08em] uppercase px-3 py-1.5 rounded-full border"
                style={{ color: zone.color, borderColor: zone.color }}
              >
                {zone.label}
              </span>
            </div>

            <div className="relative h-2 rounded-full mb-2"
              style={{ background: "linear-gradient(90deg,#f87171 0%,#f87171 14.3%,#fbbf24 14.3%,#fbbf24 35.7%,#e6c07b 35.7%,#e6c07b 57.1%,#4ab5e0 57.1%)" }}
            >
              <div
                className="absolute -top-1.5 w-1 h-5 rounded-full bg-[#fdf1e1] shadow transition-[left] duration-150"
                style={{ left: `calc(${gaugePct}% - 2px)` }}
              />
            </div>
            <div className="relative h-4 font-mono text-[10px] text-[#8f897c] mb-6">
              <span className="absolute" style={{ left: "14.3%", transform: "translateX(-50%)" }}>1.0</span>
              <span className="absolute" style={{ left: "35.7%", transform: "translateX(-50%)" }}>1.3</span>
              <span className="absolute" style={{ left: "57.1%", transform: "translateX(-50%)" }}>1.6</span>
            </div>

            <p className="text-[14px] leading-[1.6] text-[#e6dac6] mb-6 min-h-[45px]">{zone.action}</p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-[#26332f] rounded-[16px] overflow-hidden">
              <Stat label="Tahansoe triggers at" value={`$${fmt(triggerPrice)}`} color="#fbbf24" />
              <Stat label="Liquidation at" value={`$${fmt(liqPrice)}`} color="#f87171" />
              <Stat
                label="Repay to reach 1.60"
                value={repayNeeded > 0 ? `$${fmt(repayNeeded)}` : "—"}
                color="#4ab5e0"
              />
            </div>
            <p className="mt-4 text-[11px] text-[#8f897c]">
              Illustrative. Uses a 0.825 liquidation threshold; real thresholds vary per asset and market.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function NumberField({
  label, value, step, min, onChange,
}: { label: string; value: number; step: number; min: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium tracking-[0.08em] uppercase text-[#8f897c] block mb-2">{label}</span>
      <input
        type="number" value={value} step={step} min={min}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v) && v >= min) onChange(v);
        }}
        className="w-full h-11 rounded-full bg-[#0b1110] border border-[#26332f] px-4 text-[14px] text-[#fdf1e1] tabular-nums outline-none focus:border-[#5b6660]"
      />
    </label>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-[#0b1110] px-5 py-4">
      <p className="text-[11px] font-medium tracking-[0.08em] uppercase text-[#8f897c] mb-1">{label}</p>
      <p className="text-[18px] font-medium tabular-nums" style={{ color }}>{value}</p>
    </div>
  );
}

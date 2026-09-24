"use client";

import { useState } from "react";
import { useAccount, useDisconnect, useChainId, useChains } from "wagmi";
import {
  ShieldCheck, AlertTriangle, ToggleLeft, ToggleRight,
  Info, Copy, CheckCheck, Zap, TrendingDown,
  Shield, CheckCircle, Play, Pause, Bell, BellOff, Gauge,
  RefreshCw,
} from "lucide-react";
import { useSimulation, DEFAULT_POLICY } from "@/lib/simulation-context";

/* ── Shared primitives ───────────────────────────────────────────────────── */
function SectionCard({ title, description, children }: {
  title: string; description?: string; children: React.ReactNode;
}) {
  return (
    <div className="rounded-[10px] border border-white/[0.06] bg-white/[0.015] overflow-hidden">
      <div className="px-5 py-3.5 border-b border-white/[0.05]">
        <h2 className="text-[12.5px] font-semibold text-white/80 tracking-[-0.01em]">{title}</h2>
        {description && <p className="text-[11px] text-white/25 mt-0.5">{description}</p>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function FieldRow({ label, hint, children }: {
  label: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-6 py-3.5 border-b border-white/[0.04] last:border-0">
      <div className="min-w-0">
        <p className="text-[12.5px] text-white/70">{label}</p>
        {hint && <p className="text-[11px] text-white/25 mt-0.5 max-w-[340px] leading-relaxed">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function NumberInput({ value, onChange, min, max, step = 0.01 }: {
  value: number; onChange: (v: number) => void; min: number; max: number; step?: number;
}) {
  return (
    <input
      type="number"
      value={value}
      step={step}
      min={min}
      max={max}
      onChange={(e) => {
        const v = parseFloat(e.target.value);
        if (!isNaN(v)) onChange(v);
      }}
      className="w-24 h-8 px-3 rounded-[6px] text-[12px] font-mono text-white/70 outline-none text-right transition-colors"
      style={{ background: "rgba(253,241,225,0.04)", border: "1px solid rgba(253,241,225,0.08)" }}
      onFocus={(e) => { e.currentTarget.style.border = "1px solid rgba(74,181,224,0.4)"; e.currentTarget.style.background = "rgba(74,181,224,0.04)"; }}
      onBlur={(e)  => { e.currentTarget.style.border = "1px solid rgba(253,241,225,0.08)"; e.currentTarget.style.background = "rgba(253,241,225,0.04)"; }}
    />
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)} className="flex items-center transition-colors" aria-pressed={on}>
      {on
        ? <ToggleRight style={{ width: 32, height: 32, color: "#4ab5e0" }}    strokeWidth={1.5} />
        : <ToggleLeft  style={{ width: 32, height: 32 }} className="text-white/20" strokeWidth={1.5} />
      }
    </button>
  );
}

/* ── Page ────────────────────────────────────────────────────────────────── */
export default function SettingsPage() {
  const { address }   = useAccount();
  const { disconnect }= useDisconnect();
  const chainId       = useChainId();
  const chains        = useChains();
  const chain         = chains.find((c) => c.id === chainId);

  const { state, updatePolicy, setPaused, setTelegramEnabled } = useSimulation();
  const { policy, isPaused, telegramEnabled, tickCount, lastTick } = state;

  const [copied,  setCopied]  = useState(false);
  const [flash,   setFlash]   = useState(false); // saved indicator

  /* Apply a policy patch and flash the indicator */
  function applyPolicy(patch: Parameters<typeof updatePolicy>[0]) {
    updatePolicy(patch);
    setFlash(true);
    setTimeout(() => setFlash(false), 1_200);
  }

  const handleCopy = () => {
    if (address) navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2_000);
  };

  const short     = address ? `${address.slice(0, 10)}...${address.slice(-6)}` : "—";
  const isInvalid = policy.triggerHF >= policy.targetHF;

  /* Visual preview */
  const triggerPct = Math.min(100, Math.max(0, (policy.triggerHF - 1.0) * 100));
  const targetPct  = Math.min(100, Math.max(0, (policy.targetHF  - 1.0) * 100));

  return (
    <div className="w-full p-5 md:p-7">

      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-[30px] font-normal text-white leading-none">Settings</h1>
          <p className="text-[12px] text-white/30 mt-0.5">
            Protection thresholds · execution policy · simulation
          </p>
        </div>
        {/* live-apply indicator — replaces a Save button */}
        <div
          className="flex items-center gap-2 h-8 px-3.5 rounded-[7px] text-[11.5px] font-mono transition-all"
          style={
            flash
              ? { background: "rgba(52,211,153,0.12)", border: "1px solid rgba(52,211,153,0.3)", color: "#34d399" }
              : { background: "rgba(253,241,225,0.04)", border: "1px solid rgba(253,241,225,0.08)", color: "rgba(253,241,225,0.25)" }
          }
        >
          {flash
            ? <><CheckCircle style={{ width: 12, height: 12 }} strokeWidth={2} /> Applied</>
            : <><Gauge       style={{ width: 12, height: 12 }} strokeWidth={1.5} /> Live settings</>
          }
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-5">

        {/* ── Left column ───────────────────────────────────────────── */}
        <div className="space-y-5">

          {/* Wallet */}
          <SectionCard title="Wallet" description="Connected wallet and active network.">
            <FieldRow label="Address" hint="Used to read positions and sign Guardian Module approval.">
              <div className="flex items-center gap-2 h-8 px-3 rounded-[6px]"
                style={{ background: "rgba(253,241,225,0.03)", border: "1px solid rgba(253,241,225,0.06)" }}>
                <ShieldCheck style={{ width: 13, height: 13, color: "#4ab5e0" }} strokeWidth={1.5} />
                <span className="font-mono text-[11px] text-white/45">{short}</span>
                <button onClick={handleCopy} className="text-white/20 hover:text-white/50 transition-colors ml-1">
                  {copied
                    ? <CheckCheck className="w-3 h-3" style={{ color: "#34d399" }} strokeWidth={1.5} />
                    : <Copy       className="w-3 h-3"                              strokeWidth={1.5} />
                  }
                </button>
              </div>
            </FieldRow>
            <FieldRow label="Network" hint="Chain where your positions are active.">
              <div className="flex items-center gap-2 h-8 px-3 rounded-[6px]"
                style={{ background: "rgba(253,241,225,0.03)", border: "1px solid rgba(253,241,225,0.06)" }}>
                <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: "#34d399" }} />
                <span className="font-mono text-[11px] text-white/45">{chain?.name ?? "—"}</span>
              </div>
            </FieldRow>
            <FieldRow label="Disconnect" hint="Remove wallet connection and return to landing page.">
              <button onClick={() => disconnect()} className="h-8 px-3.5 rounded-[6px] text-[12px] transition-colors"
                style={{ border: "1px solid rgba(248,113,113,0.2)", background: "rgba(248,113,113,0.05)", color: "rgba(248,113,113,0.7)" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(248,113,113,0.1)";  e.currentTarget.style.color = "#f87171"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(248,113,113,0.05)"; e.currentTarget.style.color = "rgba(248,113,113,0.7)"; }}>
                Disconnect wallet
              </button>
            </FieldRow>
          </SectionCard>

          {/* Protection thresholds */}
          <SectionCard
            title="Protection thresholds"
            description={`Tahansoe acts when HF ≤ trigger and restores to target. Formula: HF = (collateral × 0.825) ÷ debt`}
          >
            <FieldRow
              label="Trigger HF"
              hint="Engine fires when HF drops to this value. Repay amount is calculated to bring HF back to target. Recommended: 1.25–1.35."
            >
              <NumberInput value={policy.triggerHF} onChange={(v) => applyPolicy({ triggerHF: v })} min={1.05} max={1.5} />
            </FieldRow>
            <FieldRow
              label="Target HF"
              hint="After remediation HF is restored to this value. Must be > trigger. Higher = more collateral buffer, higher cost."
            >
              <NumberInput value={policy.targetHF} onChange={(v) => applyPolicy({ targetHF: v })} min={1.1} max={2.5} />
            </FieldRow>
            <FieldRow
              label="Conservative buffer %"
              hint="Effective target = targetHF × (1 + buffer%). Extra cushion against oracle lag. 10% means target 1.60 → effective 1.76."
            >
              <NumberInput value={policy.bufferPct} onChange={(v) => applyPolicy({ bufferPct: v })} min={0} max={50} step={1} />
            </FieldRow>

            {isInvalid && (
              <div className="mt-3 flex items-start gap-2.5 px-3 py-2.5 rounded-[7px]"
                style={{ background: "rgba(248,113,113,0.07)", border: "1px solid rgba(248,113,113,0.2)" }}>
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "#f87171" }} strokeWidth={1.5} />
                <p className="text-[11px]" style={{ color: "rgba(248,113,113,0.8)" }}>
                  Target HF must be greater than trigger HF.
                </p>
              </div>
            )}
          </SectionCard>

          {/* Execution policy */}
          <SectionCard
            title="Execution policy"
            description="Which strategies Tahansoe can use. Priority: hot reserve → flash loan → deleverage."
          >
            <FieldRow
              label="Flash loan (repay debt)"
              hint="Borrow USDC atomically, repay debt, reducing the denominator so HF rises. Fee ~0.05%. No pre-funded capital needed."
            >
              <Toggle on={policy.flashLoanEnabled} onChange={(v) => applyPolicy({ flashLoanEnabled: v })} />
            </FieldRow>
            <FieldRow
              label="Hot reserve (repay debt)"
              hint="Use pre-funded idle USDC to repay debt directly — faster and cheaper than a flash loan. Highest priority when available."
            >
              <Toggle on={policy.hotReserveEnabled} onChange={(v) => applyPolicy({ hotReserveEnabled: v })} />
            </FieldRow>
            <FieldRow
              label="Deleverage (sell collateral → repay)"
              hint="Sell part of collateral for USDC, use it to repay debt. Both numerator and denominator shrink but ratio improves. Last resort — incurs slippage loss."
            >
              <Toggle on={policy.deleverageEnabled} onChange={(v) => applyPolicy({ deleverageEnabled: v })} />
            </FieldRow>
            <FieldRow
              label="Max slippage (bps)"
              hint="Maximum acceptable swap slippage for deleverage swaps. 50 bps = 0.5%. Higher = better fill rate, worse execution price."
            >
              <NumberInput value={policy.slippageBps} onChange={(v) => applyPolicy({ slippageBps: v })} min={10} max={500} step={10} />
            </FieldRow>

            {/* No-strategy warning */}
            {!policy.flashLoanEnabled && !policy.hotReserveEnabled && !policy.deleverageEnabled && (
              <div className="mt-3 flex items-start gap-2.5 px-3 py-2.5 rounded-[7px]"
                style={{ background: "rgba(248,113,113,0.07)", border: "1px solid rgba(248,113,113,0.2)" }}>
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "#f87171" }} strokeWidth={1.5} />
                <p className="text-[11px]" style={{ color: "rgba(248,113,113,0.8)" }}>
                  No strategy enabled. Tahansoe will alert but cannot act when HF reaches trigger.
                </p>
              </div>
            )}
          </SectionCard>

          {/* Notifications */}
          <SectionCard title="Notifications" description="In-app and Telegram alert preferences.">
            <FieldRow label="In-app alerts" hint="Show toast notifications when HF enters warning zone or trigger fires.">
              <Toggle on={policy.alertsEnabled} onChange={(v) => applyPolicy({ alertsEnabled: v })} />
            </FieldRow>
            <FieldRow
              label="Telegram alerts"
              hint="Send messages to your linked Telegram account. Turn off to silence bot spam during demos."
            >
              <button
                onClick={() => setTelegramEnabled(!telegramEnabled)}
                className="inline-flex items-center gap-2 h-8 px-3.5 rounded-[7px] text-[12px] font-medium transition-all"
                style={
                  telegramEnabled
                    ? { background: "rgba(74,181,224,0.1)",   border: "1px solid rgba(74,181,224,0.3)",  color: "#4ab5e0" }
                    : { background: "rgba(253,241,225,0.05)", border: "1px solid rgba(253,241,225,0.1)", color: "rgba(253,241,225,0.35)" }
                }
              >
                {telegramEnabled
                  ? <><Bell    style={{ width: 12, height: 12 }} strokeWidth={2} /> On</>
                  : <><BellOff style={{ width: 12, height: 12 }} strokeWidth={2} /> Off</>
                }
              </button>
            </FieldRow>
          </SectionCard>

          {/* Simulation controls */}
          <SectionCard
            title="Simulation"
            description="Control the live market simulation. Pausing freezes ETH price movement, HF updates, and all alerts."
          >
            <FieldRow
              label="Engine"
              hint="Pause to freeze all data — useful for reviewing a specific state or demoing without price movement."
            >
              <button
                onClick={() => setPaused(!isPaused)}
                className="inline-flex items-center gap-2 h-8 px-3.5 rounded-[7px] text-[12px] font-medium transition-all"
                style={
                  isPaused
                    ? { background: "rgba(253,241,225,0.05)", border: "1px solid rgba(253,241,225,0.1)", color: "rgba(253,241,225,0.45)" }
                    : { background: "rgba(52,211,153,0.1)",   border: "1px solid rgba(52,211,153,0.3)",  color: "#34d399" }
                }
              >
                {isPaused
                  ? <><Play  style={{ width: 12, height: 12 }} strokeWidth={2} /> Resume</>
                  : <><Pause style={{ width: 12, height: 12 }} strokeWidth={2} /> Pause</>
                }
              </button>
            </FieldRow>
            <FieldRow
              label="Reset to defaults"
              hint="Restore all policy settings to their original values without affecting the simulation state."
            >
              <button
                onClick={() => { updatePolicy(DEFAULT_POLICY); setFlash(true); setTimeout(() => setFlash(false), 1_200); }}
                className="inline-flex items-center gap-2 h-8 px-3.5 rounded-[7px] text-[12px] font-medium transition-all"
                style={{ background: "rgba(253,241,225,0.04)", border: "1px solid rgba(253,241,225,0.08)", color: "rgba(253,241,225,0.35)" }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(253,241,225,0.15)"; e.currentTarget.style.color = "rgba(253,241,225,0.6)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(253,241,225,0.08)"; e.currentTarget.style.color = "rgba(253,241,225,0.35)"; }}
              >
                <RefreshCw style={{ width: 12, height: 12 }} strokeWidth={2} /> Reset
              </button>
            </FieldRow>

            {/* Status strip */}
            <div className="mt-1 flex items-center flex-wrap gap-3 px-3 py-2.5 rounded-[8px]"
              style={{ background: "rgba(253,241,225,0.02)", border: "1px solid rgba(253,241,225,0.05)" }}>
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: isPaused ? "#94a3b8" : "#34d399", animation: isPaused ? "none" : "pulse 2s infinite" }} />
                <span className="text-[11px] font-mono text-white/30">{isPaused ? "Paused" : "Running"}</span>
              </div>
              <div className="h-3 w-px bg-white/[0.08]" />
              <span className="text-[11px] font-mono text-white/25">Tick #{tickCount}</span>
              <div className="h-3 w-px bg-white/[0.08]" />
              <span className="text-[11px] font-mono text-white/25">
                {new Date(lastTick).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
              <div className="ml-auto flex items-center gap-1.5">
                <span className="text-[11px] font-mono" style={{ color: telegramEnabled ? "#4ab5e0" : "rgba(253,241,225,0.2)" }}>
                  Telegram {telegramEnabled ? "on" : "off"}
                </span>
              </div>
            </div>
          </SectionCard>

        </div>

        {/* ── Right column ──────────────────────────────────────────── */}
        <div className="space-y-4">

          {/* Threshold preview */}
          <div className="rounded-[10px] p-5" style={{ background: "rgba(253,241,225,0.015)", border: "1px solid rgba(74,181,224,0.12)" }}>
            <p className="text-[10px] font-mono text-white/30 tracking-[0.12em] uppercase mb-4">Threshold preview</p>

            <div className="relative h-2 rounded-full mb-3" style={{ background: "rgba(253,241,225,0.06)" }}>
              <div className="absolute left-0 top-0 h-full rounded-full transition-all duration-300"
                style={{ width: `${targetPct}%`, background: "linear-gradient(90deg, rgba(248,113,113,0.4) 0%, rgba(251,191,36,0.5) 30%, rgba(74,181,224,0.5) 100%)" }} />
              <div className="absolute top-[-3px] bottom-[-3px] w-0.5 rounded-full transition-all duration-300"
                style={{ left: `${triggerPct}%`, backgroundColor: "#fbbf24" }} />
              <div className="absolute top-[-3px] bottom-[-3px] w-0.5 rounded-full transition-all duration-300"
                style={{ left: `${targetPct}%`, backgroundColor: "#4ab5e0" }} />
            </div>

            <div className="flex justify-between text-[9px] font-mono text-white/25 mb-5">
              <span>1.00 liq.</span><span>2.00+</span>
            </div>

            <div className="space-y-2.5">
              {[
                { color: "#fbbf24", label: "Trigger",          value: policy.triggerHF.toFixed(2) },
                { color: "#4ab5e0", label: "Target",           value: policy.targetHF.toFixed(2) },
                { color: "#818cf8", label: "Effective target", value: (policy.targetHF * (1 + policy.bufferPct / 100)).toFixed(2) },
                { color: "#ffffff40", label: "Buffer",         value: `${policy.bufferPct}%` },
              ].map((r) => (
                <div key={r.label} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: r.color }} />
                    <span className="text-[11px] text-white/40">{r.label}</span>
                  </div>
                  <span className="font-mono text-[12px] text-white/60">{r.value}</span>
                </div>
              ))}
            </div>

            {/* Repay estimate for current positions */}
            <div className="mt-4 pt-4 border-t border-white/[0.05] space-y-2">
              <p className="text-[10px] font-mono text-white/25 tracking-[0.1em] uppercase mb-2">Est. repay per position</p>
              {state.positions.map((pos) => {
                const effective  = policy.targetHF * (1 + policy.bufferPct / 100);
                const newDebt    = (pos.collateralUsd * 0.825) / effective;
                const repay      = Math.max(0, pos.debtUsd - newDebt);
                return (
                  <div key={pos.id} className="flex items-center justify-between">
                    <span className="text-[10.5px] text-white/35 truncate">{pos.protocol}</span>
                    <span className="text-[10.5px] font-mono text-white/50">${Math.round(repay).toLocaleString()} USDC</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Active strategies summary */}
          <div className="rounded-[10px] p-5" style={{ background: "rgba(253,241,225,0.015)", border: "1px solid rgba(253,241,225,0.06)" }}>
            <p className="text-[10px] font-mono text-white/30 tracking-[0.12em] uppercase mb-4">Active strategies</p>
            <div className="space-y-2">
              {[
                { label: "Hot reserve",  on: policy.hotReserveEnabled, icon: Shield,      color: "#4ab5e0",  priority: "1" },
                { label: "Flash loan",   on: policy.flashLoanEnabled,  icon: Zap,         color: "#fbbf24",  priority: "2" },
                { label: "Deleverage",   on: policy.deleverageEnabled, icon: TrendingDown, color: "#f87171", priority: "3" },
              ].map((s) => (
                <div key={s.label} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] font-mono text-white/15 w-3">{s.priority}</span>
                    <s.icon style={{ width: 12, height: 12, color: s.on ? s.color : "rgba(253,241,225,0.15)" }} strokeWidth={1.5} />
                    <span className="text-[11.5px]" style={{ color: s.on ? "rgba(253,241,225,0.6)" : "rgba(253,241,225,0.2)" }}>
                      {s.label}
                    </span>
                  </div>
                  <span className="text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded-[3px]"
                    style={{ color: s.on ? s.color : "rgba(253,241,225,0.2)", background: s.on ? `${s.color}18` : "rgba(253,241,225,0.04)" }}>
                    {s.on ? "ON" : "OFF"}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Slippage bar */}
          <div className="rounded-[10px] p-4" style={{ background: "rgba(253,241,225,0.015)", border: "1px solid rgba(253,241,225,0.06)" }}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-mono text-white/30 tracking-[0.12em] uppercase">Max slippage</span>
              <span className="font-mono text-[12px] font-semibold"
                style={{ color: policy.slippageBps > 200 ? "#f87171" : policy.slippageBps > 100 ? "#fbbf24" : "#4ab5e0" }}>
                {policy.slippageBps} bps
              </span>
            </div>
            <div className="relative h-1 rounded-full" style={{ background: "rgba(253,241,225,0.06)" }}>
              <div className="absolute left-0 top-0 h-full rounded-full transition-all duration-300"
                style={{
                  width: `${Math.min(100, (policy.slippageBps / 500) * 100)}%`,
                  backgroundColor: policy.slippageBps > 200 ? "#f87171" : policy.slippageBps > 100 ? "#fbbf24" : "#4ab5e0",
                }} />
            </div>
            <p className="text-[10px] text-white/20 mt-1.5">
              {policy.slippageBps <= 100 ? "Conservative" : policy.slippageBps <= 200 ? "Moderate" : "Aggressive"}
            </p>
          </div>

          {/* Risk notice */}
          <div className="flex items-start gap-3 px-4 py-3.5 rounded-[9px]"
            style={{ background: "rgba(253,241,225,0.02)", border: "1px solid rgba(253,241,225,0.05)" }}>
            <Info className="w-3.5 h-3.5 text-white/20 shrink-0 mt-0.5" strokeWidth={1.5} />
            <p className="text-[11px] text-white/25 leading-relaxed">
              Deleverage sells collateral at current market price — this realises a loss.
              Tahansoe acts at HF {policy.triggerHF.toFixed(2)}, well before liquidators can enter at HF 1.0.
              The loss is always smaller than a full liquidation penalty (5–10%).
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

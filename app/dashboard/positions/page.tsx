"use client";

import { useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { ShieldCheck, AlertTriangle, Plus, ExternalLink, Settings2 } from "lucide-react";
import { useSimulation } from "@/lib/simulation-context";

const HF_BG   = {
  safe:     "bg-emerald-400/[0.06] border-emerald-400/20",
  warning:  "bg-yellow-400/[0.06] border-yellow-400/20",
  critical: "bg-red-400/[0.06] border-red-400/20",
};
const HF_TEXT  = { safe: "text-emerald-400", warning: "text-yellow-400", critical: "text-red-400" };
const HF_LABEL = { safe: "Safe", warning: "Monitor", critical: "At risk" };

function hfPct(hf: number) { return Math.min(100, Math.max(0, (hf - 1) * 100)); }

function HF_COLOR_HEX(status: string) {
  if (status === "safe")     return "#34d399";
  if (status === "warning")  return "#facc15";
  return "#f87171";
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-[8px] border border-white/[0.08] px-3 py-2" style={{ background: "#0b1110" }}>
      <p className="text-[10px] font-mono text-white/30 mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} className="text-[12px] font-mono" style={{ color: p.color }}>
          {p.name}: {Number(p.value).toFixed(2)}
        </p>
      ))}
    </div>
  );
}

export default function PositionsPage() {
  const { state } = useSimulation();
  const { positions, hfTrend, policy } = state;

  const [selected, setSelected] = useState<string | null>(null);
  const pos = selected ? positions.find((p) => p.id === selected) : null;

  return (
    <div className="w-full p-5 md:p-7 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-[30px] font-normal text-white leading-none">Positions</h1>
          <p className="text-[12px] text-white/30 mt-0.5">
            {positions.length} active · monitored every block
          </p>
        </div>
        <button className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-[6px] border border-white/10 text-white/50 text-[12px] hover:border-white/20 hover:text-white/75 transition-colors">
          <Plus className="w-3.5 h-3.5" strokeWidth={2} /> Add position
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-5">
        {/* Position list */}
        <div className="space-y-3">
          {positions.map((p) => {
            const pct  = hfPct(p.hf);
            const tPct = hfPct(policy.triggerHF);  // live from settings
            const s    = p.status as keyof typeof HF_BG;
            const isSelected = selected === p.id;

            return (
              <div
                key={p.id}
                onClick={() => setSelected(isSelected ? null : p.id)}
                className={`rounded-[10px] border p-5 cursor-pointer transition-all duration-300 ${HF_BG[s]} ${isSelected ? "ring-1 ring-white/10" : ""}`}
              >
                {/* Top row */}
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[14px] font-semibold text-white">{p.protocol}</span>
                      <span className="font-mono text-[9px] text-white/30 px-1.5 py-0.5 rounded-[3px] bg-white/[0.04]">{p.chain}</span>
                    </div>
                    <p className="text-[11px] text-white/35">
                      {p.collateral} collateral · {p.debt} debt
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-mono font-semibold px-2 py-1 rounded-[5px] border ${HF_BG[s]} ${HF_TEXT[s]}`}>
                      {HF_LABEL[s]}
                    </span>
                    {/* warning pulse for at-risk positions */}
                    {s !== "safe" && (
                      <span className={`w-2 h-2 rounded-full animate-pulse ${s === "critical" ? "bg-red-400" : "bg-yellow-400"}`} />
                    )}
                    <button
                      className="p-1 rounded-[5px] text-white/20 hover:text-white/60 hover:bg-white/[0.04] transition-colors"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Settings2 className="w-3.5 h-3.5" strokeWidth={1.5} />
                    </button>
                  </div>
                </div>

                {/* HF number + bar */}
                <div className="flex items-end gap-4 mb-3">
                  <div>
                    <span className={`text-[36px] font-semibold leading-none tracking-[-0.03em] tabular-nums transition-all duration-700 ${HF_TEXT[s]}`}>
                      {p.hf.toFixed(2)}
                    </span>
                    <span className="text-[10px] text-white/20 font-mono ml-1">HF</span>
                  </div>
                  <div className="flex-1 pb-1">
                    <div className="relative h-1 rounded-full bg-white/[0.06] overflow-hidden mb-1">
                      <div
                        className={`absolute left-0 top-0 h-full rounded-full transition-all duration-700 ${
                          s === "safe" ? "bg-emerald-400" : s === "warning" ? "bg-yellow-400" : "bg-red-400"
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                      <div className="absolute top-0 h-full w-px bg-yellow-400/50" style={{ left: `${tPct}%` }} />
                    </div>
                    <div className="flex justify-between text-[9px] font-mono text-white/20">
                      <span>1.0 liq.</span>
                      <span className="text-yellow-400/40">{policy.triggerHF.toFixed(2)} trigger</span>
                      <span>2.0+</span>
                    </div>
                  </div>
                </div>

                {/* Meta row */}
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: "Target HF",     value: p.targetHf.toFixed(2) },
                    { label: "Collateral USD", value: `$${p.collateralUsd.toLocaleString()}` },
                    { label: "Debt USD",       value: `$${p.debtUsd.toLocaleString()}` },
                  ].map((m) => (
                    <div key={m.label} className="rounded-[6px] bg-white/[0.03] border border-white/[0.04] px-2.5 py-2">
                      <p className="text-[9px] font-mono text-white/20 mb-0.5">{m.label}</p>
                      <p className="text-[12px] font-mono text-white/55">{m.value}</p>
                    </div>
                  ))}
                </div>

                {/* Oracle + last checked */}
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-[10px] font-mono text-white/20">Oracle: {p.oracleSource}</span>
                  <span className="text-[10px] font-mono text-white/20">Last checked: {p.lastChecked}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Detail panel */}
        <div>
          {pos ? (
            <div className="rounded-[10px] border border-white/[0.06] bg-white/[0.015] overflow-hidden sticky top-6">
              <div className="px-5 py-4 border-b border-white/[0.05]">
                <div className="flex items-center justify-between">
                  <h3 className="text-[13px] font-medium text-white">{pos.protocol} · {pos.chain}</h3>
                  <button className="text-[10px] font-mono text-white/25 flex items-center gap-1 hover:text-white/50 transition-colors">
                    Explorer <ExternalLink className="w-3 h-3" strokeWidth={1.5} />
                  </button>
                </div>
              </div>
              <div className="p-5">
                <p className="text-[10px] font-mono text-white/25 mb-3 tracking-[0.1em] uppercase">HF trend — live</p>
                <ResponsiveContainer width="100%" height={140}>
                  <AreaChart data={hfTrend} margin={{ top: 4, right: 4, left: -30, bottom: 0 }}>
                    <defs>
                      <linearGradient id="hfGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor={HF_COLOR_HEX(pos.status)} stopOpacity={0.15} />
                        <stop offset="95%" stopColor={HF_COLOR_HEX(pos.status)} stopOpacity={0}    />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="t"
                      tick={{ fontSize: 8, fill: "rgba(253,241,225,0.18)", fontFamily: "monospace" }}
                      axisLine={false} tickLine={false} interval={3}
                    />
                    <YAxis
                      domain={[1.0, 2.2]}
                      tick={{ fontSize: 8, fill: "rgba(253,241,225,0.18)", fontFamily: "monospace" }}
                      axisLine={false} tickLine={false}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <ReferenceLine y={policy.triggerHF} stroke="rgba(250,204,21,0.25)" strokeDasharray="4 3" />
                    <Area
                      type="monotone"
                      dataKey={pos.protocol === "Aave V3" ? "aave" : "morpho"}
                      stroke={HF_COLOR_HEX(pos.status)}
                      strokeWidth={1.5}
                      fill="url(#hfGrad)"
                      dot={false}
                      name={pos.protocol}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>

                <div className="mt-4 space-y-2">
                  {[
                    { label: "Current HF",  value: pos.hf.toFixed(2) },
                    { label: "Trigger at",  value: policy.triggerHF.toFixed(2) },
                    { label: "Target HF",   value: policy.targetHF.toFixed(2) },
                    { label: "Collateral",  value: `${pos.collateral} ($${pos.collateralUsd.toLocaleString()})` },
                    { label: "Debt",        value: `${pos.debt} ($${pos.debtUsd.toLocaleString()})` },
                  ].map((r) => (
                    <div key={r.label} className="flex items-center justify-between py-1.5 border-b border-white/[0.04] last:border-0">
                      <span className="text-[11px] text-white/30">{r.label}</span>
                      <span className="text-[11px] font-mono text-white/60">{r.value}</span>
                    </div>
                  ))}
                </div>

                {/* Alert badge if at risk */}
                {pos.status !== "safe" && (
                  <div className={`mt-4 flex items-center gap-2 px-3 py-2 rounded-[7px] ${
                    pos.status === "critical"
                      ? "bg-red-400/[0.08] border border-red-400/20"
                      : "bg-yellow-400/[0.08] border border-yellow-400/20"
                  }`}>
                    <AlertTriangle
                      className={`w-3.5 h-3.5 shrink-0 ${pos.status === "critical" ? "text-red-400 animate-pulse" : "text-yellow-400"}`}
                      strokeWidth={1.5}
                    />
                    <p className={`text-[11px] ${pos.status === "critical" ? "text-red-400/80" : "text-yellow-400/80"}`}>
                      {pos.status === "critical"
                        ? "Trigger active — remediation queued"
                        : `HF ${pos.hf.toFixed(2)} — approaching trigger of ${policy.triggerHF.toFixed(2)}`
                      }
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-[10px] border border-white/[0.06] bg-white/[0.01] p-8 flex flex-col items-center justify-center text-center sticky top-6">
              <ShieldCheck className="w-8 h-8 text-white/10 mb-3" strokeWidth={1} />
              <p className="text-[13px] text-white/25">Select a position to view details</p>
              <p className="text-[11px] text-white/15 mt-1">Chart updates live as prices move</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

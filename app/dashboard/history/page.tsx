"use client";

import { useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import {
  CheckCircle, XCircle, Clock, ExternalLink, Filter, Zap, ArrowUpDown,
} from "lucide-react";
import { useSimulation } from "@/lib/simulation-context";

const ACTION_LABEL: Record<string, string> = {
  REPAY:             "Repay",
  SUPPLY_COLLATERAL: "Supply collateral",
  FLASH_LOAN:        "Flash loan",
  NOOP:              "No action",
};

const STATUS_ICON  = { success: CheckCircle, failed: XCircle, pending: Clock };
const STATUS_COLOR = { success: "text-emerald-400", failed: "text-red-400", pending: "text-white/30" };
const STATUS_BG    = {
  success: "bg-emerald-400/[0.07] border-emerald-400/20",
  failed:  "bg-red-400/[0.07] border-red-400/20",
  pending: "bg-white/[0.03] border-white/[0.06]",
};

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-[8px] border border-white/[0.08] px-3 py-2" style={{ background: "#111113" }}>
      <p className="text-[10px] font-mono text-white/30 mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} className="text-[11px] font-mono text-white/60">
          HF: {Number(p.value).toFixed(2)}
        </p>
      ))}
    </div>
  );
}

export default function HistoryPage() {
  const { state } = useSimulation();
  const { history } = state;

  const [filter, setFilter] = useState<"all" | "success" | "failed">("all");

  const filtered   = filter === "all" ? history : history.filter((h) => h.status === filter);
  const executions = history.filter((h) => h.action !== "NOOP");
  const successRate = executions.length > 0
    ? Math.round((executions.filter((h) => h.status === "success").length / executions.length) * 100)
    : 0;

  const recoveryData = executions
    .filter((h) => h.status === "success")
    .slice(0, 8) // keep chart readable
    .map((h) => ({
      id:     h.id,
      label:  `${h.protocol.slice(0, 4)} ${h.timestamp.slice(5, 10)}`,
      before: h.hfBefore,
      after:  h.hfAfter,
    }));

  return (
    <div className="w-full p-5 md:p-7 space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-[18px] font-semibold text-white tracking-[-0.02em]">Execution History</h1>
        <p className="text-[12px] text-white/30 mt-0.5">
          All Tahansoe interventions and monitoring events · {history.length} entries
        </p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total executions", value: String(executions.length),                                                        icon: Zap },
          { label: "Success rate",     value: `${successRate}%`,                                                                icon: CheckCircle },
          { label: "Flash loans used", value: String(executions.filter((h) => h.source === "Flash loan").length),              icon: ArrowUpDown },
          { label: "Avg gas per tx",   value: executions.length > 0 ? "0.00038 ETH" : "—",                                    icon: Filter },
        ].map((s) => (
          <div key={s.label} className="rounded-[10px] border border-white/[0.06] bg-white/[0.015] p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-mono text-white/25 tracking-[0.1em] uppercase">{s.label}</span>
              <div className="w-6 h-6 rounded-[5px] bg-white/[0.04] flex items-center justify-center">
                <s.icon className="w-3 h-3 text-white/25" strokeWidth={1.5} />
              </div>
            </div>
            <span className="text-[22px] font-semibold text-white tracking-[-0.02em] leading-none">{s.value}</span>
          </div>
        ))}
      </div>

      {/* HF Recovery chart */}
      {recoveryData.length > 0 && (
        <div className="rounded-[10px] border border-white/[0.06] bg-white/[0.015] p-5">
          <div className="mb-4">
            <h2 className="text-[13px] font-medium text-white/75">HF Recovery per Execution</h2>
            <p className="text-[11px] text-white/25 mt-0.5">
              HF before (red) vs after (green) each intervention · updates live
            </p>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={recoveryData} margin={{ top: 4, right: 4, left: -24, bottom: 0 }} barCategoryGap="35%">
              <XAxis
                dataKey="label"
                tick={{ fontSize: 9, fill: "rgba(255,255,255,0.2)", fontFamily: "monospace" }}
                axisLine={false} tickLine={false}
              />
              <YAxis
                domain={[1.0, 1.8]}
                tick={{ fontSize: 9, fill: "rgba(255,255,255,0.2)", fontFamily: "monospace" }}
                axisLine={false} tickLine={false}
              />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="before" radius={[3, 3, 0, 0]} maxBarSize={18} isAnimationActive={false}>
                {recoveryData.map((_, i) => <Cell key={i} fill="rgba(248,113,113,0.6)" />)}
              </Bar>
              <Bar dataKey="after" radius={[3, 3, 0, 0]} maxBarSize={18} isAnimationActive={false}>
                {recoveryData.map((_, i) => <Cell key={i} fill="rgba(52,211,153,0.7)" />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Filter tabs + table */}
      <div className="rounded-[10px] border border-white/[0.06] bg-white/[0.015] overflow-hidden">
        {/* Filter bar */}
        <div className="flex items-center gap-1 px-4 py-3 border-b border-white/[0.05]">
          {(["all", "success", "failed"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`h-6 px-3 rounded-[5px] text-[11px] font-medium transition-colors capitalize ${
                filter === f ? "bg-white/[0.08] text-white" : "text-white/30 hover:text-white/55 hover:bg-white/[0.04]"
              }`}
            >
              {f}
            </button>
          ))}
          <span className="ml-auto text-[10px] font-mono text-white/20">{filtered.length} entries</span>
        </div>

        {/* Table header */}
        <div className="grid grid-cols-[auto_1fr_auto_auto_auto_auto] gap-4 px-4 py-2 border-b border-white/[0.04]">
          {["Status", "Action", "Amount", "Protocol", "HF change", "Tx"].map((h) => (
            <span key={h} className="text-[10px] font-mono text-white/20 uppercase tracking-[0.08em]">{h}</span>
          ))}
        </div>

        {/* Rows */}
        {filtered.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-[12px] text-white/20">No entries match this filter.</p>
          </div>
        ) : (
          filtered.map((entry, i) => {
            const StatusIcon = STATUS_ICON[entry.status];
            return (
              <div
                key={entry.id}
                className={`grid grid-cols-[auto_1fr_auto_auto_auto_auto] gap-4 items-center px-4 py-3 transition-colors hover:bg-white/[0.02] ${
                  i < filtered.length - 1 ? "border-b border-white/[0.04]" : ""
                }`}
              >
                <StatusIcon className={`w-3.5 h-3.5 shrink-0 ${STATUS_COLOR[entry.status]}`} strokeWidth={1.5} />

                <div className="min-w-0">
                  <p className="text-[12.5px] text-white/70 truncate">{ACTION_LABEL[entry.action] ?? entry.action}</p>
                  <p className="text-[10px] font-mono text-white/20 mt-0.5">{entry.timestamp}</p>
                </div>

                <span className="text-[11px] font-mono text-white/45 whitespace-nowrap">
                  {entry.amount !== "0" ? `${entry.amount} ${entry.asset}` : "—"}
                </span>

                <div className="flex flex-col items-end">
                  <span className="text-[11px] font-mono text-white/40">{entry.protocol}</span>
                  <span className="text-[9px] font-mono text-white/20">{entry.chain}</span>
                </div>

                <div className="text-right">
                  {entry.hfBefore !== entry.hfAfter ? (
                    <>
                      <span className="text-[10px] font-mono text-red-400/60">{entry.hfBefore}</span>
                      <span className="text-[10px] font-mono text-white/20 mx-0.5">→</span>
                      <span className="text-[10px] font-mono text-emerald-400/70">{entry.hfAfter}</span>
                    </>
                  ) : (
                    <span className="text-[10px] font-mono text-white/20">—</span>
                  )}
                </div>

                <div className="flex items-center gap-1">
                  <span className="text-[10px] font-mono text-white/20 max-w-[72px] truncate">{entry.txHash}</span>
                  {entry.txHash !== "—" && (
                    <ExternalLink className="w-3 h-3 text-white/15 hover:text-white/40 transition-colors cursor-pointer shrink-0" strokeWidth={1.5} />
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

"use client";

import React, { useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  CheckCircle, XCircle, Clock, ExternalLink, Zap, Shield, TrendingDown,
} from "lucide-react";
import { useProtection } from "@/hooks/useProtection";
import { LayerBadge } from "@/components/ui/layer-badge";

const ACTION_LABEL: Record<string, string> = {
  REPAY:             "Repay Debt",
  SUPPLY_COLLATERAL: "Supply Collateral",
  FLASH_LOAN:        "Flash Loan",
  DELEVERAGE:        "Flash Deleverage",
  NOOP:              "Check Status",
};

const STATUS_ICON = {
  success: CheckCircle,
  failed: XCircle,
  pending: Clock,
};

interface TooltipPayloadItem {
  dataKey?: string;
  name?: string;
  value?: number | string;
  color?: string;
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string;
}

function ChartTooltip({ active, payload, label }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded-lg border border-[var(--border-strong)] px-3 py-2 text-xs font-mono shadow-xl bg-[var(--bg-elevated)]"
    >
      <p className="text-[10px] text-[var(--text-tertiary)] mb-1">{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey ?? p.name} className="text-[11px]" style={{ color: p.color }}>
          {p.name === "before" ? "HF Before" : "HF After"}: {Number(p.value).toFixed(2)}
        </p>
      ))}
    </div>
  );
}

export default function ActivityPage() {
  const { activity } = useProtection();
  const [filter, setFilter] = useState<"all" | "success" | "failed">("all");

  const filtered = filter === "all" ? activity : activity.filter((h) => h.status === filter);
  const executions = activity.filter((h) => h.action !== "NOOP");
  const successRate = executions.length > 0
    ? Math.round((executions.filter((h) => h.status === "success").length / executions.length) * 100)
    : 100;

  const recoveryData = executions
    .filter((h) => h.status === "success")
    .slice(0, 8)
    .map((h) => ({
      id:     h.id,
      label:  `${h.protocol.slice(0, 4)} ${h.timestamp.slice(5, 10)}`,
      before: h.hfBefore,
      after:  h.hfAfter,
    }));

  return (
    <div className="w-full p-5 md:p-7 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="font-display text-2xl md:text-3xl font-light text-[var(--text-primary)]">
          Activity & Audit Log
        </h1>
        <p className="text-xs text-[var(--text-tertiary)] mt-1 font-mono">
          All automated interventions across Layers 1, 2, and 3 · {activity.length} total events
        </p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Executions", value: String(executions.length), icon: Zap },
          { label: "Success Rate", value: `${successRate}%`, icon: CheckCircle },
          {
            label: "Layer 1 Repays",
            value: String(activity.filter((h) => h.layer === 1 || h.source.includes("L1") || h.source.includes("Hot")).length),
            icon: Shield,
          },
          {
            label: "Flash Deleveraged",
            value: String(activity.filter((h) => h.layer === 3 || h.action === "DELEVERAGE" || h.source.includes("Flash")).length),
            icon: TrendingDown,
          },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 flex flex-col justify-between"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-mono text-[var(--text-tertiary)] tracking-wider uppercase">
                {s.label}
              </span>
              <div className="w-6 h-6 rounded-md bg-[var(--bg-subtle)] border border-[var(--border)] flex items-center justify-center">
                <s.icon className="w-3 h-3 text-[var(--text-tertiary)]" strokeWidth={1.5} />
              </div>
            </div>
            <span className="text-2xl font-light font-mono text-[var(--text-primary)]">
              {s.value}
            </span>
          </div>
        ))}
      </div>

      {/* HF Recovery Chart */}
      {recoveryData.length > 0 && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
          <div className="mb-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] font-mono">
              Health Factor Recovery per Intervention
            </h2>
            <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">
              Comparison of pre-intervention HF vs restored target HF
            </p>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={recoveryData} margin={{ top: 4, right: 4, left: -24, bottom: 0 }} barCategoryGap="35%">
              <XAxis
                dataKey="label"
                tick={{ fontSize: 9, fill: "var(--text-tertiary)", fontFamily: "monospace" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                domain={[1.0, 1.8]}
                tick={{ fontSize: 9, fill: "var(--text-tertiary)", fontFamily: "monospace" }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="before" name="before" radius={[3, 3, 0, 0]} maxBarSize={18} fill="var(--danger)" opacity={0.7} isAnimationActive={false} />
              <Bar dataKey="after" name="after" radius={[3, 3, 0, 0]} maxBarSize={18} fill="var(--safe)" opacity={0.8} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Execution table */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
        {/* Filter bar */}
        <div className="flex items-center gap-1.5 px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-subtle)]">
          {(["all", "success", "failed"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`h-6 px-3 rounded-md text-[11px] font-mono transition-colors capitalize cursor-pointer ${
                filter === f
                  ? "bg-[var(--item-active-bg)] text-[var(--text-primary)] font-medium border border-[var(--border-strong)]"
                  : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--item-hover)]"
              }`}
            >
              {f}
            </button>
          ))}
          <span className="ml-auto text-[10px] font-mono text-[var(--text-tertiary)]">
            {filtered.length} entries
          </span>
        </div>

        {/* Table header */}
        <div className="grid grid-cols-[auto_auto_1fr_auto_auto_auto_auto] gap-3 px-4 py-2 border-b border-[var(--border)] text-[10px] font-mono text-[var(--text-tertiary)] uppercase tracking-wider">
          <span>Status</span>
          <span>Layer</span>
          <span>Action</span>
          <span>Amount</span>
          <span>Protocol</span>
          <span className="text-right">HF Delta</span>
          <span>Tx</span>
        </div>

        {/* Rows */}
        {filtered.length === 0 ? (
          <div className="py-12 text-center text-xs text-[var(--text-tertiary)] font-mono">
            No entries found matching this filter.
          </div>
        ) : (
          filtered.map((entry, i) => {
            const StatusIcon = STATUS_ICON[entry.status];
            const layerNum: 1 | 2 | 3 = entry.layer ?? (entry.source.includes("L1") || entry.source.includes("Hot") ? 1 : entry.source.includes("L2") || entry.source.includes("Position") ? 2 : 3);
            return (
              <div
                key={entry.id}
                className={`grid grid-cols-[auto_auto_1fr_auto_auto_auto_auto] gap-3 items-center px-4 py-3 transition-colors hover:bg-[var(--item-hover)] ${
                  i < filtered.length - 1 ? "border-b border-[var(--border)]" : ""
                }`}
              >
                <StatusIcon
                  className={`w-3.5 h-3.5 shrink-0 ${
                    entry.status === "success" ? "text-[var(--safe)]" : "text-[var(--danger)]"
                  }`}
                  strokeWidth={1.8}
                />

                <LayerBadge layer={layerNum} size="sm" />

                <div className="min-w-0">
                  <p className="text-xs text-[var(--text-primary)] truncate font-medium">
                    {ACTION_LABEL[entry.action] ?? entry.action}
                  </p>
                  <p className="text-[10px] font-mono text-[var(--text-tertiary)] mt-0.5">
                    {entry.source} · {entry.timestamp}
                  </p>
                </div>

                <span className="text-[11px] font-mono text-[var(--text-secondary)] whitespace-nowrap">
                  {entry.amount !== "0" ? `${entry.amount} ${entry.asset}` : "—"}
                </span>

                <div className="flex flex-col text-right">
                  <span className="text-[11px] font-mono text-[var(--text-secondary)]">{entry.protocol}</span>
                  <span className="text-[9px] font-mono text-[var(--text-tertiary)]">{entry.chain}</span>
                </div>

                <div className="text-right font-mono text-[11px]">
                  {entry.hfBefore !== entry.hfAfter ? (
                    <>
                      <span className="text-[var(--danger)]">{entry.hfBefore.toFixed(2)}</span>
                      <span className="text-[var(--text-tertiary)] mx-1">→</span>
                      <span className="text-[var(--safe)]">{entry.hfAfter.toFixed(2)}</span>
                    </>
                  ) : (
                    <span className="text-[var(--text-tertiary)]">—</span>
                  )}
                </div>

                <div className="flex items-center gap-1 font-mono text-[10px] text-[var(--text-tertiary)]">
                  <span className="max-w-[64px] truncate">{entry.txHash}</span>
                  {entry.txHash !== "—" && (
                    <ExternalLink className="w-3 h-3 text-[var(--text-tertiary)] hover:text-[var(--brand)] transition-colors cursor-pointer shrink-0" strokeWidth={1.5} />
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

"use client";

import React from "react";
import { Zap, CheckCircle, Shield, TrendingDown, Layers } from "lucide-react";
import type { HistoryEntry } from "@/lib/mock-data";
import { Card } from "@/components/ui/card";

interface ActivityStatsProps {
  activity: HistoryEntry[];
}

export function ActivityStats({ activity }: ActivityStatsProps) {
  const executions = activity.filter((h) => h.action !== "NOOP");
  const successExecutions = executions.filter((h) => h.status === "success");
  const successRate =
    executions.length > 0
      ? Math.round((successExecutions.length / executions.length) * 100)
      : 100;

  const l1Count = activity.filter(
    (h) => h.layer === 1 || h.source.includes("L1") || h.source.includes("Hot")
  ).length;

  const l2Count = activity.filter(
    (h) => h.layer === 2 || h.source.includes("L2") || h.source.includes("Position")
  ).length;

  const l3Count = activity.filter(
    (h) =>
      h.layer === 3 ||
      h.action === "DELEVERAGE" ||
      h.source.includes("Flash") ||
      h.source.includes("L3")
  ).length;

  const stats = [
    {
      label: "Total Executions",
      value: String(executions.length),
      sub: `${successExecutions.length} successful`,
      icon: Zap,
    },
    {
      label: "Success Rate",
      value: `${successRate}%`,
      sub: "Deterministic keeper",
      icon: CheckCircle,
    },
    {
      label: "Layer 1 Repays",
      value: String(l1Count),
      sub: "Wallet Reserve",
      icon: Shield,
    },
    {
      label: "Layer 2 Redemptions",
      value: String(l2Count),
      sub: "Position Reserve",
      icon: Layers,
    },
    {
      label: "Layer 3 Deleveraged",
      value: String(l3Count),
      sub: "Atomic Flash Loan",
      icon: TrendingDown,
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      {stats.map((s) => (
        <Card key={s.label} className="p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-mono text-[var(--text-tertiary)] uppercase tracking-wider">
              {s.label}
            </span>
            <div className="w-6 h-6 rounded-md bg-[var(--bg-elevated)] border border-[var(--border)] flex items-center justify-center">
              <s.icon className="w-3 h-3 text-[var(--text-secondary)]" strokeWidth={1.5} />
            </div>
          </div>
          <div>
            <div className="text-xl font-light font-mono text-[var(--text-primary)]">
              {s.value}
            </div>
            <p className="text-[10px] font-mono text-[var(--text-tertiary)] mt-0.5">{s.sub}</p>
          </div>
        </Card>
      ))}
    </div>
  );
}

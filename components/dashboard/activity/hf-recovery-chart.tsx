"use client";

import React, { useState, useEffect } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";

interface RecoveryDataPoint {
  id: string;
  label: string;
  layer: 1 | 2 | 3;
  before: number;
  after: number;
  protocol: string;
}

interface HfRecoveryChartProps {
  data: RecoveryDataPoint[];
}

interface TooltipPayloadItem {
  dataKey?: string;
  name?: string;
  value?: number | string;
  color?: string;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string;
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-[var(--border-strong)] px-3 py-2 text-xs font-mono shadow-xl bg-[var(--bg-elevated)] backdrop-blur-md">
      <p className="text-[10px] text-[var(--text-tertiary)] mb-1 uppercase tracking-wider">{label}</p>
      {payload.map((p) => {
        const isBefore = p.name === "before" || p.dataKey === "before";
        return (
          <p
            key={p.dataKey ?? p.name}
            className={`text-[11px] font-medium flex items-center justify-between gap-3 ${
              isBefore ? "text-[var(--danger)]" : "text-[var(--safe)]"
            }`}
          >
            <span>{isBefore ? "Pre-intervention HF" : "Restored Target HF"}:</span>
            <span className="font-semibold">{Number(p.value).toFixed(2)}</span>
          </p>
        );
      })}
    </div>
  );
}

export function HfRecoveryChart({ data }: HfRecoveryChartProps) {
  const [chartTokens, setChartTokens] = useState({
    safe: "rgb(61, 173, 163)",
    danger: "rgb(219, 54, 85)",
    border: "rgba(255, 255, 255, 0.07)",
    textTertiary: "rgb(149, 161, 184)",
  });

  useEffect(() => {
    function readTokens() {
      if (typeof window === "undefined") return;
      const computed = window.getComputedStyle(document.documentElement);
      const safe = computed.getPropertyValue("--safe").trim() || "rgb(61, 173, 163)";
      const danger = computed.getPropertyValue("--danger").trim() || "rgb(219, 54, 85)";
      const border = computed.getPropertyValue("--border").trim() || "rgba(255, 255, 255, 0.07)";
      const textTertiary =
        computed.getPropertyValue("--text-tertiary").trim() || "rgb(149, 161, 184)";

      setChartTokens({ safe, danger, border, textTertiary });
    }

    readTokens();

    const observer = new MutationObserver(() => {
      readTokens();
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "class", "style"],
    });

    return () => observer.disconnect();
  }, []);

  if (!data || data.length === 0) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Eyebrow dot variant="safe">
              Cascade Telemetry
            </Eyebrow>
            <span className="text-[10px] font-mono text-[var(--text-tertiary)]">
              Last {data.length} remediations
            </span>
          </div>
          <CardTitle className="text-base font-medium">Health Factor Recovery</CardTitle>
          <CardDescription>
            Comparison of pre-intervention critical HF vs restored target HF
          </CardDescription>
        </div>
        <div className="flex items-center gap-4 text-xs font-mono">
          <div className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-[var(--danger)]" />
            <span className="text-[var(--text-secondary)]">Before</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-[var(--safe)]" />
            <span className="text-[var(--text-secondary)]">After</span>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <div className="h-48 w-full pt-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              margin={{ top: 8, right: 8, left: -20, bottom: 0 }}
              barGap={4}
              barCategoryGap="25%"
            >
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                stroke={chartTokens.border}
              />
              <XAxis
                dataKey="label"
                tick={{
                  fontSize: 10,
                  fill: chartTokens.textTertiary,
                  fontFamily: "var(--font-geist-mono), monospace",
                }}
                axisLine={{ stroke: chartTokens.border }}
                tickLine={false}
              />
              <YAxis
                domain={[1.0, 2.0]}
                tick={{
                  fontSize: 10,
                  fill: chartTokens.textTertiary,
                  fontFamily: "var(--font-geist-mono), monospace",
                }}
                axisLine={{ stroke: chartTokens.border }}
                tickLine={false}
              />
              <Tooltip content={<CustomTooltip />} />
              <Bar
                dataKey="before"
                name="before"
                radius={[3, 3, 0, 0]}
                maxBarSize={22}
                fill={chartTokens.danger}
                isAnimationActive={false}
              />
              <Bar
                dataKey="after"
                name="after"
                radius={[3, 3, 0, 0]}
                maxBarSize={22}
                fill={chartTokens.safe}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

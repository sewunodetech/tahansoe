"use client";

import React, { useState } from "react";
import {
  CheckCircle,
  XCircle,
  Clock,
  ExternalLink,
} from "lucide-react";
import type { HistoryEntry } from "@/lib/mock-data";
import { LayerBadge } from "@/components/ui/layer-badge";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/data-table";

interface ActivityTableProps {
  entries: HistoryEntry[];
}

const ACTION_LABEL: Record<string, string> = {
  REPAY: "Debt Repayment",
  SUPPLY_COLLATERAL: "Supply Collateral",
  FLASH_LOAN: "Flash Loan Repay",
  DELEVERAGE: "Flash Deleverage",
  NOOP: "Sentinel Health Check",
};

const STATUS_ICONS = {
  success: CheckCircle,
  failed: XCircle,
  pending: Clock,
};

export function ActivityTable({ entries }: ActivityTableProps) {
  const [statusFilter, setStatusFilter] = useState<"all" | "success" | "failed">("all");
  const [layerFilter, setLayerFilter] = useState<"all" | 1 | 2 | 3>("all");

  const filtered = entries.filter((entry) => {
    if (statusFilter !== "all" && entry.status !== statusFilter) return false;
    if (layerFilter !== "all") {
      const entryLayer =
        entry.layer ??
        (entry.source.includes("L1") || entry.source.includes("Hot")
          ? 1
          : entry.source.includes("L2") || entry.source.includes("Position")
          ? 2
          : entry.source.includes("L3") || entry.source.includes("Flash")
          ? 3
          : undefined);
      if (entryLayer !== layerFilter) return false;
    }
    return true;
  });

  return (
    <Card className="overflow-hidden">
      {/* Filters Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-subtle)]">
        <div className="flex items-center gap-2">
          {/* Status filters */}
          <div className="flex items-center gap-1 p-0.5 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)]">
            {(["all", "success", "failed"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={`h-6 px-2.5 rounded-md text-[11px] font-mono transition-colors capitalize cursor-pointer ${
                  statusFilter === s
                    ? "bg-[var(--item-active-bg)] text-[var(--text-primary)] font-medium shadow-xs"
                    : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          {/* Layer filters */}
          <div className="flex items-center gap-1 p-0.5 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)]">
            {(["all", 1, 2, 3] as const).map((l) => (
              <button
                key={String(l)}
                type="button"
                onClick={() => setLayerFilter(l)}
                className={`h-6 px-2.5 rounded-md text-[11px] font-mono transition-colors cursor-pointer ${
                  layerFilter === l
                    ? "bg-[var(--item-active-bg)] text-[var(--text-primary)] font-medium shadow-xs"
                    : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                }`}
              >
                {l === "all" ? "All Layers" : `L${l}`}
              </button>
            ))}
          </div>
        </div>

        <span className="text-[11px] font-mono text-[var(--text-tertiary)]">
          {filtered.length} {filtered.length === 1 ? "event" : "events"}
        </span>
      </div>

      {/* Table view */}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">Status</TableHead>
              <TableHead className="w-20">Layer</TableHead>
              <TableHead>Action & Details</TableHead>
              <TableHead>Protocol</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Fee / Gas</TableHead>
              <TableHead className="text-center">HF Before → After</TableHead>
              <TableHead className="text-right w-28">Transaction</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="py-12 text-center text-xs text-[var(--text-tertiary)] font-mono"
                >
                  No activity found matching the selected filters.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((entry) => {
                const StatusIcon = STATUS_ICONS[entry.status] ?? Clock;
                const layerNum: 1 | 2 | 3 =
                  entry.layer ??
                  (entry.source.includes("L1") || entry.source.includes("Hot")
                    ? 1
                    : entry.source.includes("L2") || entry.source.includes("Position")
                    ? 2
                    : 3);

                const hasDelta = entry.hfBefore !== entry.hfAfter;
                const cleanTxHash =
                  entry.txHash && entry.txHash !== "—"
                    ? entry.txHash.replace("…", "").trim()
                    : null;
                const txUrl = cleanTxHash
                  ? `https://sepolia.arbiscan.io/tx/${cleanTxHash}`
                  : null;

                return (
                  <TableRow key={entry.id}>
                    {/* Status */}
                    <TableCell>
                      <div className="flex items-center justify-center">
                        <StatusIcon
                          className={`w-4 h-4 shrink-0 ${
                            entry.status === "success"
                              ? "text-[var(--safe)]"
                              : entry.status === "failed"
                              ? "text-[var(--danger)]"
                              : "text-[var(--text-tertiary)]"
                          }`}
                          strokeWidth={2}
                        />
                      </div>
                    </TableCell>

                    {/* Layer */}
                    <TableCell>
                      {entry.action === "NOOP" ? (
                        <span className="text-[10px] font-mono text-[var(--text-tertiary)]">
                          System
                        </span>
                      ) : (
                        <LayerBadge layer={layerNum} size="sm" showName={false} />
                      )}
                    </TableCell>

                    {/* Action & Details */}
                    <TableCell>
                      <div>
                        <p className="text-xs font-medium text-[var(--text-primary)]">
                          {ACTION_LABEL[entry.action] ?? entry.action}
                        </p>
                        <p className="text-[10px] font-mono text-[var(--text-tertiary)] mt-0.5">
                          {entry.source} · {entry.timestamp}
                        </p>
                      </div>
                    </TableCell>

                    {/* Protocol */}
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="text-xs font-mono text-[var(--text-secondary)]">
                          {entry.protocol}
                        </span>
                        <span className="text-[10px] font-mono text-[var(--text-tertiary)]">
                          {entry.chain}
                        </span>
                      </div>
                    </TableCell>

                    {/* Amount */}
                    <TableCell className="text-right font-mono text-xs text-[var(--text-primary)]">
                      {entry.amount !== "0" ? (
                        <span>
                          {entry.amount} <span className="text-[var(--text-tertiary)]">{entry.asset}</span>
                        </span>
                      ) : (
                        <span className="text-[var(--text-tertiary)]">—</span>
                      )}
                    </TableCell>

                    {/* Fee / Gas */}
                    <TableCell className="text-right font-mono text-xs text-[var(--text-secondary)]">
                      {entry.gasUsed && entry.gasUsed !== "—" ? (
                        <span>{entry.gasUsed}</span>
                      ) : (
                        <span className="text-[var(--text-tertiary)]">0.00 ETH</span>
                      )}
                    </TableCell>

                    {/* HF Before -> After */}
                    <TableCell className="text-center font-mono text-xs">
                      {hasDelta ? (
                        <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-[var(--bg-elevated)] border border-[var(--border)]">
                          <span className="text-[var(--danger)] font-medium">
                            {entry.hfBefore.toFixed(2)}
                          </span>
                          <span className="text-[var(--text-tertiary)]">→</span>
                          <span className="text-[var(--safe)] font-semibold">
                            {entry.hfAfter.toFixed(2)}
                          </span>
                        </div>
                      ) : (
                        <span className="text-[var(--text-tertiary)]">{entry.hfBefore.toFixed(2)} (no change)</span>
                      )}
                    </TableCell>

                    {/* Tx Hash */}
                    <TableCell className="text-right">
                      {txUrl ? (
                        <a
                          href={txUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-mono text-xs text-[var(--text-secondary)] hover:text-[var(--brand)] transition-colors cursor-pointer group"
                        >
                          <span className="truncate max-w-[80px]">{entry.txHash}</span>
                          <ExternalLink className="w-3 h-3 text-[var(--text-tertiary)] group-hover:text-[var(--brand)] shrink-0" />
                        </a>
                      ) : (
                        <span className="font-mono text-xs text-[var(--text-tertiary)]">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

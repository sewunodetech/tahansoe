"use client";

import React, { useMemo } from "react";
import { Receipt } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LayerBadge } from "@/components/ui/layer-badge";
import { estimateSuccessFee } from "@/lib/sim/fee";
import { useSimSession, useSimStatus } from "@/lib/sim/hooks";
import type { SimEvent } from "@/lib/sim/types";
import { useSimDashboard } from "./sim-context";

interface Row {
  hash: string;
  action: string;
  by: "you" | "guardian";
  layers: number[];
  hfBefore: number | null;
  hfAfter: number | null;
  fee: { amount: number; estimated: boolean; waived?: boolean } | null;
  order: number;
}

const hf = (v: number | null) => (v === null || !Number.isFinite(v) ? "—" : v.toFixed(2));

/** Repaid value of one layer event in USD: L1/L2 amounts are USDC, L3 is WETH sold. */
function layerRepaidUsd(e: SimEvent, price: number): number {
  const amount = Number(e.amount ?? 0);
  if (!Number.isFinite(amount)) return 0;
  return e.layer === 3 ? amount * price : amount;
}

/** Keeper protections grouped per transaction, with the actual fee or the v3 estimate. */
function guardianRows(events: SimEvent[], price: number, triggerHf: number | undefined): Row[] {
  const byTx = new Map<string, SimEvent[]>();
  for (const e of events) byTx.set(e.txHash, [...(byTx.get(e.txHash) ?? []), e]);

  return [...byTx.entries()].map(([hash, list]) => {
    const prot = list.find((e) => e.type === "protected");
    const layers = list.filter((e) => e.type === "layer" && typeof e.layer === "number").map((e) => e.layer as number);
    const feeEvent = list.find((e) => e.type === "fee");
    const hfBefore = prot?.hfBefore ?? null;
    let fee: Row["fee"] = null;
    if (feeEvent) {
      fee = { amount: Number(feeEvent.amount ?? 0), estimated: false, waived: feeEvent.waived };
    } else if (prot && hfBefore !== null) {
      const repaid = list.filter((e) => e.type === "layer").reduce((sum, e) => sum + layerRepaidUsd(e, price), 0);
      const est = estimateSuccessFee({ totalRepaidUsd: repaid, hfBefore, staticTriggerHf: triggerHf ?? Infinity });
      fee = { amount: est.fee, estimated: true };
    }
    return {
      hash,
      action: prot ? "protect()" : "Guardian",
      by: "guardian" as const,
      layers: [...new Set(layers)].sort(),
      hfBefore,
      hfAfter: prot?.hfAfter ?? null,
      fee,
      order: list[0]?.blockNumber ?? 0,
    };
  });
}

/** Stands in for a block explorer: what you sent and what the Guardian did (spec §2). */
export function SimTxList() {
  const { data: session } = useSimSession();
  const { data: status } = useSimStatus(Boolean(session));
  const { txs, baseline } = useSimDashboard();

  const rows = useMemo(() => {
    const keeper = status ? guardianRows(status.events, status.price, baseline?.triggerHf) : [];
    const mine: Row[] = txs.map((t) => ({
      hash: t.hash,
      action: t.action,
      by: "you",
      layers: [],
      hfBefore: t.hfBefore,
      hfAfter: t.hfAfter,
      fee: null,
      order: t.at,
    }));
    // Guardian actions first (newest block first), then your own sends (newest first).
    return [...keeper.sort((a, b) => b.order - a.order), ...mine];
  }, [status, txs, baseline?.triggerHf]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <Receipt className="size-4 text-[var(--brand)]" /> Simulation transactions
        </CardTitle>
        <CardDescription className="text-xs">The fork has no explorer; every transaction lands here.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="px-5 pb-5 text-xs text-[var(--text-tertiary)]">No transactions yet. Open a position with the wizard, then crash the price.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] font-mono">
              <thead>
                <tr className="text-left text-[var(--text-tertiary)] border-b border-[var(--border)]">
                  <th className="px-5 py-2 font-normal">Tx</th>
                  <th className="px-3 py-2 font-normal">Action</th>
                  <th className="px-3 py-2 font-normal">Layer</th>
                  <th className="px-3 py-2 font-normal whitespace-nowrap">HF before → after</th>
                  <th className="px-5 py-2 font-normal text-right">Fee</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {rows.map((r) => (
                  <tr key={`${r.by}-${r.hash}`} className={r.by === "guardian" ? "bg-[var(--safe-bg)]" : undefined}>
                    <td className="px-5 py-2.5 text-[var(--text-secondary)] whitespace-nowrap" title={r.hash}>
                      {r.hash.slice(0, 8)}…{r.hash.slice(-4)}
                    </td>
                    <td className="px-3 py-2.5 text-[var(--text-primary)] whitespace-nowrap">
                      {r.action}
                      {r.by === "guardian" && <span className="ml-1.5 text-[var(--safe)]">keeper</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="inline-flex gap-1">
                        {r.layers.length ? r.layers.map((l) => <LayerBadge key={l} layer={l as 1 | 2 | 3} />) : <span className="text-[var(--text-disabled)]">—</span>}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-[var(--text-primary)]">
                      {hf(r.hfBefore)} → {hf(r.hfAfter)}
                    </td>
                    <td className="px-5 py-2.5 text-right whitespace-nowrap">
                      {r.fee ? (
                        <span className={r.fee.estimated ? "text-[var(--text-tertiary)]" : "text-[var(--text-primary)]"}>
                          ${r.fee.amount.toFixed(2)}
                          {r.fee.estimated && <span className="ml-1">(estimated)</span>}
                          {r.fee.waived && <span className="ml-1 text-[var(--safe)]">part waived</span>}
                        </span>
                      ) : (
                        <span className="text-[var(--text-disabled)]">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

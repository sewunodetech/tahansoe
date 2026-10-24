"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowUpRight, Layers, Network } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { usePositions, type ChainRead, type PositionWithStatus } from "@/hooks/usePositions";
import { useLiveTarget } from "@/lib/live-target";
import { byDebtDesc, hasDebt } from "@/lib/positions/status";
import { usd } from "@/lib/positions/format";
import { PositionCard } from "./position-card";
import { PROTOCOL_LABEL, StatusBadge } from "./status-badge";

const SHOW_ONE_KEY = "tahansoe:positions:arbitrum-one";

/** Remembered per browser; Arbitrum One is read over a public RPC, so it is opt-in. */
function useShowArbitrumOne(): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState(false);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate the saved choice after mount
      if (localStorage.getItem(SHOW_ONE_KEY) === "1") setOn(true);
    } catch { /* storage blocked — keep the default */ }
  }, []);
  const set = (v: boolean) => {
    setOn(v);
    try {
      localStorage.setItem(SHOW_ONE_KEY, v ? "1" : "0");
    } catch { /* storage blocked — the choice lasts for this session only */ }
  };
  return [on, set];
}

function groupKey(item: PositionWithStatus) {
  return `${item.position.protocol}:${item.position.chainId}`;
}

/** Positions page: every borrow position, grouped by protocol and chain, plus supplied-only ones. */
export function PositionsView() {
  const target = useLiveTarget();
  const [showOne, setShowOne] = useShowArbitrumOne();
  const { positions, chains, isLoading, unavailable } = usePositions({ includeArbitrumOne: !target.isSimulation && showOne });

  if (unavailable) {
    return (
      <Card className="p-6 flex items-start gap-3">
        <Network className="size-5 text-[var(--warning)] shrink-0 mt-0.5" />
        <div>
          <p className="text-sm text-[var(--text-primary)]">Simulation chain not connected</p>
          <p className="text-xs text-[var(--text-tertiary)] mt-1">Positions appear once the simulation fork is ready.</p>
        </div>
      </Card>
    );
  }

  return (
    <PositionsList
      positions={positions}
      chains={chains}
      isLoading={isLoading}
      isSimulation={target.isSimulation}
      showArbitrumOne={showOne}
      onShowArbitrumOne={setShowOne}
    />
  );
}

export interface PositionsListProps {
  positions: PositionWithStatus[];
  chains: ChainRead[];
  isLoading: boolean;
  isSimulation: boolean;
  showArbitrumOne: boolean;
  onShowArbitrumOne: (v: boolean) => void;
}

/** Presentational half of the Positions page. */
export function PositionsList({ positions, chains, isLoading, isSimulation, showArbitrumOne, onShowArbitrumOne }: PositionsListProps) {
  const borrows = positions.filter((p) => hasDebt(p.position)).sort((a, b) => byDebtDesc(a.position, b.position));
  const supplied = positions.filter((p) => !hasDebt(p.position));

  const groups = new Map<string, PositionWithStatus[]>();
  for (const item of borrows) {
    const key = groupKey(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-[var(--text-tertiary)] max-w-[560px]">
          Read on-chain from each protocol. Health Factor comes from the protocol itself; dollar values are for display.
        </p>
        {!isSimulation && (
          <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)] cursor-pointer select-none">
            <Switch checked={showArbitrumOne} onCheckedChange={onShowArbitrumOne} aria-label="Show Arbitrum One" />
            Show Arbitrum One <span className="font-mono text-[10px] text-[var(--text-tertiary)]">read-only</span>
          </label>
        )}
      </div>

      {chains.map((c) =>
        c.error ? (
          <Card key={c.chainId} className="p-4 flex items-start gap-2.5">
            <AlertTriangle className="size-4 text-[var(--warning)] shrink-0 mt-0.5" />
            <p className="text-xs text-[var(--text-secondary)] break-words">
              Could not read {c.chainName}: <span className="font-mono text-[var(--text-tertiary)]">{c.error}</span>
            </p>
          </Card>
        ) : null
      )}

      {isLoading && <PositionSkeleton />}

      {[...groups.entries()].map(([key, items]) => (
        <section key={key} className="space-y-3" aria-label={`${PROTOCOL_LABEL[items[0].position.protocol]} on ${items[0].chainName}`}>
          <GroupHeading item={items[0]} count={items.length} />
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {items.map((item) => (
              <PositionCard key={item.position.id} item={item} />
            ))}
          </div>
        </section>
      ))}

      {chains.some((c) => c.isLoading) && !isLoading && (
        <p className="text-[11px] font-mono text-[var(--text-tertiary)]">
          Reading {chains.filter((c) => c.isLoading).map((c) => c.chainName).join(", ")}…
        </p>
      )}

      {!isLoading && borrows.length === 0 && <EmptyBorrows isSimulation={isSimulation} />}

      {supplied.length > 0 && (
        <section className="space-y-3" aria-label="Supplied only">
          <div>
            <h2 className="text-sm font-medium text-[var(--text-primary)]">Supplied only</h2>
            <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">No debt, so nothing to liquidate. Supplied aTokens can back Layer 2.</p>
          </div>
          <Card className="divide-y divide-[var(--border)]">
            {supplied.map((item) => (
              <div key={item.position.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="text-[13px] text-[var(--text-primary)]">
                    {PROTOCOL_LABEL[item.position.protocol]} · <span className="text-[var(--text-secondary)]">{item.chainName}</span>
                  </p>
                  <p className="text-[11px] font-mono text-[var(--text-tertiary)] mt-0.5 truncate">
                    {item.position.collateral.map((a) => a.symbol).join(", ") || "Supplied assets"} · {usd(Number(item.position.collateralValueUsd) / 1e8)}
                  </p>
                </div>
                {item.status.kind === "monitor-only" && <StatusBadge status={item.status} />}
              </div>
            ))}
          </Card>
        </section>
      )}
    </div>
  );
}

function GroupHeading({ item, count }: { item: PositionWithStatus; count: number }) {
  return (
    <div className="flex items-center gap-2">
      <Layers className="size-4 text-[var(--brand)]" />
      <h2 className="text-sm font-medium text-[var(--text-primary)]">{PROTOCOL_LABEL[item.position.protocol]}</h2>
      <span className="text-[11px] font-mono text-[var(--text-tertiary)]">
        {item.chainName} · {count} {count === 1 ? "position" : "positions"}
      </span>
    </div>
  );
}

export function PositionSkeleton() {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4" aria-busy="true" aria-label="Loading positions">
      {[0, 1].map((i) => (
        <Card key={i} className="p-5 space-y-4">
          <div className="h-8 w-24 rounded-md animate-shimmer" />
          <div className="grid grid-cols-2 gap-3">
            <div className="h-20 rounded-xl animate-shimmer" />
            <div className="h-20 rounded-xl animate-shimmer" />
          </div>
          <div className="h-4 w-2/3 rounded animate-shimmer" />
        </Card>
      ))}
    </div>
  );
}

export function EmptyBorrows({ isSimulation }: { isSimulation: boolean }) {
  return (
    <Card className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <p className="text-sm text-[var(--text-primary)]">No borrow position found</p>
        <p className="text-xs text-[var(--text-tertiary)] mt-1 max-w-[520px]">
          {isSimulation
            ? "Open a position in the simulation (Overview → step 2, or Auto-fill) and it appears here."
            : "Tahansoe protects borrow positions on Aave V3. Borrow on the Aave testnet, or try the whole flow with fake funds in Simulation Mode."}
        </p>
      </div>
      {!isSimulation && (
        <div className="flex flex-wrap gap-3 shrink-0 text-xs">
          <Link href="/connect" className="inline-flex items-center gap-1 text-[var(--brand)] hover:underline">
            Try Simulation Mode <ArrowUpRight className="size-3.5" />
          </Link>
          <a
            href="https://app.aave.com/?marketName=proto_arbitrum_sepolia_v3"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[var(--brand)] hover:underline"
          >
            Open Aave testnet <ArrowUpRight className="size-3.5" />
          </a>
        </div>
      )}
    </Card>
  );
}

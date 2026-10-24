"use client";

import React from "react";
import Link from "next/link";
import { ArrowRight, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { PositionWithStatus } from "@/hooks/usePositions";
import { hfLabel, hfTone, price, TONE_VAR, tokenAmount, usd } from "@/lib/positions/format";
import type { AssetAmount, PositionDetail } from "@tahansoe/domain";
import { healthFactorOf, visibleAssets } from "@/lib/positions/source";
import { displaySymbol } from "@/components/dashboard/guardian-view/capacity";
import { StatusBadge } from "./status-badge";

/** Trigger used to colour HF when the position has no policy of its own. */
const DEFAULT_TRIGGER = 1.3;

export interface PositionCardProps {
  item: PositionWithStatus;
  hfOverride?: number | null;
  onProtect?: (position: PositionDetail) => void;
}

/** One position: per-asset collateral and debt, HF, liquidation price, status and next step. */
export function PositionCard({ item, hfOverride, onProtect }: PositionCardProps) {
  const { position, status } = item;
  const hf = hfOverride !== undefined ? hfOverride : healthFactorOf(position);
  const trigger = status.kind === "protected" ? status.triggerHf : DEFAULT_TRIGGER;
  const tone = hfTone(hf, trigger);
  const liq = position.priceAtHf(1);
  const main = position.mainCollateral;

  return (
    <Card className="p-5 flex flex-col gap-4" data-position-id={position.id}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]">Health Factor</p>
          <p className="text-3xl font-mono font-light tabular-nums" style={{ color: hf === null ? "var(--text-secondary)" : TONE_VAR[tone] }}>
            {hfLabel(hf)}
          </p>
        </div>
        <StatusBadge status={status} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <AssetList title="Collateral" position={position} assets={position.collateral} total={Number(position.collateralValueUsd) / 1e8} />
        <AssetList title="Debt" position={position} assets={position.debt} total={Number(position.debtValueUsd) / 1e8} />
      </div>

      {main && (
        <p className="text-[12px] font-mono text-[var(--text-secondary)]">
          Liquidation when {displaySymbol(main.symbol)} reaches{" "}
          <span className="text-[var(--danger)] tabular-nums">{liq === null ? "—" : price(liq)}</span>
          <span className="text-[var(--text-tertiary)]"> · LT {(position.liquidationThresholdBps / 100).toFixed(1)}%</span>
        </p>
      )}

      <StatusFooter item={item} onProtect={onProtect} />
    </Card>
  );
}

function AssetList({ title, position, assets: all, total }: { title: string; position: PositionDetail; assets: AssetAmount[]; total: number }) {
  const assets = visibleAssets(position, all);
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-subtle)] px-3 py-2.5">
      <div className="flex items-baseline justify-between">
        <p className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]">{title}</p>
        <p className="text-[12px] font-mono tabular-nums text-[var(--text-primary)]">{total > 0 ? usd(total) : "—"}</p>
      </div>
      {assets.length === 0 ? (
        <p className="mt-1.5 text-[11px] text-[var(--text-tertiary)]">None</p>
      ) : (
        <ul className="mt-1.5 space-y-1">
          {assets.map((a) => (
            <li key={`${a.address}:${a.symbol}`} className="flex items-baseline justify-between gap-2 text-[12px] font-mono">
              <span className="text-[var(--text-secondary)] truncate">
                {tokenAmount(a.amount, a.decimals)} {a.symbol}
              </span>
              <span className="text-[var(--text-tertiary)] tabular-nums shrink-0">{a.valueUsd > 0 ? usd(a.valueUsd) : "—"}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusFooter({ item, onProtect }: { item: PositionWithStatus; onProtect?: (position: PositionDetail) => void }) {
  const { status, position } = item;
  if (status.kind === "protected") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-[var(--border)]">
        <p className="text-[11px] text-[var(--text-tertiary)]">
          The Guardian repays {status.debtSymbol} when HF falls to {status.triggerHf.toFixed(2)}.
          {status.note && <span className="text-[var(--warning)]"> {status.note}.</span>}
        </p>
        <Link href="/dashboard/protection" className="inline-flex items-center gap-1 text-[12px] text-[var(--brand)] hover:underline">
          Manage <ArrowRight className="size-3" />
        </Link>
      </div>
    );
  }
  if (status.kind === "not-protected") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-[var(--border)]">
        <p className="text-[11px] text-[var(--text-tertiary)] max-w-[420px]">
          {status.note ?? "Nothing repays this debt automatically yet. Protect this position against liquidation."}
        </p>
        {onProtect ? (
          <Button size="sm" onClick={() => onProtect(position)}>
            Protect this position <ArrowRight className="size-3.5 ml-1" />
          </Button>
        ) : (
          <Button size="sm" asChild>
            <Link href="/dashboard/protection">
              Protect this position <ArrowRight className="size-3.5 ml-1" />
            </Link>
          </Button>
        )}
      </div>
    );
  }
  return (
    <p className="flex items-start gap-2 pt-3 border-t border-[var(--border)] text-[11px] text-[var(--text-tertiary)]">
      <Info className="size-3.5 shrink-0 mt-px" /> {status.reason}
    </p>
  );
}

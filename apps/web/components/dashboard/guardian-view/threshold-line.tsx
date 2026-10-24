"use client";

import React from "react";
import { cn } from "@/lib/utils";
import type { PositionDetail } from "@tahansoe/domain";
import { dropPct, price, unitPrice } from "@/lib/positions/format";
import { displaySymbol } from "./capacity";

/**
 * "ETH $p now · we act at $x (−a%) · liquidation at $y (−b%)" (spec §3.7).
 * Prices are what the main collateral would have to reach with everything else unchanged;
 * display only, never an input to execution (I5).
 */
export function ThresholdLine({ position, trigger, className }: { position: PositionDetail; trigger?: number; className?: string }) {
  const main = position.mainCollateral;
  if (!main) return null;
  const symbol = displaySymbol(main.symbol);
  const now = unitPrice(main);
  const act = trigger !== undefined ? position.priceAtHf(trigger) : null;
  const liq = position.priceAtHf(1);

  return (
    <p className={cn("flex flex-wrap items-baseline gap-x-2 gap-y-1 font-mono text-[12px] text-[var(--text-secondary)]", className)}>
      <span>
        {symbol} <span className="text-[var(--text-primary)] tabular-nums">{price(now)}</span> now
      </span>
      {trigger !== undefined && (
        <>
          <Dot />
          <span>
            we act at <span className="text-[var(--warning)] tabular-nums">{act === null ? "—" : price(act)}</span>
            {act !== null && <span className="text-[var(--text-tertiary)] tabular-nums"> ({dropPct(now, act)})</span>}
          </span>
        </>
      )}
      <Dot />
      <span>
        liquidation at <span className="text-[var(--danger)] tabular-nums">{liq === null ? "—" : price(liq)}</span>
        {liq !== null && <span className="text-[var(--text-tertiary)] tabular-nums"> ({dropPct(now, liq)})</span>}
      </span>
    </p>
  );
}

function Dot() {
  return (
    <span className="text-[var(--text-tertiary)]" aria-hidden="true">
      ·
    </span>
  );
}

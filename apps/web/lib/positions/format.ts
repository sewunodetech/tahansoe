/** Display helpers shared by the Positions page and the Guardian view. */

import type { AssetAmount } from "@tahansoe/domain";

/** Oracle price of one whole token, derived from its display value. */
export function unitPrice(asset: AssetAmount): number {
  const units = Number(asset.amount) / 10 ** asset.decimals;
  return units > 0 ? asset.valueUsd / units : 0;
}

export type HfTone = "safe" | "warning" | "danger";

/** DESIGN.md §2 "Pemetaan status HF": safe above trigger + 0.25, critical at or below the trigger. */
export function hfTone(hf: number | null, trigger: number): HfTone {
  if (hf === null) return "safe";
  if (hf <= trigger) return "danger";
  if (hf <= trigger + 0.25) return "warning";
  return "safe";
}

export const TONE_VAR: Record<HfTone, string> = {
  safe: "var(--safe)",
  warning: "var(--warning)",
  danger: "var(--danger)",
};

export function usd(value: number, digits = 0): string {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** Prices: cents below $100, whole dollars above. */
export function price(value: number): string {
  return usd(value, value < 100 ? 2 : 0);
}

export function tokenAmount(amount: bigint, decimals: number): string {
  const n = Number(amount) / 10 ** decimals;
  return n.toLocaleString("en-US", { maximumFractionDigits: n >= 1000 ? 0 : n >= 1 ? 3 : 6 });
}

/** Drop from `from` to `to` as "−12.4%". */
export function dropPct(from: number, to: number): string {
  if (from <= 0) return "—";
  const pct = ((to - from) / from) * 100;
  const sign = pct <= 0 ? "−" : "+";
  return `${sign}${Math.abs(pct).toFixed(1)}%`;
}

export function hfLabel(hf: number | null): string {
  if (hf === null) return "∞";
  return hf > 99 ? ">99" : hf.toFixed(2);
}

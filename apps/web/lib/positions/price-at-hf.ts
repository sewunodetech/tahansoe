/**
 * Price of the main collateral at which a position reaches a given Health Factor, with every
 * other asset and the debt held constant (spec §3.1).
 *
 * TODO(pos-a-domain): replace with `priceForHealthFactor` from @tahansoe/domain once Task A lands.
 */

import type { AssetAmount } from "./types";

export interface PriceForHfInput {
  collateral: AssetAmount[];
  debt: AssetAmount[];
  /** Weighted liquidation threshold, as a fraction (0.825). */
  lt: number;
  mainCollateral: AssetAmount;
  hf: number;
}

/** Oracle price of one whole token, derived from its display value. */
export function unitPrice(asset: AssetAmount): number {
  const units = Number(asset.amount) / 10 ** asset.decimals;
  return units > 0 ? asset.valueUsd / units : 0;
}

/** null when the position has no debt, no main collateral, or other collateral alone keeps HF above `hf`. */
export function priceForHealthFactor({ collateral, debt, lt, mainCollateral, hf }: PriceForHfInput): number | null {
  const debtUsd = debt.reduce((s, a) => s + a.valueUsd, 0);
  if (debtUsd <= 0 || lt <= 0 || mainCollateral.valueUsd <= 0 || hf <= 0) return null;
  const totalUsd = collateral.reduce((s, a) => s + a.valueUsd, 0);
  const othersUsd = totalUsd - mainCollateral.valueUsd;
  // HF = lt × collateral / debt → main value needed = hf × debt / lt − others.
  const mainNeededUsd = (hf * debtUsd) / lt - othersUsd;
  if (mainNeededUsd <= 0) return null;
  return unitPrice(mainCollateral) * (mainNeededUsd / mainCollateral.valueUsd);
}

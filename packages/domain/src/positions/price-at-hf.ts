/**
 * Harga ambang collateral utama (docs/specs/m1-positions-holdings-guardian-view.md §3.1).
 * Murni, tanpa I/O.
 *
 * HF = Σ(valueUsd_i × LT_i) / debtUsd. Hanya harga collateral utama yang bergerak;
 * aset lain dan utang konstan:
 *   p = (hf × debtUsd − Σ_{i≠main} valueUsd_i × LT_i) / (qty_main × LT_main)
 */

import type { Address } from "../types";
import type { AssetAmount } from "./types";

export interface PriceForHealthFactorInput {
  collateral: readonly AssetAmount[];
  debtUsd: number;
  /** LT default (bps) untuk aset tanpa `liquidationThresholdBps` sendiri. */
  liquidationThresholdBps?: number;
  mainCollateral: Address | AssetAmount;
  hf: number;
}

function ltOf(asset: AssetAmount, fallbackBps: number | undefined): number | null {
  const bps = asset.liquidationThresholdBps ?? fallbackBps;
  if (bps === undefined || !Number.isFinite(bps) || bps <= 0) return null;
  return bps / 10_000;
}

/**
 * Harga USD collateral utama saat HF = `hf`. Null bila mustahil: tidak ada utang,
 * collateral utama tidak ada/nol, LT tidak diketahui, atau collateral lain saja
 * sudah menahan HF di atas `hf` (harga utama boleh jatuh ke nol).
 */
export function priceForHealthFactor(input: PriceForHealthFactorInput): number | null {
  const { collateral, debtUsd, liquidationThresholdBps, hf } = input;
  if (!Number.isFinite(hf) || hf <= 0) return null;
  if (!Number.isFinite(debtUsd) || debtUsd <= 0) return null;

  const mainAddress = (
    typeof input.mainCollateral === "string" ? input.mainCollateral : input.mainCollateral.address
  ).toLowerCase();
  const main = collateral.find((c) => c.address.toLowerCase() === mainAddress);
  if (!main || main.amount <= 0n) return null;

  const qty = Number(main.amount) / 10 ** main.decimals;
  const mainLt = ltOf(main, liquidationThresholdBps);
  if (mainLt === null || !(qty > 0)) return null;

  let rest = 0;
  for (const c of collateral) {
    if (c === main) continue;
    const lt = ltOf(c, liquidationThresholdBps);
    if (lt === null) return null;
    rest += c.valueUsd * lt;
  }

  const price = (hf * debtUsd - rest) / (qty * mainLt);
  return Number.isFinite(price) && price > 0 ? price : null;
}

/** Collateral dengan nilai USD terbesar. */
export function pickMainCollateral(collateral: readonly AssetAmount[]): AssetAmount | undefined {
  return collateral.reduce<AssetAmount | undefined>(
    (best, c) => (best === undefined || c.valueUsd > best.valueUsd ? c : best),
    undefined
  );
}

/** Membuat `PositionDetail.priceAtHf` dari snapshot collateral dan utang. */
export function makePriceAtHf(
  collateral: readonly AssetAmount[],
  debtUsd: number,
  liquidationThresholdBps: number,
  mainCollateral: AssetAmount | undefined
): (hf: number) => number | null {
  if (!mainCollateral) return () => null;
  return (hf) =>
    priceForHealthFactor({ collateral, debtUsd, liquidationThresholdBps, mainCollateral, hf });
}

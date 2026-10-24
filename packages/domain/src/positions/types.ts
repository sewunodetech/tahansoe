/**
 * Tipe posisi rinci untuk halaman Positions dan Guardian view
 * (docs/specs/m1-positions-holdings-guardian-view.md §3.1).
 *
 * Satuan bigint di `Position` untuk reader di modul ini:
 * - `healthFactor`: 1e18; `maxUint256` bila tidak ada utang (konvensi Aave).
 * - `liquidationThreshold`: basis point (8250 = 82,5%).
 * - `collateralValueUsd` / `debtValueUsd`: USD dengan 8 desimal (base currency Aave).
 */

import type { Address, Position } from "../types";

export interface AssetAmount {
  symbol: string;
  address: Address;
  decimals: number;
  amount: bigint;      // token units
  valueUsd: number;    // display only, from the protocol oracle
  /**
   * Liquidation threshold aset ini (bps), bila diketahui. Tambahan di luar spec §3.1:
   * dipakai `priceForHealthFactor` untuk collateral campuran dengan LT berbeda.
   */
  liquidationThresholdBps?: number;
}

export interface PositionDetail extends Position {
  id: string;                    // `${protocol}:${chainId}:${marketId ?? "pool"}:${user}`
  collateral: AssetAmount[];
  debt: AssetAmount[];
  liquidationThresholdBps: number;
  /** Price of the main collateral at which HF hits `trigger` / 1.0, others held constant. */
  priceAtHf: (hf: number) => number | null;
  mainCollateral?: AssetAmount;  // largest collateral by value
  monitorOnly: boolean;          // true where no Guardian can protect it (Morpho, chains without Guardian)
}

export interface PositionReader {
  readonly protocol: Position["protocol"];
  readonly chainId: number;
  read(user: Address): Promise<PositionDetail[]>;
}

/** `AssetAmount` yang aman untuk JSON (bigint → string desimal). */
export interface SerializedAssetAmount extends Omit<AssetAmount, "amount"> {
  amount: string;
}

/**
 * `PositionDetail` yang aman untuk JSON: bigint → string desimal, tanpa fungsi `priceAtHf`.
 * React Query di memori bisa menyimpan `PositionDetail` apa adanya; varian ini untuk
 * cache yang di-persist, route API, atau postMessage. `deserializePosition` membangun
 * ulang `priceAtHf` dari collateral dan utang.
 */
export interface SerializedPositionDetail
  extends Omit<
    PositionDetail,
    | "healthFactor"
    | "liquidationThreshold"
    | "collateralValueUsd"
    | "debtValueUsd"
    | "collateral"
    | "debt"
    | "mainCollateral"
    | "priceAtHf"
  > {
  healthFactor: string;
  liquidationThreshold: string;
  collateralValueUsd: string;
  debtValueUsd: string;
  collateral: SerializedAssetAmount[];
  debt: SerializedAssetAmount[];
  mainCollateral?: SerializedAssetAmount;
}

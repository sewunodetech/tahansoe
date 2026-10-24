/**
 * Position shapes for the Positions page and the Guardian view (spec m1-positions-holdings-guardian-view §3.1).
 *
 * TODO(pos-a-domain): these mirror `PositionDetail` / `PositionReader` from @tahansoe/domain.
 * Once Task A lands, re-export them from the domain package and delete the local copies.
 */

import type { Address, Position } from "@tahansoe/domain";

export interface AssetAmount {
  symbol: string;
  address: Address;
  decimals: number;
  /** Token units. */
  amount: bigint;
  /** Display only, from the protocol oracle. */
  valueUsd: number;
}

export interface PositionDetail extends Position {
  /** `${protocol}:${chainId}:${marketId ?? "pool"}:${user}` */
  id: string;
  collateral: AssetAmount[];
  debt: AssetAmount[];
  liquidationThresholdBps: number;
  /** Price of the main collateral at which HF hits `hf`, others held constant. */
  priceAtHf: (hf: number) => number | null;
  /** Largest collateral by value. */
  mainCollateral?: AssetAmount;
  /** True where no Guardian can protect it (Morpho, chains without Guardian). */
  monitorOnly: boolean;
}

export interface PositionReader {
  readonly protocol: Position["protocol"];
  readonly chainId: number;
  read(user: Address): Promise<PositionDetail[]>;
}

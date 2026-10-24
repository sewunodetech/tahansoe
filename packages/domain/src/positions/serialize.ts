/**
 * Konversi `PositionDetail` ⇄ bentuk JSON-safe (lihat `SerializedPositionDetail`).
 */

import { makePriceAtHf } from "./price-at-hf";
import type {
  AssetAmount,
  PositionDetail,
  SerializedAssetAmount,
  SerializedPositionDetail,
} from "./types";

function serializeAsset(a: AssetAmount): SerializedAssetAmount {
  return { ...a, amount: a.amount.toString() };
}

function deserializeAsset(a: SerializedAssetAmount): AssetAmount {
  return { ...a, amount: BigInt(a.amount) };
}

export function serializePosition(p: PositionDetail): SerializedPositionDetail {
  const { priceAtHf: _priceAtHf, ...rest } = p;
  return {
    ...rest,
    healthFactor: p.healthFactor.toString(),
    liquidationThreshold: p.liquidationThreshold.toString(),
    collateralValueUsd: p.collateralValueUsd.toString(),
    debtValueUsd: p.debtValueUsd.toString(),
    collateral: p.collateral.map(serializeAsset),
    debt: p.debt.map(serializeAsset),
    mainCollateral: p.mainCollateral ? serializeAsset(p.mainCollateral) : undefined,
  };
}

/** Kebalikan `serializePosition`; `priceAtHf` dibangun ulang dari collateral dan utang. */
export function deserializePosition(s: SerializedPositionDetail): PositionDetail {
  const collateral = s.collateral.map(deserializeAsset);
  const debt = s.debt.map(deserializeAsset);
  const mainCollateral = s.mainCollateral
    ? collateral.find((c) => c.address === s.mainCollateral?.address)
    : undefined;
  const debtUsd = debt.reduce((sum, d) => sum + d.valueUsd, 0);
  return {
    ...s,
    healthFactor: BigInt(s.healthFactor),
    liquidationThreshold: BigInt(s.liquidationThreshold),
    collateralValueUsd: BigInt(s.collateralValueUsd),
    debtValueUsd: BigInt(s.debtValueUsd),
    collateral,
    debt,
    mainCollateral,
    priceAtHf: makePriceAtHf(collateral, debtUsd, s.liquidationThresholdBps, mainCollateral),
  };
}

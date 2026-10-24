/**
 * What each protection layer can put to work right now (spec §3.7 "Cadangan").
 *
 * TODO(pos-c-holdings): L1 and L2 are estimated here from useGuardian() (debt-token balance,
 * allowance and caps). Switch to `useHoldings().l1CapacityUsd` and `useReserves().l2CapacityUsd`
 * once Task C lands; L2 then reflects the vault balance instead of the per-action cap alone.
 * Pure: the hook wrapper lives in the component.
 */

import type { Address } from "@tahansoe/domain";

const ZERO = "0x0000000000000000000000000000000000000000";
const BASE_UNIT = 1e8;

export interface CapacityInput {
  policy: { enabled: boolean; maxRepayPerAction: bigint } | null;
  /** Policy debt token: wallet balance, allowance to the Guardian, Aave oracle price (8 decimals). */
  token: { balance: bigint; allowance: bigint; decimals: number; priceBase: bigint } | null;
  layer2: { source: Address; maxAssetsPerAction: bigint } | null;
  layer3: { enabled: boolean; collateralAsset: Address; maxCollateralPerAction: bigint } | null;
  /** Collateral the L3 cap is denominated in, when it is one of the position's assets. */
  l3Collateral?: { address: Address; symbol: string; decimals: number; unitPriceUsd: number };
}

export type LayerCapacity =
  | { on: false }
  | { on: true; usd: number; label: string };

export interface Capacity {
  l1: LayerCapacity;
  l2: LayerCapacity;
  l3: LayerCapacity & { amount?: number; symbol?: string };
  /** Sum of the USD values the layers can cover, L3 only when its price is known. */
  totalUsd: number;
}

const min = (...xs: bigint[]) => xs.reduce((a, b) => (b < a ? b : a));

function tokenUsd(amount: bigint, decimals: number, priceBase: bigint): number {
  return (Number(amount) / 10 ** decimals) * (Number(priceBase) / BASE_UNIT);
}

const fmt = (usd: number) => `$${usd.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

export function computeCapacity({ policy, token, layer2, layer3, l3Collateral }: CapacityInput): Capacity {
  const l1: LayerCapacity =
    policy?.enabled && token
      ? (() => {
          const usd = tokenUsd(min(token.balance, token.allowance, policy.maxRepayPerAction), token.decimals, token.priceBase);
          return { on: true, usd, label: fmt(usd) };
        })()
      : { on: false };

  const l2: LayerCapacity =
    policy?.enabled && layer2 && layer2.source !== ZERO && layer2.maxAssetsPerAction > 0n && token
      ? (() => {
          const usd = tokenUsd(layer2.maxAssetsPerAction, token.decimals, token.priceBase);
          return { on: true, usd, label: `up to ${fmt(usd)}` };
        })()
      : { on: false };

  let l3: Capacity["l3"] = { on: false };
  if (policy?.enabled && layer3?.enabled && layer3.maxCollateralPerAction > 0n) {
    const match = l3Collateral && l3Collateral.address.toLowerCase() === layer3.collateralAsset.toLowerCase() ? l3Collateral : undefined;
    const decimals = match?.decimals ?? 18;
    const symbol = match ? displaySymbol(match.symbol) : "collateral";
    const amount = Number(layer3.maxCollateralPerAction) / 10 ** decimals;
    const usd = match ? amount * match.unitPriceUsd : 0;
    l3 = { on: true, usd, amount, symbol, label: `max ${amount.toLocaleString("en-US", { maximumFractionDigits: 3 })} ${symbol}` };
  }

  const totalUsd = [l1, l2, l3].reduce((s, l) => s + (l.on ? l.usd : 0), 0);
  return { l1, l2, l3, totalUsd };
}

/** WETH reads as ETH to people. */
export function displaySymbol(symbol: string): string {
  return symbol === "WETH" ? "ETH" : symbol;
}

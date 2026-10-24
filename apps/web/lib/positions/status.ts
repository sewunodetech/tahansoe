/**
 * Protection status per position (spec m1-positions-holdings-guardian-view §3.4).
 * Pure: no React, no I/O, so it is unit tested on its own.
 */

import type { Address } from "@tahansoe/domain";
import type { PositionDetail } from "./types";

/** The Guardian a position's chain has, and the wallet's policy on it. */
export interface GuardianContext {
  chainId: number;
  policy: {
    enabled: boolean;
    debtAsset: Address;
    /** Effective trigger (dynamic band included) when known, else the static one. */
    triggerHf: number;
    targetHf: number;
  } | null;
}

export type PositionStatus =
  | { kind: "protected"; triggerHf: number; targetHf: number; debtSymbol: string; note: string | null }
  | { kind: "not-protected"; note: string | null }
  | { kind: "monitor-only"; reason: string };

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * @param guardian the Guardian on the position's chain, or null when that chain has none
 * (Arbitrum One before audit). A context for another chain counts as none.
 */
export function positionStatus(position: PositionDetail, guardian: GuardianContext | null): PositionStatus {
  if (position.protocol !== "aave-v3") {
    return { kind: "monitor-only", reason: "Tahansoe reads this position but cannot act on Morpho yet." };
  }
  // The registry's `monitorOnly` is not used for Aave here: the simulation fork registers its
  // Guardian per session, so the Guardian context passed in is the authority.
  if (!guardian || guardian.chainId !== position.chainId) {
    return { kind: "monitor-only", reason: "No Guardian is deployed on this chain yet, so we watch and alert only." };
  }

  const policy = guardian.policy;
  const debtLine = policy ? position.debt.find((d) => same(d.address, policy.debtAsset)) : undefined;

  if (policy?.enabled && debtLine) {
    const others = position.debt.filter((d) => d !== debtLine);
    return {
      kind: "protected",
      triggerHf: policy.triggerHf,
      targetHf: policy.targetHf,
      debtSymbol: debtLine.symbol,
      // Guardian v2: one policy per wallet, one protected debt asset.
      note: others.length > 0 ? `Only ${debtLine.symbol} debt is protected` : null,
    };
  }

  if (policy?.enabled && position.debt.length > 0) {
    return { kind: "not-protected", note: "Your policy repays a debt asset this position does not borrow." };
  }
  return { kind: "not-protected", note: null };
}

/** Borrow positions first, by debt; supplied-only positions are split out by the page. */
export function hasDebt(position: PositionDetail): boolean {
  return position.debtValueUsd > 0n;
}

export function byDebtDesc(a: PositionDetail, b: PositionDetail): number {
  return a.debtValueUsd === b.debtValueUsd ? 0 : a.debtValueUsd > b.debtValueUsd ? -1 : 1;
}

import type { Address } from "viem";
import type { PositionDetail } from "@tahansoe/domain";
import type { LivePolicyV4, ProtocolType } from "./types";

/**
 * PositionKey format (spec m4-guardian-v4-per-position.md §3.6):
 * aave-v3:<chainId>:<guardian>:<debtAsset>
 * morpho-blue:<chainId>:<guardian>:<marketId>
 * Lowercase string.
 */
export function formatPositionKeyAave({
  chainId,
  guardian,
  debtAsset,
}: {
  chainId: number;
  guardian: string;
  debtAsset: string;
}): string {
  return `aave-v3:${chainId}:${guardian.toLowerCase()}:${debtAsset.toLowerCase()}`;
}

export function formatPositionKeyMorpho({
  chainId,
  guardian,
  marketId,
}: {
  chainId: number;
  guardian: string;
  marketId: string;
}): string {
  return `morpho-blue:${chainId}:${guardian.toLowerCase()}:${marketId.toLowerCase()}`;
}

export interface ParsedPositionKey {
  protocol: ProtocolType;
  chainId: number;
  guardian: Address;
  keyIdentifier: string;
}

export function parsePositionKey(key: string): ParsedPositionKey | null {
  const parts = key.toLowerCase().split(":");
  if (parts.length !== 4) return null;
  const [protocol, chainIdStr, guardian, keyIdentifier] = parts;
  if (protocol !== "aave-v3" && protocol !== "morpho-blue") return null;
  const chainId = Number(chainIdStr);
  if (isNaN(chainId) || chainId <= 0) return null;
  return {
    protocol: protocol as ProtocolType,
    chainId,
    guardian: guardian as Address,
    keyIdentifier,
  };
}

/**
 * Reorders an array by moving an item at `index` up (closer to 0) or down.
 * Pure and immutable.
 */
export function reorderPriority<T>(list: readonly T[], index: number, direction: "up" | "down"): T[] {
  if (index < 0 || index >= list.length) return [...list];
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= list.length) return [...list];

  const next = [...list];
  const temp = next[index];
  next[index] = next[targetIndex];
  next[targetIndex] = temp;
  return next;
}

/**
 * Reorders a debt asset list by moving the specified asset up or down.
 */
export function moveDebtPriority(
  currentList: readonly Address[],
  asset: Address,
  direction: "up" | "down"
): Address[] {
  const index = currentList.findIndex((a) => a.toLowerCase() === asset.toLowerCase());
  if (index === -1) return [...currentList];
  return reorderPriority(currentList, index, direction);
}

/**
 * Validates trigger and target health factors and maximum repay cap.
 */
export function validatePolicyInputs({
  triggerHf,
  targetHf,
  maxRepayPerAction,
}: {
  triggerHf: number;
  targetHf: number;
  maxRepayPerAction: bigint;
}): { valid: boolean; error?: string } {
  if (isNaN(triggerHf) || triggerHf < 1.0) {
    return { valid: false, error: "Trigger Health Factor must be at least 1.00." };
  }
  if (isNaN(targetHf) || targetHf <= triggerHf) {
    return { valid: false, error: "Target Health Factor must be greater than trigger Health Factor." };
  }
  if (targetHf > 5.0) {
    return { valid: false, error: "Target Health Factor cannot exceed 5.00." };
  }
  if (maxRepayPerAction <= 0n) {
    return { valid: false, error: "Max repay per action must be greater than zero." };
  }
  return { valid: true };
}

export type V4PositionStatus =
  | { kind: "protected"; triggerHf: number; targetHf: number; debtSymbol: string; note: string | null }
  | { kind: "not-protected"; note: string | null }
  | { kind: "monitor-only"; reason: string };

/**
 * Determines the status of a position under Guardian v4.
 *
 * For Aave:
 * - if any debt asset borrowed by the position has an enabled policy, it is protected.
 * - if multiple debt assets are borrowed and only some have policies, note that.
 *
 * For Morpho:
 * - if a Morpho Guardian is deployed on the chain, checks if policyOf(marketId) is enabled.
 * - if no Guardian is deployed for Morpho on this chain, status is "monitor-only".
 */
export function positionStatusV4({
  position,
  aaveGuardianAddress,
  morphoGuardianAddress,
  aavePolicies,
  morphoPolicies,
}: {
  position: PositionDetail;
  aaveGuardianAddress: Address | null;
  morphoGuardianAddress: Address | null;
  aavePolicies?: Map<string, LivePolicyV4>; // keyed by lowercase debtAsset
  morphoPolicies?: Map<string, LivePolicyV4>; // keyed by lowercase marketId
}): V4PositionStatus {
  if (position.protocol === "aave-v3") {
    if (!aaveGuardianAddress) {
      return { kind: "monitor-only", reason: "No Guardian is deployed on this chain yet, so we watch and alert only." };
    }

    // Check policies for each borrowed debt asset
    const protectedDebts = position.debt.filter((d) => {
      const pol = aavePolicies?.get(d.address.toLowerCase());
      return pol?.enabled;
    });

    if (protectedDebts.length > 0) {
      const primary = protectedDebts[0];
      const primaryPol = aavePolicies!.get(primary.address.toLowerCase())!;
      const unprotectedCount = position.debt.length - protectedDebts.length;
      return {
        kind: "protected",
        triggerHf: primaryPol.triggerHf,
        targetHf: primaryPol.targetHf,
        debtSymbol: primary.symbol,
        note:
          unprotectedCount > 0
            ? `${protectedDebts.length} of ${position.debt.length} debt assets protected`
            : null,
      };
    }

    return { kind: "not-protected", note: null };
  }

  if (position.protocol === "morpho-blue") {
    if (!morphoGuardianAddress) {
      return { kind: "monitor-only", reason: "Tahansoe reads this position but cannot act on Morpho on this chain yet." };
    }

    // For morpho-blue, position.id or position.marketId represents the market
    // Morpho position usually has marketId in id or params
    const marketId = position.id.toLowerCase();
    const pol = morphoPolicies?.get(marketId);

    if (pol?.enabled) {
      const debtSymbol = position.debt[0]?.symbol ?? "loan token";
      return {
        kind: "protected",
        triggerHf: pol.triggerHf,
        targetHf: pol.targetHf,
        debtSymbol,
        note: null,
      };
    }

    return { kind: "not-protected", note: null };
  }

  return { kind: "monitor-only", reason: "Unsupported protocol." };
}

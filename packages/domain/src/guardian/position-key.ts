/**
 * Kanonik positionKey untuk identifikasi posisi lending on-chain (docs/specs/m4-guardian-v4-per-position.md §3.6).
 *
 * Format string lowercase:
 * - Aave V3:      `aave-v3:<chainId>:<guardian>:<debtAsset>`
 * - Morpho Blue:  `morpho-blue:<chainId>:<guardian>:<marketId>`
 */

import type { Address } from "../types";

export type PositionProtocol = "aave-v3" | "morpho-blue";

export interface AavePositionKeyInput {
  protocol: "aave-v3";
  chainId: number;
  guardian: string | Address;
  debtAsset: string | Address;
  marketId?: never;
}

export interface MorphoPositionKeyInput {
  protocol: "morpho-blue";
  chainId: number;
  guardian: string | Address;
  marketId: string;
  debtAsset?: never;
}

export interface GenericPositionKeyInput {
  protocol: PositionProtocol;
  chainId: number;
  guardian: string | Address;
  debtAsset?: string | Address;
  marketId?: string;
}

export type PositionKeyInput =
  | AavePositionKeyInput
  | MorphoPositionKeyInput
  | GenericPositionKeyInput;

export interface ParsedAavePositionKey {
  protocol: "aave-v3";
  chainId: number;
  guardian: Address;
  debtAsset: Address;
}

export interface ParsedMorphoPositionKey {
  protocol: "morpho-blue";
  chainId: number;
  guardian: Address;
  marketId: string;
}

export type ParsedPositionKey = ParsedAavePositionKey | ParsedMorphoPositionKey;

/**
 * Membuat positionKey kanonik (string lowercase) dari parameter posisi.
 */
export function positionKey(input: PositionKeyInput): string {
  const { protocol, chainId, guardian, debtAsset, marketId } = input;

  if (typeof chainId !== "number" || !Number.isInteger(chainId) || chainId <= 0) {
    throw new TypeError(`positionKey: chainId must be a positive integer, got ${chainId}`);
  }

  if (!guardian || typeof guardian !== "string" || !guardian.trim()) {
    throw new TypeError("positionKey: guardian must be a non-empty string");
  }

  const cleanGuardian = guardian.trim().toLowerCase();

  if (protocol === "aave-v3") {
    if (!debtAsset || typeof debtAsset !== "string" || !debtAsset.trim()) {
      throw new TypeError("positionKey: debtAsset is required for aave-v3");
    }
    return `aave-v3:${chainId}:${cleanGuardian}:${debtAsset.trim().toLowerCase()}`;
  }

  if (protocol === "morpho-blue") {
    if (!marketId || typeof marketId !== "string" || !marketId.trim()) {
      throw new TypeError("positionKey: marketId is required for morpho-blue");
    }
    return `morpho-blue:${chainId}:${cleanGuardian}:${marketId.trim().toLowerCase()}`;
  }

  throw new TypeError(`positionKey: unsupported protocol '${protocol}'`);
}

/**
 * Mem-parse string positionKey menjadi objek ParsedPositionKey terstruktur.
 */
export function parsePositionKey(key: string): ParsedPositionKey {
  if (typeof key !== "string" || !key.trim()) {
    throw new TypeError("parsePositionKey: key must be a non-empty string");
  }

  const parts = key.trim().split(":");
  if (parts.length !== 4) {
    throw new Error(
      `Invalid positionKey format: expected 4 colon-separated segments, got '${key}'`
    );
  }

  const rawProtocol = parts[0];
  const rawChainId = parts[1];
  const rawGuardian = parts[2];
  const rawTarget = parts[3];

  if (!rawProtocol || !rawChainId || !rawGuardian || !rawTarget) {
    throw new Error(
      `Invalid positionKey format: all segments must be non-empty, got '${key}'`
    );
  }

  const protocol = rawProtocol.toLowerCase();
  const chainId = Number(rawChainId);
  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new Error(`Invalid positionKey chainId: '${rawChainId}'`);
  }

  const guardian = rawGuardian.toLowerCase() as Address;
  const target = rawTarget.toLowerCase();

  if (protocol === "aave-v3") {
    return {
      protocol: "aave-v3",
      chainId,
      guardian,
      debtAsset: target as Address,
    };
  }

  if (protocol === "morpho-blue") {
    return {
      protocol: "morpho-blue",
      chainId,
      guardian,
      marketId: target,
    };
  }

  throw new Error(`Unknown positionKey protocol: '${rawProtocol}'`);
}

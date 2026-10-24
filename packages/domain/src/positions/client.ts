/**
 * Helper baca on-chain bersama untuk reader posisi.
 */

import type { Abi, PublicClient } from "viem";
import type { Address } from "../types";
import { erc20Abi } from "./abis";

/** Bagian `PublicClient` yang dipakai reader; memudahkan client tiruan di test. */
export type PositionReaderClient = Pick<
  PublicClient,
  "readContract" | "multicall" | "getLogs" | "getBlockNumber" | "getBlock"
>;

export interface ReaderCallOptions {
  /** Alamat Multicall3 bila chain viem client tidak mendefinisikannya (mis. fork simulasi). */
  multicallAddress?: Address;
}

export interface ContractCall {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
}

export type CallResult =
  | { status: "success"; result: unknown }
  | { status: "failure"; error: Error };

/** Multicall untuk kumpulan panggilan heterogen; tidak ada yang boleh gagal. */
export async function multicallStrict(
  client: PositionReaderClient,
  contracts: readonly ContractCall[],
  opts: ReaderCallOptions = {}
): Promise<unknown[]> {
  if (contracts.length === 0) return [];
  const res = await client.multicall({
    contracts: contracts as never,
    allowFailure: false,
    multicallAddress: opts.multicallAddress,
  });
  return res as unknown[];
}

/** Multicall yang mengizinkan sebagian panggilan gagal. */
export async function multicallLoose(
  client: PositionReaderClient,
  contracts: readonly ContractCall[],
  opts: ReaderCallOptions = {}
): Promise<CallResult[]> {
  if (contracts.length === 0) return [];
  const res = await client.multicall({
    contracts: contracts as never,
    allowFailure: true,
    multicallAddress: opts.multicallAddress,
  });
  return res as unknown as CallResult[];
}

export interface TokenMetadata {
  symbol: string;
  decimals: number;
}

const tokenMetadataCache = new Map<string, TokenMetadata>();

function cacheKey(chainId: number, token: Address): string {
  return `${chainId}:${token.toLowerCase()}`;
}

/** Mengosongkan cache metadata token (untuk test). */
export function clearTokenMetadataCache(): void {
  tokenMetadataCache.clear();
}

/**
 * `symbol`/`decimals` ERC-20, di-cache per chain. Token yang gagal dibaca memakai
 * simbol alamat singkat dan 18 desimal, tanpa di-cache.
 */
export async function readTokenMetadata(
  client: PositionReaderClient,
  chainId: number,
  tokens: readonly Address[],
  opts: ReaderCallOptions = {}
): Promise<Map<string, TokenMetadata>> {
  const out = new Map<string, TokenMetadata>();
  const missing: Address[] = [];
  for (const t of tokens) {
    const hit = tokenMetadataCache.get(cacheKey(chainId, t));
    if (hit) out.set(t.toLowerCase(), hit);
    else if (!missing.some((m) => m.toLowerCase() === t.toLowerCase())) missing.push(t);
  }
  if (missing.length === 0) return out;

  const calls = missing.flatMap((t): ContractCall[] => [
    { address: t, abi: erc20Abi, functionName: "symbol" },
    { address: t, abi: erc20Abi, functionName: "decimals" },
  ]);
  const res = await multicallLoose(client, calls, opts);
  missing.forEach((t, i) => {
    const sym = res[i * 2];
    const dec = res[i * 2 + 1];
    if (sym?.status === "success" && dec?.status === "success") {
      const meta = { symbol: String(sym.result), decimals: Number(dec.result) };
      tokenMetadataCache.set(cacheKey(chainId, t), meta);
      out.set(t.toLowerCase(), meta);
    } else {
      out.set(t.toLowerCase(), { symbol: `${t.slice(0, 6)}…${t.slice(-4)}`, decimals: 18 });
    }
  });
  return out;
}

/** Nilai token (unit terkecil) × harga per token → angka biasa untuk tampilan. */
export function toDisplayValue(amount: bigint, decimals: number, pricePerToken: number): number {
  return (Number(amount) / 10 ** decimals) * pricePerToken;
}

/** USD (angka biasa) → bigint 8 desimal, sesuai satuan `Position.*ValueUsd`. */
export function usdToE8(usd: number): bigint {
  return Number.isFinite(usd) ? BigInt(Math.round(usd * 1e8)) : 0n;
}

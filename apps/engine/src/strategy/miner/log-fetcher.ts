/**
 * Log Fetcher & Cacher untuk event Aave V3 Arbitrum One.
 *
 * Mengambil log Supply, Withdraw, Borrow, Repay, dan LiquidationCall
 * secara ter-chunk dari Aave V3 Pool (ARBITRUM_ONE.aave.pool),
 * dan menyimpannya di disk lokal (apps/engine/.data) agar rerun gratis.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createPublicClient, http, parseEventLogs, type Log } from "viem";
import { arbitrum } from "viem/chains";
import { ARBITRUM_ONE } from "@tahansoe/domain";
import type { CrashWindow, NormalizedAaveEvent } from "./types.ts";

export const AAVE_V3_POOL_EVENTS_ABI = [
  {
    type: "event",
    name: "Supply",
    inputs: [
      { name: "reserve", type: "address", indexed: true },
      { name: "user", type: "address", indexed: false },
      { name: "onBehalfOf", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "referralCode", type: "uint16", indexed: true },
    ],
  },
  {
    type: "event",
    name: "Withdraw",
    inputs: [
      { name: "reserve", type: "address", indexed: true },
      { name: "user", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Borrow",
    inputs: [
      { name: "reserve", type: "address", indexed: true },
      { name: "user", type: "address", indexed: false },
      { name: "onBehalfOf", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "interestRateMode", type: "uint256", indexed: false },
      { name: "borrowRate", type: "uint256", indexed: false },
      { name: "referralCode", type: "uint16", indexed: true },
    ],
  },
  {
    type: "event",
    name: "Repay",
    inputs: [
      { name: "reserve", type: "address", indexed: true },
      { name: "user", type: "address", indexed: true },
      { name: "repayer", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "useATokens", type: "bool", indexed: false },
    ],
  },
  {
    type: "event",
    name: "LiquidationCall",
    inputs: [
      { name: "collateralAsset", type: "address", indexed: true },
      { name: "debtAsset", type: "address", indexed: true },
      { name: "user", type: "address", indexed: true },
      { name: "debtToCover", type: "uint256", indexed: false },
      { name: "liquidatedCollateralAmount", type: "uint256", indexed: false },
      { name: "liquidator", type: "address", indexed: false },
      { name: "receiveAToken", type: "bool", indexed: false },
    ],
  },
] as const;

export interface FetcherOptions {
  rpcUrl?: string;
  cacheDir?: string;
  chunkSize?: bigint;
  forceRefresh?: boolean;
}

export function getDefaultCacheDir(): string {
  const cwd = process.cwd();
  const base =
    cwd.endsWith("apps/engine") || cwd.endsWith("apps\\engine")
      ? cwd
      : path.resolve(cwd, "apps/engine");
  return path.join(base, ".data/miner-cache");
}

const DEFAULT_CHUNK_SIZE = 10_000n;

/**
 * Normalisasi parsed event log Aave V3 menjadi NormalizedAaveEvent.
 */
export function normalizeAaveLog(
  eventName: string,
  args: any,
  blockNumber: bigint,
  logIndex: number,
  transactionHash: string,
): NormalizedAaveEvent | null {
  const txHash = transactionHash.toLowerCase();

  switch (eventName) {
    case "Supply": {
      const user = (args.onBehalfOf ?? args.user).toLowerCase();
      const reserve = args.reserve.toLowerCase();
      return {
        type: "Supply",
        blockNumber,
        logIndex,
        transactionHash: txHash,
        user,
        reserveAsset: reserve,
        amount: BigInt(args.amount),
        extra: {
          onBehalfOf: args.onBehalfOf ? args.onBehalfOf.toLowerCase() : undefined,
        },
      };
    }
    case "Withdraw": {
      const user = args.user.toLowerCase();
      const reserve = args.reserve.toLowerCase();
      return {
        type: "Withdraw",
        blockNumber,
        logIndex,
        transactionHash: txHash,
        user,
        reserveAsset: reserve,
        amount: BigInt(args.amount),
        extra: {
          to: args.to ? args.to.toLowerCase() : undefined,
        },
      };
    }
    case "Borrow": {
      const user = (args.onBehalfOf ?? args.user).toLowerCase();
      const reserve = args.reserve.toLowerCase();
      return {
        type: "Borrow",
        blockNumber,
        logIndex,
        transactionHash: txHash,
        user,
        reserveAsset: reserve,
        amount: BigInt(args.amount),
        extra: {
          onBehalfOf: args.onBehalfOf ? args.onBehalfOf.toLowerCase() : undefined,
          interestRateMode: args.interestRateMode ? BigInt(args.interestRateMode) : undefined,
          borrowRate: args.borrowRate ? BigInt(args.borrowRate) : undefined,
        },
      };
    }
    case "Repay": {
      const user = args.user.toLowerCase();
      const reserve = args.reserve.toLowerCase();
      const repayer = args.repayer.toLowerCase();
      return {
        type: "Repay",
        blockNumber,
        logIndex,
        transactionHash: txHash,
        user,
        reserveAsset: reserve,
        amount: BigInt(args.amount),
        extra: {
          repayer,
          useATokens: Boolean(args.useATokens),
        },
      };
    }
    case "LiquidationCall": {
      const user = args.user.toLowerCase();
      const debtAsset = args.debtAsset.toLowerCase();
      const collateralAsset = args.collateralAsset.toLowerCase();
      return {
        type: "LiquidationCall",
        blockNumber,
        logIndex,
        transactionHash: txHash,
        user,
        reserveAsset: debtAsset,
        amount: BigInt(args.debtToCover),
        extra: {
          collateralAsset,
          liquidatedCollateralAmount: BigInt(args.liquidatedCollateralAmount),
          liquidator: args.liquidator.toLowerCase(),
          receiveAToken: Boolean(args.receiveAToken),
        },
      };
    }
    default:
      return null;
  }
}

/**
 * Serialisasi array NormalizedAaveEvent untuk disimpan ke JSON cache.
 */
function serializeEvents(events: NormalizedAaveEvent[]): string {
  return JSON.stringify(
    events,
    (_key, value) => (typeof value === "bigint" ? value.toString() : value),
    2,
  );
}

/**
 * Deserialisasi array NormalizedAaveEvent dari JSON cache.
 */
function deserializeEvents(jsonStr: string): NormalizedAaveEvent[] {
  const parsed = JSON.parse(jsonStr);
  return parsed.map((item: any) => ({
    ...item,
    blockNumber: BigInt(item.blockNumber),
    amount: BigInt(item.amount),
    extra: item.extra
      ? {
          ...item.extra,
          liquidatedCollateralAmount: item.extra.liquidatedCollateralAmount
            ? BigInt(item.extra.liquidatedCollateralAmount)
            : undefined,
          interestRateMode: item.extra.interestRateMode
            ? BigInt(item.extra.interestRateMode)
            : undefined,
          borrowRate: item.extra.borrowRate
            ? BigInt(item.extra.borrowRate)
            : undefined,
        }
      : undefined,
  }));
}

/**
 * Mengambil log dari cache lokal atau RPC arsip Arbitrum One.
 */
export async function fetchWindowLogs(
  window: CrashWindow,
  options: FetcherOptions = {},
): Promise<NormalizedAaveEvent[]> {
  const cacheDir = options.cacheDir ?? getDefaultCacheDir();
  const cacheFile = path.join(cacheDir, `${window.id}-logs.json`);

  // 1. Cek disk cache jika tidak force refresh
  if (!options.forceRefresh) {
    try {
      const content = await fs.readFile(cacheFile, "utf-8");
      const cached = deserializeEvents(content);
      return cached;
    } catch {
      // Belum ada cache, lanjutkan fetch
    }
  }

  // 2. Jika tidak ada cache, pastikan RPC URL tersedia
  const rpcUrl = options.rpcUrl ?? process.env.ARB_ONE_RPC_URL;
  if (!rpcUrl) {
    throw new Error(
      `Cache tidak ditemukan untuk window ${window.id} dan ARB_ONE_RPC_URL tidak diset. ` +
        `Jalankan dengan --fixtures untuk data rekaman fixture atau set ARB_ONE_RPC_URL.`,
    );
  }

  const poolAddress = ARBITRUM_ONE.aave?.pool;
  if (!poolAddress) {
    throw new Error("Alamat Aave Pool Arbitrum One tidak ditemukan di chain registry.");
  }

  const client = createPublicClient({
    chain: arbitrum,
    transport: http(rpcUrl),
  });

  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const events: NormalizedAaveEvent[] = [];

  let from = window.startBlock;
  const to = window.endBlock;

  while (from <= to) {
    const chunkTo = from + chunkSize - 1n < to ? from + chunkSize - 1n : to;

    const rawLogs = await client.getLogs({
      address: poolAddress as `0x${string}`,
      fromBlock: from,
      toBlock: chunkTo,
    });

    const parsedLogs = parseEventLogs({
      abi: AAVE_V3_POOL_EVENTS_ABI,
      logs: rawLogs,
      strict: false,
    });

    for (const log of parsedLogs) {
      const blockNumber = log.blockNumber ?? from;
      const logIndex = log.logIndex ?? 0;
      const txHash = log.transactionHash ?? "";

      const normalized = normalizeAaveLog(
        log.eventName,
        log.args,
        blockNumber,
        logIndex,
        txHash,
      );
      if (normalized) {
        events.push(normalized);
      }
    }

    from = chunkTo + 1n;
  }

  // Urutkan event berdasarkan blockNumber lalu logIndex
  events.sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) {
      return a.blockNumber < b.blockNumber ? -1 : 1;
    }
    return a.logIndex - b.logIndex;
  });

  // Simpan ke disk cache
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeFile(cacheFile, serializeEvents(events), "utf-8");

  return events;
}

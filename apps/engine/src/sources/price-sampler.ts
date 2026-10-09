/**
 * Price Sampler for AaveOracle & Chainlink feeds (ADR 0005, spec §3.8).
 *
 * Mengambil harga live dari Arbitrum One (AaveOracle dan Chainlink aggregator)
 * dan menyimpannya ke tabel `price_samples`.
 * Menyediakan utilitas kuantitatif:
 *  - realizedVolatility: deviasi standar log returns pada time window
 *  - maxDrawdown: peak-to-trough decline pada interval tertentu
 */

import {
  createPublicClient,
  http,
  type Address,
  type PublicClient,
} from "viem";
import { ARBITRUM_ONE, getChainConfig } from "@tahansoe/domain";
import { db, getDb, priceSamples, type Db } from "@tahansoe/db";

export type PriceSource = "aave_oracle" | "chainlink_proxy";

export interface SampledPrice {
  asset: "WETH" | "USDC" | string;
  source: PriceSource;
  priceUsd: string;
  blockNumber: bigint;
  sampledAt: Date;
}

export interface PriceSamplerOptions {
  chainId?: number;
  rpcUrl?: string;
  client?: PublicClient;
  db?: Db;
  now?: Date;
}

const AAVE_ORACLE_ABI = [
  {
    type: "function",
    name: "getAssetPrice",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

const AGGREGATOR_V3_ABI = [
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
] as const;

/**
 * Format bigint 8 desimal USD menjadi representasi desimal string presisi tinggi.
 * Contoh: 250012345678n -> "2500.12345678"
 */
export function formatPrice8Decimals(raw: bigint): string {
  const isNeg = raw < 0n;
  const val = isNeg ? -raw : raw;
  const str = val.toString().padStart(9, "0");
  const whole = str.slice(0, str.length - 8);
  const frac = str.slice(str.length - 8);
  return `${isNeg ? "-" : ""}${whole}.${frac}`;
}

/**
 * Mengambil harga AaveOracle dan Chainlink Proxy dalam 1 putaran (paralel RPC).
 * Jika DB tersedia, menyimpan hasil ke tabel `price_samples`.
 */
export async function sampleOnce(
  options: PriceSamplerOptions = {},
): Promise<SampledPrice[]> {
  const chainId = options.chainId ?? 42161;
  const now = options.now ?? new Date();

  const chain = getChainConfig(chainId, options.rpcUrl) ?? (chainId === 42161 ? ARBITRUM_ONE : undefined);
  if (!chain) {
    throw new Error(`[price-sampler] Chain configuration not found for chainId: ${chainId}`);
  }

  const aaveOracleAddress = chain.aave?.oracle as Address | undefined;
  const wethAddress = chain.tokens?.WETH as Address | undefined;
  const usdcAddress = chain.tokens?.USDC as Address | undefined;
  const chainlinkEthAddress = chain.priceFeeds["ETH/USD"] as Address | undefined;
  const chainlinkUsdcAddress = chain.priceFeeds["USDC/USD"] as Address | undefined;

  if (
    !aaveOracleAddress ||
    !wethAddress ||
    !usdcAddress ||
    !chainlinkEthAddress ||
    !chainlinkUsdcAddress
  ) {
    throw new Error(
      `[price-sampler] Incomplete oracle or token configuration for chainId: ${chainId}`,
    );
  }

  const rpcUrl =
    options.rpcUrl ||
    process.env.ARBITRUM_RPC_URL ||
    "https://arb1.arbitrum.io/rpc";

  const client =
    options.client ||
    createPublicClient({
      transport: http(rpcUrl, {
        timeout: 10_000,
      }),
    });

  // Query RPC secara paralel dengan allSettled untuk mencegah unhandledRejection jika beberapa call gagal bersamaan
  const [bRes, wethRes, usdcRes, ethClRes, usdcClRes] =
    await Promise.allSettled([
      client.getBlockNumber(),
      client.readContract({
        address: aaveOracleAddress,
        abi: AAVE_ORACLE_ABI,
        functionName: "getAssetPrice",
        args: [wethAddress],
      }),
      client.readContract({
        address: aaveOracleAddress,
        abi: AAVE_ORACLE_ABI,
        functionName: "getAssetPrice",
        args: [usdcAddress],
      }),
      client.readContract({
        address: chainlinkEthAddress,
        abi: AGGREGATOR_V3_ABI,
        functionName: "latestRoundData",
      }),
      client.readContract({
        address: chainlinkUsdcAddress,
        abi: AGGREGATOR_V3_ABI,
        functionName: "latestRoundData",
      }),
    ]);

  if (bRes.status === "rejected") throw bRes.reason;
  if (wethRes.status === "rejected") throw wethRes.reason;
  if (usdcRes.status === "rejected") throw usdcRes.reason;
  if (ethClRes.status === "rejected") throw ethClRes.reason;
  if (usdcClRes.status === "rejected") throw usdcClRes.reason;

  const blockNumber = bRes.value;
  const wethAavePrice = wethRes.value;
  const usdcAavePrice = usdcRes.value;
  const ethRound = ethClRes.value;
  const usdcRound = usdcClRes.value;

  const samples: SampledPrice[] = [
    {
      asset: "WETH",
      source: "aave_oracle",
      priceUsd: formatPrice8Decimals(wethAavePrice),
      blockNumber,
      sampledAt: now,
    },
    {
      asset: "USDC",
      source: "aave_oracle",
      priceUsd: formatPrice8Decimals(usdcAavePrice),
      blockNumber,
      sampledAt: now,
    },
    {
      asset: "WETH",
      source: "chainlink_proxy",
      priceUsd: formatPrice8Decimals(ethRound[1]),
      blockNumber,
      sampledAt: now,
    },
    {
      asset: "USDC",
      source: "chainlink_proxy",
      priceUsd: formatPrice8Decimals(usdcRound[1]),
      blockNumber,
      sampledAt: now,
    },
  ];

  // Simpan ke DB bila koneksi DB tersedia
  let targetDb = options.db;
  if (!targetDb && process.env.DATABASE_URL) {
    try {
      targetDb = getDb();
    } catch {
      // Abaikan bila DATABASE_URL belum di-set
    }
  }

  if (targetDb) {
    await targetDb.insert(priceSamples).values(
      samples.map((s) => ({
        chainId,
        asset: s.asset,
        source: s.source,
        priceUsd: s.priceUsd,
        blockNumber: s.blockNumber,
        sampledAt: s.sampledAt,
      })),
    );
  }

  return samples;
}

/**
 * Menghitung realized volatility (deviasi standar log returns deret harga).
 * Kembalikan 0 jika data < 2 atau harga konstan.
 *
 * @param samples Deret sample harga
 * @param windowMs Filter window durasi ms ke belakang dari sample terakhir (opsional)
 */
export function realizedVolatility(
  samples: Array<{ priceUsd: string | number; sampledAt: Date | string }>,
  windowMs?: number,
): number {
  if (!samples || samples.length < 2) return 0;

  // Urutkan kronologis
  const sorted = [...samples].sort((a, b) => {
    const ta = a.sampledAt instanceof Date ? a.sampledAt.getTime() : new Date(a.sampledAt).getTime();
    const tb = b.sampledAt instanceof Date ? b.sampledAt.getTime() : new Date(b.sampledAt).getTime();
    return ta - tb;
  });

  let filtered = sorted;
  if (windowMs && windowMs > 0 && sorted.length > 0) {
    const last = sorted[sorted.length - 1];
    if (!last) return 0;
    const latestTime =
      last.sampledAt instanceof Date
        ? last.sampledAt.getTime()
        : new Date(last.sampledAt).getTime();
    const cutoff = latestTime - windowMs;
    filtered = sorted.filter((s) => {
      const t = s.sampledAt instanceof Date ? s.sampledAt.getTime() : new Date(s.sampledAt).getTime();
      return t >= cutoff;
    });
  }

  if (filtered.length < 2) return 0;

  const prices = filtered
    .map((s) => Number(s.priceUsd))
    .filter((p) => !isNaN(p) && p > 0);

  if (prices.length < 2) return 0;

  // Deteksi harga konstan
  const first = prices[0];
  if (first === undefined) return 0;
  if (prices.every((p) => p === first)) return 0;

  // Log returns: r_i = ln(P_i / P_{i-1})
  const logReturns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const prev = prices[i - 1];
    const curr = prices[i];
    if (prev === undefined || curr === undefined || prev <= 0) continue;
    const r = Math.log(curr / prev);
    logReturns.push(r);
  }

  if (logReturns.length === 0) return 0;

  const sum = logReturns.reduce((acc, r) => acc + r, 0);
  const mean = sum / logReturns.length;

  let variance = 0;
  for (const r of logReturns) {
    variance += (r - mean) ** 2;
  }

  if (logReturns.length > 1) {
    variance /= logReturns.length - 1;
  } else {
    variance /= logReturns.length;
  }

  const stdDev = Math.sqrt(variance);
  return isNaN(stdDev) ? 0 : stdDev;
}

/**
 * Menghitung maximum drawdown (peak-to-trough decline).
 * Kembalikan 0 jika harga konstan atau selalu naik.
 *
 * @param samples Deret sample harga
 * @param from Filter waktu awal (opsional)
 * @param to Filter waktu akhir (opsional)
 */
export function maxDrawdown(
  samples: Array<{ priceUsd: string | number; sampledAt: Date | string }>,
  from?: Date,
  to?: Date,
): number {
  if (!samples || samples.length < 2) return 0;

  let filtered = samples;
  if (from || to) {
    const fromTime = from ? from.getTime() : -Infinity;
    const toTime = to ? to.getTime() : Infinity;
    filtered = samples.filter((s) => {
      const t = s.sampledAt instanceof Date ? s.sampledAt.getTime() : new Date(s.sampledAt).getTime();
      return t >= fromTime && t <= toTime;
    });
  }

  if (filtered.length < 2) return 0;

  const sorted = [...filtered].sort((a, b) => {
    const ta = a.sampledAt instanceof Date ? a.sampledAt.getTime() : new Date(a.sampledAt).getTime();
    const tb = b.sampledAt instanceof Date ? b.sampledAt.getTime() : new Date(b.sampledAt).getTime();
    return ta - tb;
  });

  const prices = sorted
    .map((s) => Number(s.priceUsd))
    .filter((p) => !isNaN(p) && p > 0);

  if (prices.length < 2) return 0;

  const first = prices[0];
  if (first === undefined) return 0;
  let peak = first;
  let maxDd = 0;

  for (const p of prices) {
    if (p > peak) {
      peak = p;
    } else if (peak > 0) {
      const dd = (peak - p) / peak;
      if (dd > maxDd) {
        maxDd = dd;
      }
    }
  }

  return maxDd;
}

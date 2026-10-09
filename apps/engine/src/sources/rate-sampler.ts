/**
 * Rate Sampler for Aave V3 Arbitrum One reserves (spec m3-carry-interest-monitoring §3.2, jalur T11).
 *
 * Mengambil rate on-chain Aave V3 per reserve (supply APY, borrow APR/APY, utilization, parameter kurva)
 * dan menyimpannya ke tabel `rate_samples`.
 * Graceful degradation (I6): error query/DB dicatat dan tidak pernah melempar fatal.
 */

import type { PublicClient } from "viem";
import { getDb, rateSamples, type Db } from "@tahansoe/db";
import { fetchAaveRates, type ReserveRate, type AaveRatesResult } from "./aave-rates.ts";
import { withTransientRetry } from "../db/store.ts";

export interface RateSamplerOptions {
  chainId?: number;
  rpcUrl?: string;
  client?: PublicClient;
  db?: Db;
  now?: Date;
  timeoutMs?: number;
}

export interface SampleRatesResult {
  reserves: ReserveRate[];
  warnings: string[];
  sampledAt: Date;
}

/**
 * Mengambil rates Aave V3 satu putaran dan menyimpannya ke tabel `rate_samples` jika DB tersedia.
 * Menjamin tidak pernah melempar (graceful degradation).
 */
export async function sampleRatesOnce(
  options: RateSamplerOptions = {},
): Promise<SampleRatesResult> {
  const chainId = options.chainId ?? 42161;
  const now = options.now ?? new Date();

  let ratesResult: AaveRatesResult;
  try {
    ratesResult = await fetchAaveRates({
      rpcUrl: options.rpcUrl,
      client: options.client,
      now,
      timeoutMs: options.timeoutMs ?? 15_000,
    });
  } catch (err) {
    return {
      reserves: [],
      warnings: [`fetchAaveRates failed: ${err instanceof Error ? err.message : String(err)}`],
      sampledAt: now,
    };
  }

  // Simpan ke DB bila koneksi DB tersedia dan ada data reserve
  let targetDb = options.db;
  if (!targetDb && process.env.DATABASE_URL) {
    try {
      targetDb = getDb();
    } catch {
      // Abaikan bila DATABASE_URL belum valid / unconfigured
    }
  }

  if (targetDb && ratesResult.reserves.length > 0) {
    try {
      const rows = ratesResult.reserves.map((r) => ({
        chainId,
        asset: r.asset,
        address: r.address,
        supplyApy: r.supplyApy.toFixed(6),
        borrowApr: r.borrowApr.toFixed(6),
        borrowApy: r.borrowApy.toFixed(6),
        utilization: r.utilization.toFixed(6),
        optimalUtilization: r.curve ? r.curve.optimalUtil.toFixed(6) : null,
        slope2: r.curve ? r.curve.slope2.toFixed(6) : null,
        baseRate: r.curve ? r.curve.baseRate.toFixed(6) : null,
        slope1: r.curve ? r.curve.slope1.toFixed(6) : null,
        sampledAt: ratesResult.sampledAt,
      }));

      await withTransientRetry(() => targetDb!.insert(rateSamples).values(rows));
    } catch (err) {
      ratesResult.warnings.push(
        `Failed to store rate_samples in DB: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return ratesResult;
}

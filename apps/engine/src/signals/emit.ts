/**
 * Deterministic Signal Emitter (spec m2-deterministic-signal-modules & m3-carry-interest-monitoring).
 *
 * Pola emitter deterministik modular:
 * Mengumpulkan sinyal dari generator modul:
 * 1. Carry & Interest monitoring (T11 / T7) - computeCarrySignals
 * 2. Oracle Monitor: Sequencer uptime (T10) & staleness/deviation (T8) - computeOracleSignals
 * 3. Stablecoin Depeg: USDC, USDC.e, USDT, DAI, GHO (T4) - computeDepegSignals
 * 4. Macro Calendar: FOMC, CPI, NFP scheduled in 48h (T1 / T2) - computeMacroSignals
 *
 * Menuliskan sinyal aktif ke tabel `signals` pada tiap tick fusion, dan mengembalikan
 * objek Signal domain.
 */

import type { Signal } from "@tahansoe/domain";
import { getDb, rateSamples, signals, type Db } from "@tahansoe/db";
import { and, desc, eq, gt, gte, inArray, lte } from "drizzle-orm";
import { computeCarrySignals, type ReserveRateSample } from "./carry.ts";
import { computeOracleSignals, type ChainlinkFeedSample, type OracleDeviationSample } from "./oracle.ts";
import { computeDepegSignals, type StablecoinPrice } from "./depeg.ts";
import { computeMacroSignals, type ScheduledMacroEvent } from "./macro.ts";
import { dedupeSignals, getSignalDedupeKey, rowToSignal } from "./dedupe.ts";
import { fetchOnchainSnapshot, type OnchainRawSnapshot } from "../sources/onchain.ts";
import { fetchMacroCalendarEvents } from "../sources/macro-calendar.ts";
import { withTransientRetry } from "../db/store.ts";
import type { PublicClient } from "viem";

export interface EmitSignalsOptions {
  chainId?: number;
  now?: Date;
  db?: Db;
  dry?: boolean;
  rates?: ReserveRateSample[];
  rates24hAgo?: Map<string, number>;
  client?: PublicClient;
  rpcUrl?: string;
  rawSnapshot?: OnchainRawSnapshot;
  macroEvents?: ScheduledMacroEvent[];
  skipOnchain?: boolean;
  skipMacro?: boolean;
}

/**
 * Membaca rate_samples, on-chain snapshot, dan kalender makro,
 * menghitung seluruh sinyal deterministik, dan menyimpannya ke tabel `signals`.
 */
export async function emitDeterministicSignals(
  opts: EmitSignalsOptions = {},
): Promise<Signal[]> {
  const chainId = opts.chainId ?? 42161;
  const now = opts.now ?? new Date();
  const dry = Boolean(opts.dry);

  let targetDb = opts.db;
  if (!targetDb && process.env.DATABASE_URL) {
    try {
      targetDb = getDb();
    } catch {
      // Abaikan bila DATABASE_URL belum valid
    }
  }

  // =========================================================================
  // 1. Modul Carry & Interest Rate (T11 / T7)
  // =========================================================================
  let latestReserves: ReserveRateSample[] = opts.rates ?? [];
  let rates24hAgo = opts.rates24hAgo ?? new Map<string, number>();

  if (latestReserves.length === 0 && targetDb) {
    try {
      const recentRows = await targetDb
        .select()
        .from(rateSamples)
        .where(eq(rateSamples.chainId, chainId))
        .orderBy(desc(rateSamples.sampledAt))
        .limit(100);

      const seen = new Set<string>();
      for (const row of recentRows) {
        const upper = row.asset.toUpperCase();
        if (seen.has(upper)) continue;
        seen.add(upper);

        const curve =
          row.optimalUtilization !== null &&
          row.slope2 !== null &&
          row.baseRate !== null &&
          row.slope1 !== null
            ? {
                optimalUtil: Number(row.optimalUtilization),
                slope2: Number(row.slope2),
                baseRate: Number(row.baseRate),
                slope1: Number(row.slope1),
              }
            : null;

        latestReserves.push({
          asset: row.asset,
          address: row.address,
          supplyApr: Number(row.supplyApy),
          supplyApy: Number(row.supplyApy),
          borrowApr: Number(row.borrowApr),
          borrowApy: Number(row.borrowApy),
          utilization: Number(row.utilization),
          curve,
        });
      }
    } catch {
      // Graceful degradation
    }

    if (opts.rates24hAgo === undefined && targetDb) {
      try {
        const windowStart = new Date(now.getTime() - 26 * 3_600_000);
        const windowEnd = new Date(now.getTime() - 22 * 3_600_000);
        const rows24h = await targetDb
          .select({ asset: rateSamples.asset, borrowApr: rateSamples.borrowApr })
          .from(rateSamples)
          .where(
            and(
              eq(rateSamples.chainId, chainId),
              gte(rateSamples.sampledAt, windowStart),
              lte(rateSamples.sampledAt, windowEnd),
            ),
          )
          .orderBy(desc(rateSamples.sampledAt));

        for (const row of rows24h) {
          const upper = row.asset.toUpperCase();
          if (!rates24hAgo.has(upper)) {
            rates24hAgo.set(upper, Number(row.borrowApr));
          }
        }
      } catch {
        // Graceful degradation
      }
    }
  }

  const carrySignals = computeCarrySignals({
    chainId,
    latestReserves,
    rates24hAgo,
    now,
  });

  // =========================================================================
  // 2. Modul Oracle (T10 Sequencer & T8 Staleness/Deviasi) & Depeg (T4)
  // =========================================================================
  let oracleSignals: Signal[] = [];
  let depegSignals: Signal[] = [];
  let rawEvaluated = false;

  if (!opts.skipOnchain) {
    let raw: OnchainRawSnapshot | undefined = opts.rawSnapshot;

    if (!raw) {
      try {
        const onchainRes = await fetchOnchainSnapshot({
          client: opts.client,
          rpcUrl: opts.rpcUrl,
          now,
        });
        raw = onchainRes.rawSnapshot;
      } catch {
        // Graceful degradation
      }
    }

    if (raw) {
      rawEvaluated = true;
      // --- Oracle Signals (T10 Sequencer & T8 Staleness/Deviasi) ---
      const sequencer =
        raw.sequencerAnswer !== undefined
          ? {
              answer: raw.sequencerAnswer,
              startedAt: raw.sequencerStartedAt,
            }
          : null;

      const feeds: ChainlinkFeedSample[] = [];
      if (raw.ethChainlinkAnswer !== undefined) {
        feeds.push({
          feed: "ETH/USD",
          asset: "ETH",
          answer: raw.ethChainlinkAnswer,
          updatedAt: raw.ethChainlinkUpdatedAt ?? raw.ethChainlinkStartedAt,
          heartbeatSec: 3600,
        });
      }
      if (raw.usdcChainlinkAnswer !== undefined) {
        feeds.push({
          feed: "USDC/USD",
          asset: "USDC",
          answer: raw.usdcChainlinkAnswer,
          updatedAt: raw.usdcChainlinkUpdatedAt ?? raw.usdcChainlinkStartedAt,
          heartbeatSec: 86400,
        });
      }
      if (raw.usdtChainlinkAnswer !== undefined) {
        feeds.push({
          feed: "USDT/USD",
          asset: "USDT",
          answer: raw.usdtChainlinkAnswer,
          updatedAt: raw.usdtChainlinkUpdatedAt ?? raw.usdtChainlinkStartedAt ?? 0n,
          heartbeatSec: 86400,
        });
      }

      const deviations: OracleDeviationSample[] = [];
      if (raw.wethAavePrice && raw.ethChainlinkAnswer) {
        deviations.push({
          asset: "ETH",
          aavePrice: raw.wethAavePrice,
          chainlinkPrice: raw.ethChainlinkAnswer,
        });
      }
      if (raw.usdcAavePrice && raw.usdcChainlinkAnswer) {
        deviations.push({
          asset: "USDC",
          aavePrice: raw.usdcAavePrice,
          chainlinkPrice: raw.usdcChainlinkAnswer,
          isCappedUsdc: true,
        });
      }
      if (raw.aavePrices?.USDT && raw.usdtChainlinkAnswer) {
        deviations.push({
          asset: "USDT",
          aavePrice: raw.aavePrices.USDT,
          chainlinkPrice: raw.usdtChainlinkAnswer,
        });
      }

      oracleSignals = computeOracleSignals({
        chainId,
        now,
        sequencer,
        feeds,
        deviations,
      });

      // --- Depeg Signals (T4) ---
      const stableAssets = ["USDC", "USDC.e", "USDT", "DAI", "GHO"];
      const prices: StablecoinPrice[] = [];
      for (const ast of stableAssets) {
        const rawPrice =
          raw.aavePrices?.[ast] ?? (ast === "USDC" ? raw.usdcAavePrice : undefined);
        if (rawPrice !== undefined) {
          prices.push({
            asset: ast,
            priceUsd: Number(rawPrice) / 1e8,
            isCapped: ast === "USDC",
          });
        }
      }

      depegSignals = computeDepegSignals({
        chainId,
        now,
        prices,
      });
    }
  }

  // =========================================================================
  // 3. Modul Kalender Makro (T1 / T2)
  // =========================================================================
  let macroSignals: Signal[] = [];
  let macroEvaluated = false;

  if (!opts.skipMacro) {
    let macroEvents: ScheduledMacroEvent[] | undefined = opts.macroEvents;

    if (!macroEvents) {
      try {
        const macroRes = await fetchMacroCalendarEvents({ now });
        macroEvents = macroRes.events;
      } catch {
        // Graceful degradation
      }
    }

    if (macroEvents !== undefined) {
      macroEvaluated = true;
      if (macroEvents.length > 0) {
        macroSignals = computeMacroSignals({
          chainId,
          now,
          events: macroEvents,
        });
      }
    }
  }

  // Gabungkan seluruh sinyal deterministik dan deduplikasi di memori
  const allSignals = dedupeSignals([
    ...carrySignals,
    ...oracleSignals,
    ...depegSignals,
    ...macroSignals,
  ]);

  // Kelola persistensi DB: expire baris lama dengan kunci sama atau kondisi yang telah hilang
  if (!dry && targetDb) {
    try {
      // 1. Ambil sinyal aktif yang ada di DB untuk chain ini
      const activeRows = await targetDb
        .select()
        .from(signals)
        .where(and(eq(signals.chainId, chainId), gt(signals.expiresAt, now)));

      // 2. Kumpulkan prefix modul yang dievaluasi pada tick ini
      const evaluatedPrefixes: string[] = ["ONCHAIN:T11:"];
      if (rawEvaluated) {
        evaluatedPrefixes.push("ORACLE:T10:", "ORACLE:T8:", "ONCHAIN:T4:");
      }
      if (macroEvaluated) {
        evaluatedPrefixes.push("MACRO:");
      }

      // 3. Tentukan baris aktif lama yang harus di-expire:
      //    Setiap baris aktif deterministik dari modul yang dievaluasi di-expire (expires_at = now).
      //    Jika kondisinya masih ada, baris baru yang fresh di-insert di bawah (menggantikan baris lama).
      //    Jika kondisinya telah hilang, baris lama berhenti aktif dalam satu tick.
      const rowsToExpire: string[] = [];
      for (const row of activeRows) {
        const sig = rowToSignal(row);
        const key = getSignalDedupeKey(sig);
        if (key && evaluatedPrefixes.some((p) => key.startsWith(p))) {
          rowsToExpire.push(row.id);
        }
      }

      if (rowsToExpire.length > 0) {
        await withTransientRetry(() =>
          targetDb!
            .update(signals)
            .set({ expiresAt: now })
            .where(inArray(signals.id, rowsToExpire)),
        );
      }

      // 4. Masukkan sinyal baru yang aktif (jika ada)
      if (allSignals.length > 0) {
        const rowsToInsert = allSignals.map((s) => ({
          id: s.id,
          chainId,
          module: s.module,
          paths: s.paths,
          assets: s.assets,
          direction: s.direction,
          severity: s.severity.toFixed(4),
          confidence: s.confidence.toFixed(4),
          horizonHours: Math.round(s.horizonHours),
          observedAt: s.observedAt,
          expiresAt: s.expiresAt,
          evidence: s.evidence,
        }));

        await withTransientRetry(() => targetDb!.insert(signals).values(rowsToInsert));
      }
    } catch {
      // Graceful degradation: jangan melempar keluar
    }
  }

  return allSignals;
}

/**
 * Hitung outcome aktual per aset dalam horizon (spec §3.1/§3.5, ADR 0005 §1).
 *
 * Memakai harga AaveOracle tersimpan (tabel price_samples, Invariant I5) + sinyal
 * tersimpan untuk mengevaluasi apakah ada outcome buruk selama horizon report.
 */

import { and, eq, gte, lte } from "drizzle-orm";
import { db, getDb, priceSamples, signals, type Db } from "@tahansoe/db";
import type { TransmissionPath } from "../agents/schemas.ts";
import { BAD_OUTCOME_THRESHOLDS } from "./config.ts";
import { realizedVolatility } from "../sources/price-sampler.ts";

/** Outcome mentah yang disimpan agar label bisa dihitung ulang (ADR 0005 §1). */
export interface Outcome {
  asset: string;
  chainId: number;
  windowStart: Date;
  windowEnd: Date;
  /** Drawdown maksimum harga AaveOracle dari puncak dalam jendela (0..1). */
  maxDrawdownPct: number;
  /** Realized volatility 24j / horizon. */
  realizedVol?: number;
  /** Peg terendah stablecoin dalam jendela. */
  minStablecoinPeg?: number;
  /** Diskon LST maksimum dalam jendela. */
  maxLstDiscountPct?: number;
  /** Jalur yang outcome buruknya terpicu dalam jendela. */
  triggeredPaths: TransmissionPath[];
  /** True jika ADA outcome buruk apa pun dalam jendela. */
  hadBadOutcome: boolean;
  /** Waktu terjadinya outcome terburuk (mis. titik trough max drawdown). */
  worstOutcomeAt?: Date | null;
  /** Menandai jika sampel harga tidak mencukupi untuk penilaian adil. */
  insufficientData?: boolean;
  /** Alasan data tidak mencukupi. */
  insufficientReason?: string;
}

export interface RawPriceSample {
  asset: string;
  source: string;
  priceUsd: string | number;
  sampledAt: Date | string;
}

export interface RawSignalSample {
  module: string;
  paths?: TransmissionPath[] | null;
  severity: string | number;
  observedAt?: Date | string;
}

export const SAMPLE_EDGE_TOLERANCE_MIN = 30;
export const MAX_SAMPLE_GAP_MIN = 60;

export interface ComputeOutcomeParams {
  asset: string;
  chainId: number;
  windowStart: Date;
  windowEnd: Date;
  /** Injeksi sampel harga (berguna untuk testing offline tanpa koneksi DB). */
  priceSamples?: RawPriceSample[];
  /** Injeksi sinyal (berguna untuk testing offline tanpa koneksi DB). */
  signals?: RawSignalSample[];
  /** Database instance opsional. */
  db?: Db;
  /** Ambang minimum sampel harga agar dianggap valid (default: 2). */
  minSamples?: number;
  /** Toleransi jarak batas jendela (menit) (default: SAMPLE_EDGE_TOLERANCE_MIN). */
  edgeToleranceMin?: number;
  /** Jeda maksimum antar sampel (menit) (default: MAX_SAMPLE_GAP_MIN). */
  maxSampleGapMin?: number;
}

function normalizeAssetSymbol(asset: string): string {
  const upper = asset.toUpperCase();
  if (upper === "ETH") return "WETH";
  return upper;
}

/**
 * Hitung Outcome untuk satu aset pada jendela [windowStart, windowEnd].
 */
export async function computeOutcome(
  params: ComputeOutcomeParams,
): Promise<Outcome> {
  const {
    asset,
    chainId,
    windowStart,
    windowEnd,
    minSamples = 2,
    edgeToleranceMin = SAMPLE_EDGE_TOLERANCE_MIN,
    maxSampleGapMin = MAX_SAMPLE_GAP_MIN,
  } = params;

  const targetAsset = normalizeAssetSymbol(asset);

  // 1. Dapatkan price samples (dari parameter atau DB)
  let allSamples: RawPriceSample[] = params.priceSamples ?? [];
  if (!params.priceSamples) {
    let targetDb = params.db;
    if (!targetDb && process.env.DATABASE_URL) {
      try {
        targetDb = getDb();
      } catch {
        // Abaikan bila DATABASE_URL belum di-set
      }
    }

    if (targetDb) {
      try {
        const rows = await targetDb
          .select({
            asset: priceSamples.asset,
            source: priceSamples.source,
            priceUsd: priceSamples.priceUsd,
            sampledAt: priceSamples.sampledAt,
          })
          .from(priceSamples)
          .where(
            and(
              eq(priceSamples.chainId, chainId),
              eq(priceSamples.source, "aave_oracle"), // Invariant I5: oracle eksekusi
              gte(priceSamples.sampledAt, windowStart),
              lte(priceSamples.sampledAt, windowEnd),
            ),
          );
        allSamples = rows;
      } catch (err) {
        return {
          asset,
          chainId,
          windowStart,
          windowEnd,
          maxDrawdownPct: 0,
          triggeredPaths: [],
          hadBadOutcome: false,
          insufficientData: true,
          insufficientReason: `Gagal membaca price_samples dari database: ${String(err)}`,
        };
      }
    }
  }

  // Filter sampel untuk aset target yang bersumber dari aave_oracle
  const primarySamples = allSamples.filter(
    (s) =>
      s.source === "aave_oracle" &&
      normalizeAssetSymbol(s.asset) === targetAsset,
  );

  // 2. Periksa kecukupan data (Data Sufficiency Guard)
  if (primarySamples.length < minSamples) {
    return {
      asset,
      chainId,
      windowStart,
      windowEnd,
      maxDrawdownPct: 0,
      triggeredPaths: [],
      hadBadOutcome: false,
      insufficientData: true,
      insufficientReason: `Data harga ${asset} dalam horizon tidak mencukupi (ditemukan ${primarySamples.length} sampel, minimum ${minSamples})`,
    };
  }

function toEpochMs(d: Date | string): number {
  return typeof d === "string" ? new Date(d).getTime() : d.getTime();
}

  // 3. Urutkan sampel secara kronologis
  const sortedPrimary = [...primarySamples].sort(
    (a, b) => toEpochMs(a.sampledAt) - toEpochMs(b.sampledAt),
  );

  // 4. Periksa cakupan waktu sampel (Coverage Guard, ADR 0005)
  const firstSampleTime = toEpochMs(sortedPrimary[0]!.sampledAt);
  const lastSampleTime = toEpochMs(sortedPrimary[sortedPrimary.length - 1]!.sampledAt);

  // (a) Late start check: First sample must be within tolerance of windowStart
  const startDiffMin = (firstSampleTime - windowStart.getTime()) / (60 * 1000);
  if (startDiffMin > edgeToleranceMin) {
    return {
      asset,
      chainId,
      windowStart,
      windowEnd,
      maxDrawdownPct: 0,
      triggeredPaths: [],
      hadBadOutcome: false,
      insufficientData: true,
      insufficientReason: `late start: first sample is ${startDiffMin.toFixed(1)} minutes after windowStart (tolerance: ${edgeToleranceMin} min)`,
    };
  }

  // (b) Early end check: Last sample must be within tolerance of windowEnd
  const endDiffMin = (windowEnd.getTime() - lastSampleTime) / (60 * 1000);
  if (endDiffMin > edgeToleranceMin) {
    return {
      asset,
      chainId,
      windowStart,
      windowEnd,
      maxDrawdownPct: 0,
      triggeredPaths: [],
      hadBadOutcome: false,
      insufficientData: true,
      insufficientReason: `early end: last sample is ${endDiffMin.toFixed(1)} minutes before windowEnd (tolerance: ${edgeToleranceMin} min)`,
    };
  }

  // (c) Internal gap check: No gap between consecutive samples > maxSampleGapMin
  for (let i = 1; i < sortedPrimary.length; i++) {
    const prevTime = toEpochMs(sortedPrimary[i - 1]!.sampledAt);
    const currTime = toEpochMs(sortedPrimary[i]!.sampledAt);
    const gapMin = (currTime - prevTime) / (60 * 1000);
    if (gapMin > maxSampleGapMin) {
      return {
        asset,
        chainId,
        windowStart,
        windowEnd,
        maxDrawdownPct: 0,
        triggeredPaths: [],
        hadBadOutcome: false,
        insufficientData: true,
        insufficientReason: `internal gap: sample gap of ${gapMin.toFixed(1)} minutes exceeds maximum allowed (${maxSampleGapMin} min)`,
      };
    }
  }

  // 5. Hitung Max Drawdown & Titik Terburuk (T1)
  const firstSample = sortedPrimary[0];
  let peak = firstSample ? Number(firstSample.priceUsd) : 0;
  let maxDrawdownPct = 0;
  let worstOutcomeAt: Date | null = null;

  for (const s of sortedPrimary) {
    const p = Number(s.priceUsd);
    if (isNaN(p) || p <= 0) continue;

    if (p > peak) {
      peak = p;
    } else if (peak > 0) {
      const dd = (peak - p) / peak;
      if (dd > maxDrawdownPct) {
        maxDrawdownPct = dd;
        worstOutcomeAt =
          s.sampledAt instanceof Date ? s.sampledAt : new Date(s.sampledAt);
      }
    }
  }

  const triggeredPaths: TransmissionPath[] = [];

  // T1 terpicu jika drawdown harga ≥ 10%
  if (maxDrawdownPct >= BAD_OUTCOME_THRESHOLDS.priceDrawdownPct) {
    triggeredPaths.push("T1");
  }

  // 5. Hitung Realized Volatility (T2)
  const vol = realizedVolatility(sortedPrimary);

  // 6. Evaluasi Depeg Stablecoin USDC (T4)
  const usdcSamples = allSamples.filter(
    (s) =>
      s.source === "aave_oracle" &&
      normalizeAssetSymbol(s.asset) === "USDC",
  );

  let minStablecoinPeg: number | undefined;
  if (usdcSamples.length > 0) {
    const usdcPrices = usdcSamples
      .map((s) => Number(s.priceUsd))
      .filter((p) => !isNaN(p) && p > 0);
    if (usdcPrices.length > 0) {
      minStablecoinPeg = Math.min(...usdcPrices);
      if (minStablecoinPeg < BAD_OUTCOME_THRESHOLDS.stablecoinFloor) {
        if (!triggeredPaths.includes("T4")) triggeredPaths.push("T4");
        if (!worstOutcomeAt) {
          const depegItem = usdcSamples.find(
            (s) => Number(s.priceUsd) === minStablecoinPeg,
          );
          if (depegItem) {
            worstOutcomeAt =
              depegItem.sampledAt instanceof Date
                ? depegItem.sampledAt
                : new Date(depegItem.sampledAt);
          }
        }
      }
    }
  }

  // 7. Evaluasi Sinyal On-chain Eksternal (T9 Exploit, T10 Sequencer Down)
  let signalList: RawSignalSample[] = params.signals ?? [];
  if (!params.signals) {
    let targetDb = params.db;
    if (!targetDb && process.env.DATABASE_URL) {
      try {
        targetDb = getDb();
      } catch {
        // Abaikan
      }
    }
    if (targetDb) {
      try {
        const sigRows = await targetDb
          .select({
            module: signals.module,
            paths: signals.paths,
            severity: signals.severity,
            observedAt: signals.observedAt,
          })
          .from(signals)
          .where(
            and(
              eq(signals.chainId, chainId),
              gte(signals.observedAt, windowStart),
              lte(signals.observedAt, windowEnd),
            ),
          );
        signalList = sigRows as RawSignalSample[];
      } catch {
        // Graceful degradation bila tabel signals belum siap
      }
    }
  }

  for (const sig of signalList) {
    const sev = Number(sig.severity);
    if (sig.module === "ONCHAIN" && sig.paths?.includes("T10") && sev >= 0.8) {
      if (!triggeredPaths.includes("T10")) triggeredPaths.push("T10");
      worstOutcomeAt =
        worstOutcomeAt ??
        (sig.observedAt ? new Date(sig.observedAt) : null);
    }
    if (sig.paths?.includes("T9") && sev >= 0.8) {
      if (!triggeredPaths.includes("T9")) triggeredPaths.push("T9");
      worstOutcomeAt =
        worstOutcomeAt ??
        (sig.observedAt ? new Date(sig.observedAt) : null);
    }
  }

  const hadBadOutcome = triggeredPaths.length > 0;

  return {
    asset,
    chainId,
    windowStart,
    windowEnd,
    maxDrawdownPct,
    realizedVol: vol,
    minStablecoinPeg,
    triggeredPaths,
    hadBadOutcome,
    worstOutcomeAt,
    insufficientData: false,
  };
}

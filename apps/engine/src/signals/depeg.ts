/**
 * Deterministic Stablecoin Depeg Signal Module (spec m2-deterministic-signal-modules §3.3, jalur T4).
 *
 * Memantau deviasi harga AaveOracle untuk stablecoin utama:
 * USDC, USDC.e, USDT, DAI, GHO dari peg $1.00.
 *
 * Aturan:
 * - Deviasi < 1% dari $1 -> tidak ada sinyal (fluktuasi normal)
 * - 1% -> severity 0.5, naik linear sampai 1.0 pada 5%
 * - Severity >= 0.9 (>= 4.6% deviasi) otomatis memicu CRISIS di fusion via DEPEG_CRISIS_SEVERITY
 * - Hanya deviasi ke bawah untuk aset dengan capped feed (USDC)
 *
 * Fungsi MURNI tanpa I/O.
 */

import type { Signal, TransmissionPath } from "@tahansoe/domain";

export interface StablecoinPrice {
  asset: string; // mis. "USDC", "USDC.e", "USDT", "DAI", "GHO"
  priceUsd: number; // nilai desimal USD, mis. 0.95, 0.995, 1.00
  isCapped?: boolean; // default true untuk "USDC"
}

export interface DepegSignalParams {
  chainId?: number;
  now?: Date;
  prices: StablecoinPrice[];
}

export const DEPEG_MIN_DEVIATION = 0.01; // 1%
export const DEPEG_MAX_DEVIATION = 0.05; // 5%
export const DEPEG_CONFIDENCE = 0.9;
export const DEPEG_TTL_MS = 30 * 60 * 1000; // 30 menit

let depegSeq = 0;
function genId(): string {
  depegSeq = (depegSeq + 1) % 1_000_000;
  return `sig-depeg-${Date.now()}-${depegSeq}`;
}

/**
 * Hitung sinyal deterministik depeg ONCHAIN (jalur T4).
 */
export function computeDepegSignals(params: DepegSignalParams): Signal[] {
  const now = params.now ?? new Date();
  const expiresAt = new Date(now.getTime() + DEPEG_TTL_MS);
  const signals: Signal[] = [];

  for (const item of params.prices) {
    if (!Number.isFinite(item.priceUsd) || item.priceUsd <= 0) continue;

    const isCapped = item.isCapped ?? item.asset.toUpperCase() === "USDC";

    let deviation = 0;
    if (isCapped) {
      // Untuk capped feed (USDC), deviasi ke atas $1 diabaikan
      if (item.priceUsd < 1.0) {
        deviation = (1.0 - item.priceUsd) / 1.0;
      }
    } else {
      deviation = Math.abs(item.priceUsd - 1.0) / 1.0;
    }

    // Deviasi < 1% dari $1 -> tidak ada sinyal
    if (deviation < DEPEG_MIN_DEVIATION) {
      continue;
    }

    // 1% -> 0.5, naik linear sampai 1.0 pada 5%
    const severity = Math.min(
      1.0,
      0.5 + ((deviation - DEPEG_MIN_DEVIATION) / (DEPEG_MAX_DEVIATION - DEPEG_MIN_DEVIATION)) * 0.5,
    );
    const dedupeKey = `ONCHAIN:T4:depeg:${item.asset}`;

    signals.push({
      id: genId(),
      module: "ONCHAIN",
      paths: ["T4" as TransmissionPath],
      assets: [item.asset],
      direction: "DOWN",
      severity,
      confidence: DEPEG_CONFIDENCE,
      horizonHours: 24,
      observedAt: now,
      expiresAt,
      dedupeKey,
      evidence: [
        {
          title: `Stablecoin ${item.asset} depeg: AaveOracle price $${item.priceUsd.toFixed(4)} deviates ${(deviation * 100).toFixed(2)}% from peg`,
          source: "aave_oracle",
          dedupeKey,
        },
      ],
    });
  }

  return signals;
}

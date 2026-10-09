/**
 * Sinyal deterministik Bunga & Carry (spec m3-carry-interest-monitoring §3.3, jalur T11).
 *
 * Menghitung sinyal risiko dari rate samples Aave V3:
 *  - Kink proximity: utilization >= optimal kink -> severity naik linear ke 1.0 pada 100%.
 *  - Rate spike: borrow APR >= 2x vs 24h lalu ATAU > 20% untuk stablecoin -> severity tinggi.
 *  - Negative carry: net carry (supplyApr - borrowApr < 0) untuk 5 pasangan representatif -> severity proporsional laju drift HF.
 *  - Jika utilization >= 0.98, memancarkan paths ["T11", "T7"].
 *
 * Fungsi murni tanpa I/O langsung.
 */

import type { Signal, TransmissionPath } from "@tahansoe/domain";
import { netCarry, daysUntilHf } from "../sources/aave-rates.ts";
import { CARRY_THRESHOLDS } from "../fusion/config.ts";

export interface ReserveRateSample {
  asset: string;
  address: string;
  supplyApr: number;
  supplyApy: number;
  borrowApr: number;
  borrowApy: number;
  utilization: number;
  curve: { baseRate: number; slope1: number; slope2: number; optimalUtil: number } | null;
}

export const REPRESENTATIVE_PAIRS = [
  { collateral: "WETH", debt: "USDC" },
  { collateral: "wstETH", debt: "USDC" },
  { collateral: "WETH", debt: "USDT" },
  { collateral: "WBTC", debt: "USDC" },
  { collateral: "wstETH", debt: "WETH" },
] as const;

export const PAIR_RESERVE_SYMBOLS = new Set([
  "WETH",
  "USDC",
  "WSTETH",
  "USDT",
  "WBTC",
]);

export const STABLECOIN_SYMBOLS = new Set([
  "USDC",
  "USDC.E",
  "USDT",
  "DAI",
  "FRAX",
  "LUSD",
  "MAI",
  "GHO",
  "USD0",
  "USDBC",
]);

export function isStablecoinAsset(asset: string): boolean {
  return STABLECOIN_SYMBOLS.has(asset.toUpperCase());
}

export function isPairRelevantAsset(asset: string): boolean {
  return PAIR_RESERVE_SYMBOLS.has(asset.toUpperCase());
}

export interface ComputeCarrySignalsParams {
  chainId?: number;
  latestReserves: ReserveRateSample[];
  rates24hAgo?: Map<string, number>; // asset.toUpperCase() -> borrowApr
  now?: Date;
  idGenerator?: () => string;
}

/**
 * Menghitung sinyal carry & rate deterministik dari data reserve Aave V3.
 */
export function computeCarrySignals(params: ComputeCarrySignalsParams): Signal[] {
  const chainId = params.chainId ?? 42161;
  const now = params.now ?? new Date();
  const expiresAt = new Date(now.getTime() + CARRY_THRESHOLDS.signalTtlMin * 60 * 1000);
  const genId = params.idGenerator ?? (() => crypto.randomUUID());

  const signals: Signal[] = [];

  // Peta lookup reserve terbaru (case-insensitive)
  const reserveMap = new Map<string, ReserveRateSample>();
  for (const r of params.latestReserves) {
    reserveMap.set(r.asset.toUpperCase(), r);
  }

  // 1 & 2: Kink proximity & Rate spike untuk reserve yang relevan
  for (const reserve of params.latestReserves) {
    const upper = reserve.asset.toUpperCase();
    const isStable = isStablecoinAsset(upper);
    const isPairRelevant = isPairRelevantAsset(upper);
    const isPastKink =
      reserve.curve !== null && reserve.utilization >= reserve.curve.optimalUtil;

    // Filter spec: Hanya emit untuk reserve yang relevan dengan 5 pair plus stablecoin yang melewati kink
    if (!isPairRelevant && !(isStable && isPastKink)) {
      continue;
    }

    const paths: TransmissionPath[] =
      reserve.utilization >= CARRY_THRESHOLDS.t7Utilization ? ["T11", "T7"] : ["T11"];

    const assets = upper === "WETH" ? ["WETH", "ETH"] : [reserve.asset];

    // --- Aturan 1: Kink Proximity ---
    if (reserve.curve && reserve.utilization >= reserve.curve.optimalUtil) {
      const denom = Math.max(0.001, 1 - reserve.curve.optimalUtil);
      const excess = (reserve.utilization - reserve.curve.optimalUtil) / denom;
      const severity = Math.min(1.0, Math.max(0.1, excess));

      signals.push({
        id: genId(),
        module: "ONCHAIN",
        paths,
        assets,
        direction: "DOWN",
        severity,
        confidence: CARRY_THRESHOLDS.confidence,
        horizonHours: 24,
        observedAt: now,
        expiresAt,
        evidence: [
          {
            title: `Reserve ${reserve.asset} utilization at ${(reserve.utilization * 100).toFixed(1)}% past optimal kink of ${(reserve.curve.optimalUtil * 100).toFixed(1)}% (borrow APR ${(reserve.borrowApr * 100).toFixed(1)}%)`,
            source: "aave_rates",
          },
        ],
      });
    }

    // --- Aturan 2: Rate Spike ---
    const prevRate = params.rates24hAgo?.get(upper);
    const hasSpike2x =
      prevRate !== undefined &&
      prevRate > 0 &&
      reserve.borrowApr >= CARRY_THRESHOLDS.rateSpikeMultiplier * prevRate;
    const hasStableSpike =
      isStable && reserve.borrowApr > CARRY_THRESHOLDS.stableBorrowAprSpike;

    if (hasSpike2x || hasStableSpike) {
      let severity = 0.7;
      if (hasStableSpike) {
        severity = Math.min(
          1.0,
          Math.max(0.6, 0.6 + (reserve.borrowApr - CARRY_THRESHOLDS.stableBorrowAprSpike) * 1.5),
        );
      } else if (hasSpike2x && prevRate) {
        severity = Math.min(
          1.0,
          Math.max(0.6, 0.5 + (reserve.borrowApr / Math.max(0.001, prevRate)) * 0.1),
        );
      }

      signals.push({
        id: genId(),
        module: "ONCHAIN",
        paths,
        assets,
        direction: "DOWN",
        severity,
        confidence: CARRY_THRESHOLDS.confidence,
        horizonHours: 24,
        observedAt: now,
        expiresAt,
        evidence: [
          {
            title: `Reserve ${reserve.asset} borrow APR spiked to ${(reserve.borrowApr * 100).toFixed(1)}% (spike threshold exceeded)`,
            source: "aave_rates",
          },
        ],
      });
    }
  }

  // --- Aturan 3: Negative Carry untuk 5 Pasangan Representatif ---
  for (const pair of REPRESENTATIVE_PAIRS) {
    const collReserve = reserveMap.get(pair.collateral.toUpperCase());
    const debtReserve = reserveMap.get(pair.debt.toUpperCase());

    if (!collReserve || !debtReserve) continue;

    const carry = netCarry(collReserve.supplyApr, debtReserve.borrowApr);
    if (carry < 0) {
      const annualDrift = -carry;
      const days = daysUntilHf(1.50, 1.45, carry);
      // Severity kecil proporsional laju drift HF
      const severity = Math.min(0.5, Math.max(0.1, annualDrift * 2.0));

      const paths: TransmissionPath[] =
        debtReserve.utilization >= CARRY_THRESHOLDS.t7Utilization ? ["T11", "T7"] : ["T11"];

      const assets: string[] = [pair.collateral, pair.debt];
      if ((pair.collateral === "WETH" || pair.debt === "WETH") && !assets.includes("ETH")) {
        assets.push("ETH");
      }

      signals.push({
        id: genId(),
        module: "ONCHAIN",
        paths,
        assets,
        direction: "DOWN",
        severity,
        confidence: CARRY_THRESHOLDS.confidence,
        horizonHours: 24,
        observedAt: now,
        expiresAt,
        evidence: [
          {
            title: `Negative carry on ${pair.collateral}->${pair.debt}: net carry ${(carry * 100).toFixed(2)}%/yr (HF 1.50->1.45 in ${days ? Math.round(days) : "N/A"} days)`,
            source: "aave_rates",
          },
        ],
      });
    }
  }

  return signals;
}

/**
 * Deterministic Signal Emitter (spec m3-carry-interest-monitoring §3.3).
 *
 * Pola emitter deterministik modular:
 * Mengumpulkan sinyal dari generator modul (seperti computeCarrySignals untuk T11/T7),
 * menuliskan sinyal aktif ke tabel `signals` pada tiap tick fusion, dan mengembalikan
 * objek Signal domain.
 */

import type { Signal } from "@tahansoe/domain";
import { getDb, rateSamples, signals, type Db } from "@tahansoe/db";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { computeCarrySignals, type ReserveRateSample } from "./carry.ts";
import { withTransientRetry } from "../db/store.ts";

export interface EmitSignalsOptions {
  chainId?: number;
  now?: Date;
  db?: Db;
  dry?: boolean;
  rates?: ReserveRateSample[];
  rates24hAgo?: Map<string, number>;
}

/**
 * Membaca rate_samples terbaru dan 24h lalu dari DB, menghitung sinyal deterministik,
 * dan menyimpannya ke tabel `signals` (kecuali dry run).
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

  let latestReserves: ReserveRateSample[] = opts.rates ?? [];
  let rates24hAgo = opts.rates24hAgo ?? new Map<string, number>();

  // Bila rates tidak di-inject langsung dan DB tersedia, baca dari DB
  if (latestReserves.length === 0 && targetDb) {
    try {
      // Ambil 100 sampel terbaru, kelompokkan per aset (ambil yang paling baru per simbol)
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
          supplyApr: Number(row.supplyApy), // aproksimasi APR dari sample
          supplyApy: Number(row.supplyApy),
          borrowApr: Number(row.borrowApr),
          borrowApy: Number(row.borrowApy),
          utilization: Number(row.utilization),
          curve,
        });
      }
    } catch {
      // Graceful: abaikan error baca DB
    }

    // Baca rate ~24 jam lalu
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
        // Graceful
      }
    }
  }

  // Hitung sinyal carry T11 / T7
  const carrySignals = computeCarrySignals({
    chainId,
    latestReserves,
    rates24hAgo,
    now,
  });

  const allSignals = [...carrySignals];

  // Tulis ke DB jika non-dry dan ada sinyal
  if (!dry && targetDb && allSignals.length > 0) {
    try {
      const rowsToInsert = allSignals.map((s) => ({
        id: s.id,
        chainId,
        module: s.module,
        paths: s.paths,
        assets: s.assets,
        direction: s.direction,
        severity: s.severity.toFixed(4),
        confidence: s.confidence.toFixed(4),
        horizonHours: s.horizonHours,
        observedAt: s.observedAt,
        expiresAt: s.expiresAt,
        evidence: s.evidence,
      }));

      await withTransientRetry(() => targetDb!.insert(signals).values(rowsToInsert));
    } catch {
      // Graceful degradation: jangan melempar keluar
    }
  }

  return allSignals;
}

/**
 * Settle Job: Penilai otomatis research_reports setelah masa horizon lewat (ADR 0005, spec §3.5).
 *
 * Mengambil research_reports yang sudah jatuh tempo (horizon_ends_at <= now) dan
 * belum memiliki entri di risk_settlements.
 * Menghitung outcome aktual via price_samples (AaveOracle, I5) dan memberi label
 * TRUE_POSITIVE, FALSE_POSITIVE, MISSED, atau TRUE_NEGATIVE secara deterministik.
 *
 * Invarian & Kebijakan:
 *  - Idempotent: tidak pernah menggandakan baris di risk_settlements.
 *  - Data sufficiency: jika price_samples dalam horizon tidak mencukupi, JANGAN
 *    memberi label spekulatif/palsu; tandai sebagai insufficient_data dan lewati.
 */

import { pathToFileURL } from "node:url";
import { and, eq, isNull, lte } from "drizzle-orm";
import {
  db,
  getDb,
  researchReports,
  riskSettlements,
  type Db,
} from "@tahansoe/db";
import type { Regime, SettlementLabel } from "../agents/schemas.ts";
import { labelOf, leadTimeMinutes, isPositiveRegime } from "./settle.ts";
import { computeOutcome, type ComputeOutcomeParams, type Outcome } from "./outcomes.ts";

try {
  const { setGlobalDispatcher, Agent } = await import("undici");
  if (setGlobalDispatcher && Agent) {
    setGlobalDispatcher(new Agent({ connect: { timeout: 30_000 } }));
  }
} catch {
  // undici opsional
}


export interface SettleJobOptions {
  now?: Date;
  db?: Db;
  chainId?: number;
  /** Fungsi computeOutcome yang dapat di-mock untuk testing offline. */
  computeOutcomeFn?: (params: ComputeOutcomeParams) => Promise<Outcome>;
}

export interface SettledReportItem {
  reportId: string;
  label: SettlementLabel;
  leadTimeMinutes: number | null;
}

export interface InsufficientReportItem {
  reportId: string;
  reason: string;
}

export interface SettleJobResult {
  settled: SettledReportItem[];
  insufficientData: InsufficientReportItem[];
  totalEvaluated: number;
}

/**
 * Menjalankan settlement batch untuk semua research_reports yang horizon-nya sudah berakhir.
 */
export async function runSettlementJob(
  options: SettleJobOptions = {},
): Promise<SettleJobResult> {
  const now = options.now ?? new Date();
  const chainId = options.chainId ?? 42161;
  const outcomeFn = options.computeOutcomeFn ?? computeOutcome;

  let targetDb = options.db;
  if (!targetDb && process.env.DATABASE_URL) {
    try {
      targetDb = getDb();
    } catch {
      // Abaikan jika belum di-set
    }
  }

  if (!targetDb) {
    return {
      settled: [],
      insufficientData: [],
      totalEvaluated: 0,
    };
  }

  // Cari report yang jatuh tempo dan BELUM memiliki baris di risk_settlements (idempotensi)
  const pendingReports = await targetDb
    .select({
      id: researchReports.id,
      chainId: researchReports.chainId,
      report: researchReports.report,
      promptVersion: researchReports.promptVersion,
      horizonEndsAt: researchReports.horizonEndsAt,
      createdAt: researchReports.createdAt,
    })
    .from(researchReports)
    .leftJoin(
      riskSettlements,
      eq(riskSettlements.researchReportId, researchReports.id),
    )
    .where(
      and(
        eq(researchReports.chainId, chainId),
        lte(researchReports.horizonEndsAt, now),
        isNull(riskSettlements.id),
      ),
    );

  const settled: SettledReportItem[] = [];
  const insufficientData: InsufficientReportItem[] = [];

  for (const item of pendingReports) {
    const rawReport = item.report as {
      assets?: string[];
      proposedRegime?: Regime;
    } | null;

    const assets = rawReport?.assets ?? ["WETH"];
    const primaryAsset = assets[0] ?? "WETH";
    const proposedRegime: Regime = rawReport?.proposedRegime ?? "CALM";

    // Hitung outcome aktual dalam horizon
    const outcome = await outcomeFn({
      asset: primaryAsset,
      chainId: item.chainId,
      windowStart: item.createdAt,
      windowEnd: item.horizonEndsAt,
      db: targetDb,
    });

    // Guard: Jika data harga tidak cukup, JANGAN beri label palsu
    if (outcome.insufficientData) {
      insufficientData.push({
        reportId: item.id,
        reason:
          outcome.insufficientReason ??
          "Data harga tidak mencukupi dalam rentang horizon",
      });
      continue;
    }

    // Tentukan apakah regime berada di bawah floor sebelum outcome buruk
    const wasBelowFloorBeforeOutcome = !isPositiveRegime(proposedRegime);

    // Hitung label via logika murni settle.ts
    const label = labelOf({
      assessedRegime: proposedRegime,
      outcome,
      wasBelowFloorBeforeOutcome,
      sampledForTrueNegative: true,
    });

    if (!label) {
      continue;
    }

    const leadTime =
      label === "TRUE_POSITIVE"
        ? leadTimeMinutes(item.createdAt, outcome.worstOutcomeAt ?? null)
        : null;

    // Simpan ke risk_settlements
    await targetDb.insert(riskSettlements).values({
      chainId: item.chainId,
      researchReportId: item.id,
      label,
      leadTimeMinutes: leadTime,
      outcome,
      modelVersion: item.promptVersion ?? "unknown",
      settledAt: now,
    });

    settled.push({
      reportId: item.id,
      label,
      leadTimeMinutes: leadTime,
    });
  }

  return {
    settled,
    insufficientData,
    totalEvaluated: pendingReports.length,
  };
}

// Entry point CLI jika dijalankan langsung
if (
  typeof process !== "undefined" &&
  process.argv?.[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const nowArgIdx = process.argv.indexOf("--now");
  const rawNow = nowArgIdx !== -1 ? process.argv[nowArgIdx + 1] : undefined;
  const cliNow = rawNow ? new Date(rawNow) : undefined;

  runSettlementJob({ now: cliNow })
    .then((result) => {
      console.log(`[settle-job] Evaluasi selesai:`);
      console.log(` - Total report jatuh tempo: ${result.totalEvaluated}`);
      console.log(` - Berhasil disettle: ${result.settled.length}`);
      console.log(` - Dilewati (insufficient data): ${result.insufficientData.length}`);
      if (result.settled.length > 0) {
        console.table(result.settled);
      }
      if (result.insufficientData.length > 0) {
        console.log(`Daftar dilewati:`);
        console.table(result.insufficientData);
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error("[settle-job] Fatal error:", err);
      process.exit(1);
    });
}

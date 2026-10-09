/**
 * Baca/tulis `risk_assessments` (Risk Fusion v1 Tahap 2, spec §3.7/§3.9).
 *
 * - `latestAssessment(chainId, asset)` → prior (regime + createdAt) untuk hysteresis.
 * - `insertAssessment(assessment, reasons)` → satu baris per aset per run.
 *
 * `@tahansoe/db` hanya di server. JANGAN pernah log DATABASE_URL / secret (I8).
 * Numeric drizzle menerima string agar presisi tidak hilang.
 */

import { and, desc, eq } from "drizzle-orm";
import { getDb, riskAssessments } from "@tahansoe/db";
import type { RiskAssessment } from "@tahansoe/domain";
import type { PriorRegime } from "../fusion/index.ts";

/** Prior assessment terbaru per (chain, asset) untuk hysteresis. null bila belum ada. */
export async function latestAssessment(chainId: number, asset: string): Promise<PriorRegime | null> {
  const db = getDb();
  const rows = await db
    .select({ regime: riskAssessments.regime, createdAt: riskAssessments.createdAt })
    .from(riskAssessments)
    .where(and(eq(riskAssessments.chainId, chainId), eq(riskAssessments.asset, asset)))
    .orderBy(desc(riskAssessments.createdAt))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return { regime: row.regime, createdAt: row.createdAt };
}

/** Driver ringkas yang disimpan (bukan Signal penuh): id/module/severity/confidence/paths. */
function slimDrivers(assessment: RiskAssessment): Array<Record<string, unknown>> {
  return assessment.drivers.map((s) => ({
    id: s.id,
    module: s.module,
    severity: s.severity,
    confidence: s.confidence,
    paths: s.paths ?? [],
  }));
}

/** Simpan satu assessment. Mengembalikan id baris. */
export async function insertAssessment(
  assessment: RiskAssessment,
  reasons: string[],
): Promise<string> {
  const db = getDb();
  const [row] = await db
    .insert(riskAssessments)
    .values({
      chainId: assessment.chainId,
      asset: assessment.asset,
      regime: assessment.regime,
      riskScore: assessment.riskScore.toFixed(2),
      drawdownH4: clampFrac(assessment.drawdownEstimate.h4).toFixed(5),
      drawdownH24: clampFrac(assessment.drawdownEstimate.h24).toFixed(5),
      recommendedTriggerHf: assessment.recommendedTriggerHF.toFixed(4),
      recommendedTargetHf: assessment.recommendedTargetHF.toFixed(4),
      drivers: slimDrivers(assessment),
      reasons,
      explanation: assessment.explanation,
      modelVersion: assessment.modelVersion,
      validUntil: assessment.validUntil,
      createdAt: assessment.createdAt,
    })
    .returning({ id: riskAssessments.id });
  return row!.id;
}

/** Jaga fraksi dalam [0, 0.99999] agar muat numeric(6,5). */
function clampFrac(x: number): number {
  if (!Number.isFinite(x) || x < 0) return 0;
  return Math.min(0.99999, x);
}

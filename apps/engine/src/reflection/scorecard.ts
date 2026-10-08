/**
 * Scorecard mingguan/bulanan per modelVersion/promptVersion (spec §3.6, ADR 0005).
 *
 * `computeMetrics` murni (dari agregat label) agar mudah diuji; pengambilan data
 * dari risk_settlements ditandai TODO.
 */

/** Agregat jumlah label dalam periode. */
export interface SettlementCounts {
  truePositive: number;
  falsePositive: number;
  missed: number;
  trueNegative: number;
  /** Median lead time (menit) untuk TP event berperingatan. */
  medianLeadTimeMinutes: number | null;
  /** Proporsi waktu di regime ≥ STRESSED (0..1). */
  timeInStressedFraction: number;
  /** Proporsi output LLM yang lolos schema (0..1). */
  schemaPassRate: number;
}

/** Metrik scorecard beserta status terhadap target awal (spec §3.6). */
export interface Scorecard {
  recall: number | null; // TP / (TP + MISSED)   target ≥ 0.70
  precision: number | null; // TP / (TP + FP)     target ≥ 0.50
  medianLeadTimeMinutes: number | null; // target ≥ 360 (6 jam)
  timeInStressedFraction: number; // target < 0.10
  schemaPassRate: number; // target ≥ 0.98
}

/** Target awal (spec §3.6). */
export const TARGETS = {
  recall: 0.7,
  precision: 0.5,
  leadTimeMinutes: 360,
  maxTimeInStressed: 0.1,
  schemaPassRate: 0.98,
} as const;

/** Hitung metrik dari agregat label. Fungsi murni. */
export function computeMetrics(c: SettlementCounts): Scorecard {
  const recallDen = c.truePositive + c.missed;
  const precDen = c.truePositive + c.falsePositive;
  return {
    recall: recallDen > 0 ? c.truePositive / recallDen : null,
    precision: precDen > 0 ? c.truePositive / precDen : null,
    medianLeadTimeMinutes: c.medianLeadTimeMinutes,
    timeInStressedFraction: c.timeInStressedFraction,
    schemaPassRate: c.schemaPassRate,
  };
}

/**
 * Hasilkan scorecard untuk periode (satu perintah, spec §5).
 *
 * TODO(dev):
 *  - Agregasi risk_settlements per modelVersion/promptVersion dalam rentang tanggal.
 *  - Hitung median lead time dari TP (event berperingatan).
 *  - timeInStressed dari seri regime; schemaPassRate dari log validasi.
 *  - return computeMetrics(counts); cetak ringkas untuk review mingguan.
 */
export async function generateScorecard(_params: {
  from: Date;
  to: Date;
}): Promise<Scorecard> {
  throw new Error(
    "[engine/reflection/scorecard] generateScorecard belum diimplementasikan — lihat TODO (spec §3.6).",
  );
}

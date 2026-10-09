/**
 * Estimasi biaya satu research run per model (ramah pengguna).
 *
 * Profil token (berapa token input/output yang dipakai satu run) berasal dari:
 *  (A) KONSTANTA default dari run nyata 8 Okt 2026 (DEFAULT_TOKEN_PROFILE), atau
 *  (B) rata-rata dari N research_reports terakhir di DB (kolom diagnostics), bila
 *      DATABASE_URL tersedia. Sumber profil disebutkan di output.
 *
 * Estimasi dihitung dari harga per 1M token (lihat pricing.ts / budget.ts). Model
 * "reasoning" dicatat bisa memakan output token lebih banyak dari profil default.
 *
 * Jadwal worker: 12 run/hari saat CALM (interval 120 menit → 12 run / 24 jam).
 */

/** Jumlah run per hari pada regime CALM (schedule.calmIntervalMin = 120 → 12/hari). */
export const RUNS_PER_DAY_CALM = 12;
export const DAYS_PER_MONTH = 30;

/** Profil token satu run: total input & output (semua peran dijumlahkan). */
export interface TokenProfile {
  inputTokens: number;
  outputTokens: number;
  /** Dari mana profil ini: deskripsi untuk ditampilkan. */
  source: string;
}

/**
 * Profil token default dari RUN NYATA 8 Okt 2026:
 *  - analyst 4x  : 8100 in / 400 out  → 32400 in / 1600 out
 *  - hawk+dove 2x: 850 in  / 250 out  → 1700 in  / 500 out
 *  - assessor 1x : 9000 in / 1700 out → 9000 in  / 1700 out
 *  total ≈ 43100 in / 3800 out (dibulatkan ~42.8k/3.8k di catatan).
 * Konstanta ini dipakai bila DB tidak tersedia.
 */
export const DEFAULT_TOKEN_PROFILE: TokenProfile = {
  inputTokens: 4 * 8100 + 2 * 850 + 9000, // 43100
  outputTokens: 4 * 400 + 2 * 250 + 1700, // 3800
  source: "profil default (run nyata 8 Okt 2026: analyst 4×[8100/400], hawk+dove 2×[850/250], assessor [9000/1700])",
};

/** Rincian estimasi biaya satu model. */
export interface CostEstimate {
  /** USD per satu run. */
  perRunUsd: number;
  /** USD per hari (12 run CALM). */
  perDayUsd: number;
  /** USD per bulan (30 hari). */
  perMonthUsd: number;
  /** Estimasi dalam IDR bila sumber harga IDR (mis. Bynara); selain itu undefined. */
  idr?: {
    perRunIdr: number;
    perDayIdr: number;
    perMonthIdr: number;
  };
}

/** Harga minimal yang dibutuhkan untuk estimasi (USD per 1M token, + IDR opsional). */
export interface EstimateInputPrice {
  inputPerM: number;
  outputPerM: number;
  native?: { currency: "IDR"; inputPerM: number; outputPerM: number; usdToNative: number };
}

/**
 * Hitung estimasi biaya untuk satu model dari harga + profil token.
 * perRun = (in/1e6)*inputPerM + (out/1e6)*outputPerM.
 */
export function estimateCost(price: EstimateInputPrice, profile: TokenProfile = DEFAULT_TOKEN_PROFILE): CostEstimate {
  const perRunUsd =
    (profile.inputTokens / 1_000_000) * price.inputPerM +
    (profile.outputTokens / 1_000_000) * price.outputPerM;
  const perDayUsd = perRunUsd * RUNS_PER_DAY_CALM;
  const perMonthUsd = perDayUsd * DAYS_PER_MONTH;

  const estimate: CostEstimate = { perRunUsd, perDayUsd, perMonthUsd };

  if (price.native?.currency === "IDR") {
    const perRunIdr =
      (profile.inputTokens / 1_000_000) * price.native.inputPerM +
      (profile.outputTokens / 1_000_000) * price.native.outputPerM;
    estimate.idr = {
      perRunIdr,
      perDayIdr: perRunIdr * RUNS_PER_DAY_CALM,
      perMonthIdr: perRunIdr * RUNS_PER_DAY_CALM * DAYS_PER_MONTH,
    };
  }
  return estimate;
}

/**
 * Ambil profil token rata-rata dari N research_reports terakhir di DB.
 * Diimpor dinamis agar modul (dan test offline) tidak butuh @tahansoe/db.
 * Mengembalikan null bila gagal / tidak ada data (pemanggil pakai default).
 */
export async function tokenProfileFromDb(limit = 5): Promise<TokenProfile | null> {
  try {
    const { desc } = await import("drizzle-orm");
    const { getDb, researchReports } = await import("@tahansoe/db");
    const db = getDb();
    const rows = await db
      .select()
      .from(researchReports)
      .orderBy(desc(researchReports.createdAt))
      .limit(limit);
    return averageProfile(
      rows.map((r) => (r as { diagnostics?: unknown }).diagnostics),
      rows.length,
    );
  } catch {
    return null;
  }
}

/**
 * Rata-ratakan total input/output token dari array diagnostics (fungsi murni, test-able).
 * Mengembalikan null bila tidak ada diagnostics yang valid.
 */
export function averageProfile(diagnostics: unknown[], count = diagnostics.length): TokenProfile | null {
  let sumIn = 0;
  let sumOut = 0;
  let n = 0;
  for (const d of diagnostics) {
    if (!d || typeof d !== "object") continue;
    const diag = d as { totalInputTokens?: unknown; totalOutputTokens?: unknown };
    const inT = Number(diag.totalInputTokens);
    const outT = Number(diag.totalOutputTokens);
    if (!Number.isFinite(inT) || !Number.isFinite(outT)) continue;
    sumIn += inT;
    sumOut += outT;
    n += 1;
  }
  if (n === 0) return null;
  return {
    inputTokens: Math.round(sumIn / n),
    outputTokens: Math.round(sumOut / n),
    source: `rata-rata ${n} research_reports terakhir di DB (kolom diagnostics)`,
  };
}

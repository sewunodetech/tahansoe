/**
 * Hitung outcome aktual per aset dalam horizon (spec §3.1/§3.5, ADR 0005 §1).
 *
 * Memakai harga AaveOracle tersimpan + sinyal/metrik tersimpan — BUKAN untuk
 * eksekusi, hanya untuk melabeli penilaian setelah horizonnya lewat.
 */

import type { TransmissionPath } from "../agents/schemas.ts";

/** Outcome mentah yang disimpan agar label bisa dihitung ulang (ADR 0005 §1). */
export interface Outcome {
  asset: string;
  chainId: number;
  windowStart: Date;
  windowEnd: Date;
  /** Drawdown maksimum harga AaveOracle dari puncak dalam jendela (0..1). */
  maxDrawdownPct: number;
  /** Realized volatility 24j (annualized atau sesuai konvensi modul technical). */
  realizedVol?: number;
  /** Peg terendah stablecoin dalam jendela. */
  minStablecoinPeg?: number;
  /** Diskon LST maksimum dalam jendela. */
  maxLstDiscountPct?: number;
  /** Jalur yang outcome buruknya terpicu dalam jendela. */
  triggeredPaths: TransmissionPath[];
  /** True jika ADA outcome buruk apa pun dalam jendela. */
  hadBadOutcome: boolean;
}

/**
 * Hitung Outcome untuk satu aset pada jendela [start, end].
 *
 * TODO(dev):
 *  - Query seri harga AaveOracle tersimpan untuk aset/chain pada jendela.
 *  - Hitung maxDrawdownPct dari puncak; bandingkan dgn BAD_OUTCOME_THRESHOLDS.
 *  - Isi metrik vol/peg/LST/gas/utilization dari tabel sinyal tersimpan.
 *  - Set triggeredPaths & hadBadOutcome.
 *  - Untuk T9/T10 (boolean), cek event insiden/sequencer terkonfirmasi.
 */
export async function computeOutcome(_params: {
  asset: string;
  chainId: number;
  windowStart: Date;
  windowEnd: Date;
}): Promise<Outcome> {
  throw new Error(
    "[engine/reflection/outcomes] computeOutcome belum diimplementasikan — lihat TODO (spec §3.5).",
  );
}

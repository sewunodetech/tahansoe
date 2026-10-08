/**
 * Rumus Health Factor dan drop tolerance (docs/prd.md §4.2, docs/knowledge/risk-transmission.md §5).
 * Modul ini murni fungsional dan deterministik tanpa I/O.
 */

export interface TriggerBand {
  min: number;
  max: number;
}

/**
 * Menghitung Health Factor minimum yang dibutuhkan posisi agar selamat dari penurunan harga collateral d.
 * Rumus (docs/prd.md §4.2):
 *   HF_required = 1 / (1 - d)
 *
 * Contoh:
 *   d = 0.25 (penurunan 25%) -> HF = 1 / (1 - 0.25) = 1.3333333333333333 (~1.33)
 *   d = 0.15 (penurunan 15%) -> HF = 1 / (1 - 0.15) ≈ 1.18
 *   d = 0.30 (penurunan 30%) -> HF = 1 / (1 - 0.30) ≈ 1.43
 *   d = 0.40 (penurunan 40%) -> HF = 1 / (1 - 0.40) ≈ 1.67
 *
 * @param d Estimasi drawdown, harus berupa angka terhingga dalam interval [0, 1)
 * @returns Health Factor minimum yang dibutuhkan
 */
export function hfRequired(d: number): number {
  if (typeof d !== "number" || !Number.isFinite(d)) {
    throw new TypeError(`Drawdown d must be a finite number, received: ${d}`);
  }
  if (d < 0 || d >= 1) {
    throw new RangeError(`Drawdown d must be in range [0, 1), received: ${d}`);
  }
  return 1 / (1 - d);
}

/**
 * Menghitung persentase penurunan harga collateral yang dapat ditahan posisi sebelum HF mencapai 1.0.
 * Rumus (docs/knowledge/risk-transmission.md §5):
 *   dropTolerance = 1 - 1 / HF
 *
 * Contoh:
 *   hf = 1.25 -> drop tolerance = 0.20 (~20%)
 *   hf = 1.30 -> drop tolerance ≈ 0.23 (~23%)
 *   hf = 1.3333333333333333 -> drop tolerance ≈ 0.25 (~25%)
 *   hf = 1.50 -> drop tolerance ≈ 0.33 (~33%)
 *   hf = 1.60 -> drop tolerance = 0.375 (~37.5%)
 *   hf = 2.00 -> drop tolerance = 0.50 (~50%)
 *
 * @param hf Health Factor posisi saat ini, harus berupa angka terhingga > 0
 * @returns Fraksi penurunan yang bisa ditoleransi (0..1)
 */
export function dropTolerance(hf: number): number {
  if (typeof hf !== "number" || !Number.isFinite(hf)) {
    throw new TypeError(`Health factor hf must be a finite number, received: ${hf}`);
  }
  if (hf <= 0) {
    throw new RangeError(`Health factor hf must be > 0, received: ${hf}`);
  }
  return 1 - 1 / hf;
}

/**
 * Membatasi trigger HF rekomendasi AI ke dalam risk band yang disetujui user (docs/prd.md §6.3, §7.3).
 *
 * Invariant: Trigger dinamis tidak pernah melebihi band.max atau di bawah band.min.
 * Default band user baru (docs/prd.md §7.3): min = 1.25, max = 1.60.
 *
 * @param trigger Nilai trigger HF yang direkomendasikan
 * @param band Rentang band { min, max } yang ditentukan user
 * @returns Nilai trigger setelah di-clamp ke [min, max]
 */
export function clampTrigger(
  trigger: number,
  band: TriggerBand
): number {
  if (typeof trigger !== "number" || !Number.isFinite(trigger)) {
    throw new TypeError(`Trigger must be a finite number, received: ${trigger}`);
  }
  if (
    typeof band.min !== "number" ||
    !Number.isFinite(band.min) ||
    typeof band.max !== "number" ||
    !Number.isFinite(band.max)
  ) {
    throw new TypeError("Band min and max must be finite numbers");
  }
  if (band.min > band.max) {
    throw new RangeError(
      `Band min (${band.min}) cannot be greater than band max (${band.max})`
    );
  }
  return Math.min(Math.max(trigger, band.min), band.max);
}

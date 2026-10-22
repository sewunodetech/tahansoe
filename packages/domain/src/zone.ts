/**
 * Perhitungan Risk Zone untuk posisi peminjaman (docs/prd.md §7.1, apps/web/hooks/useProtection.ts).
 * Murni deterministik tanpa dependensi eksternal.
 */

export type RiskZone = "Critical" | "Warning" | "Watch" | "Safe";

export const RISK_ZONES: readonly RiskZone[] = [
  "Critical",
  "Warning",
  "Watch",
  "Safe",
] as const;

/**
 * Menghitung zona risiko berdasarkan Health Factor posisi dan trigger policy.
 *
 * - Critical: HF <= triggerHf (posisi siap/perlu dilindungi oleh Guardian)
 * - Warning:  triggerHf < HF <= triggerHf + 0.15 (mendekati batas bahaya)
 * - Watch:    triggerHf + 0.15 < HF < 1.6 (perlu dipantau)
 * - Safe:     HF >= 1.6
 */
export function calculateZone(hf: number, triggerHf: number): RiskZone {
  if (hf <= triggerHf) return "Critical";
  if (hf <= triggerHf + 0.15) return "Warning";
  if (hf < 1.6) return "Watch";
  return "Safe";
}

/**
 * Mengembalikan true jika zona memerlukan perhatian atau tindakan segera.
 */
export function isAtRisk(zone: RiskZone): boolean {
  return zone === "Critical" || zone === "Warning";
}

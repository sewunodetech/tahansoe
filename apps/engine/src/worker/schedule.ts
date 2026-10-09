/**
 * Penjadwalan interval research agent (spec m3-research-agents.md §3.2).
 *
 * Aturan:
 *  - CALM -> tiap 2 jam (120 menit)
 *  - ELEVATED, STRESSED, CRISIS -> tiap 1 jam (60 menit)
 *  - Dapat dioverride lewat environment variable:
 *      RESEARCH_INTERVAL_CALM_MIN
 *      RESEARCH_INTERVAL_ALERT_MIN
 *  - Saat budget habis -> tunggu hingga pergantian hari UTC (00:00 UTC)
 */

import type { Regime } from "@tahansoe/domain";

export const DEFAULT_INTERVAL_CALM_MS = 2 * 60 * 60 * 1000; // 120 menit
export const DEFAULT_INTERVAL_ALERT_MS = 1 * 60 * 60 * 1000; // 60 menit
export const DEFAULT_KILL_SWITCH_CHECK_MS = 5 * 60 * 1000; // 5 menit

/**
 * Hitung interval durasi ke jadwal berikutnya berdasarkan regime terakhir.
 */
export function getIntervalMs(
  regime?: Regime | string | null,
  envOverrides: Record<string, string | undefined> = process.env,
): number {
  const isAlert =
    regime === "ELEVATED" || regime === "STRESSED" || regime === "CRISIS";

  if (isAlert) {
    const customAlertMin = envOverrides.RESEARCH_INTERVAL_ALERT_MIN;
    if (customAlertMin) {
      const parsed = parseInt(customAlertMin, 10);
      if (!isNaN(parsed) && parsed > 0) {
        return parsed * 60 * 1000;
      }
    }
    return DEFAULT_INTERVAL_ALERT_MS;
  }

  // Default atau CALM
  const customCalmMin = envOverrides.RESEARCH_INTERVAL_CALM_MIN;
  if (customCalmMin) {
    const parsed = parseInt(customCalmMin, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed * 60 * 1000;
    }
  }
  return DEFAULT_INTERVAL_CALM_MS;
}

/**
 * Hitung sisa milidetik sampai pergantian hari UTC (00:00:00.000 UTC berikutnya).
 * Minimal 1 detik.
 */
export function msUntilNextUtcMidnight(now: Date = new Date()): number {
  const nextMidnight = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
      0,
      0,
      0,
      0,
    ),
  );
  return Math.max(1000, nextMidnight.getTime() - now.getTime());
}

/**
 * Format milidetik menjadi representasi menit yang mudah dibaca (mis. "120m" atau "60m").
 */
export function formatIntervalMinutes(ms: number): string {
  const mins = Math.round(ms / 60000);
  return `${mins}m`;
}

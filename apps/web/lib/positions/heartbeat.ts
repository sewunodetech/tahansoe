/**
 * Freshness of the last position check (spec §3.7, §3.8). Pure, unit tested.
 * A check older than STALE_AFTER_MS, or no check at all, must never read as "being guarded" (I6).
 */

export const STALE_AFTER_MS = 10 * 60_000;

export type HeartbeatState =
  | { kind: "fresh"; ageMs: number }
  | { kind: "stale"; ageMs: number }
  | { kind: "none" };

export function heartbeatState(checkedAt: string | null | undefined, now: number): HeartbeatState {
  if (!checkedAt) return { kind: "none" };
  const at = Date.parse(checkedAt);
  if (!Number.isFinite(at)) return { kind: "none" };
  // Clock skew between the server and this browser can make a fresh check look a little in the future.
  const ageMs = Math.max(0, now - at);
  return ageMs > STALE_AFTER_MS ? { kind: "stale", ageMs } : { kind: "fresh", ageMs };
}

/** "12 s", "4 min", "3 h", "2 d". */
export function formatAge(ageMs: number): string {
  const s = Math.floor(ageMs / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

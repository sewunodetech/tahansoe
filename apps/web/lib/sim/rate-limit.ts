/**
 * Light fixed-window rate limit per client IP for the /api/sim routes. In-memory, so it is per
 * server instance; simnet enforces its own limits as well (spec §3.7).
 */

const windows = new Map<string, { start: number; count: number }>();

export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown";
}

/** True when the request is allowed; `limit` requests per `windowMs` per key. */
export function rateLimit(key: string, limit: number, windowMs = 60_000): boolean {
  const now = Date.now();
  const w = windows.get(key);
  if (!w || now - w.start >= windowMs) {
    windows.set(key, { start: now, count: 1 });
    if (windows.size > 10_000) {
      for (const [k, v] of windows) if (now - v.start >= windowMs) windows.delete(k);
    }
    return true;
  }
  w.count += 1;
  return w.count <= limit;
}

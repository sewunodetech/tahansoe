/**
 * Server-side client for the simnet session API (spec m1-simulation-mode §3.5).
 * SIMNET_API_KEY never leaves the server; route handlers under /api/sim are the only callers.
 * Only import from route handlers (the .server suffix marks it).
 */

/** Canned responses for UI work; never in production, where it would advertise a fork that does not exist. */
export function isSimnetMock(): boolean {
  return process.env.SIMNET_MOCK === "1" && process.env.NODE_ENV !== "production";
}

export function isSimnetConfigured(): boolean {
  return isSimnetMock() || Boolean(process.env.SIMNET_URL && process.env.SIMNET_API_KEY);
}

export interface SimnetResponse<T> {
  status: number;
  body: T;
}

/** Calls simnet and returns status + parsed JSON. Network errors surface as status 503. */
export async function simnetFetch<T>(
  path: string,
  init: { method?: "GET" | "POST" | "DELETE"; body?: unknown; timeoutMs?: number } = {}
): Promise<SimnetResponse<T>> {
  const base = process.env.SIMNET_URL?.replace(/\/$/, "");
  const key = process.env.SIMNET_API_KEY;
  if (!base || !key) return { status: 503, body: { error: "simnet_not_configured" } as T };

  try {
    const res = await fetch(`${base}${path}`, {
      method: init.method ?? "GET",
      headers: {
        "x-simnet-key": key,
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(init.timeoutMs ?? 10_000),
    });
    const body = (await res.json().catch(() => ({}))) as T;
    return { status: res.status, body };
  } catch {
    return { status: 503, body: { error: "simnet_unreachable" } as T };
  }
}

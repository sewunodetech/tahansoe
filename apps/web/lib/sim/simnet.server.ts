/**
 * Server-side client for the simnet session API (spec m1-simulation-mode §3.5).
 * SIMNET_API_KEY never leaves the server; route handlers under /api/sim are the only callers.
 * Only import from route handlers (the .server suffix marks it).
 */

/** Canned responses for UI work; never in production, where it would advertise a fork that does not exist. */
export function isSimnetMock(): boolean {
  return process.env.SIMNET_MOCK === "1" && process.env.NODE_ENV !== "production";
}

/**
 * Public simnet on the engine VPS (Caddy + Let's Encrypt). Used when SIMNET_URL is not set; that
 * simnet runs with SIM_PUBLIC_API=1, so no key is needed. SIMNET_URL + SIMNET_API_KEY still win.
 */
export const PUBLIC_SIMNET_URL = "https://119-28-119-206.sslip.io";

function simnetBase(): string {
  return (process.env.SIMNET_URL || PUBLIC_SIMNET_URL).replace(/\/$/, "");
}

export function isSimnetConfigured(): boolean {
  return isSimnetMock() || Boolean(simnetBase());
}

export interface SimnetResponse<T> {
  status: number;
  body: T;
}

/** Calls simnet and returns status + parsed JSON. Network errors surface as status 503. */
export async function simnetFetch<T>(
  path: string,
  init: { method?: "GET" | "POST" | "DELETE"; body?: unknown; timeoutMs?: number; clientIp?: string } = {}
): Promise<SimnetResponse<T>> {
  const base = simnetBase();
  const key = process.env.SIMNET_API_KEY;

  try {
    const res = await fetch(`${base}${path}`, {
      method: init.method ?? "GET",
      headers: {
        ...(key ? { "x-simnet-key": key } : {}),
        ...(init.clientIp ? { "x-sim-client-ip": init.clientIp } : {}),
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

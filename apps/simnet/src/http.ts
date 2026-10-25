/**
 * HTTP surface:
 * - `/v1/*`: session API, called server-side by the web app with `x-simnet-key`.
 * - `/rpc/:forkId`: public JSON-RPC proxy (allowlisted, rate limited, CORS open).
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { isAddress } from "viem";
import { z } from "zod";
import { LIMITS } from "./config.ts";
import { FAUCET_ASSETS } from "./faucet.ts";
import type { ForkManager } from "./forks.ts";
import { handleRpcBody, MAX_BATCH, RateLimiter, type ProxyContext } from "./proxy.ts";
import type { JsonRpcRequest, JsonRpcResponse } from "./rpc.ts";
import { HttpError, type SessionService } from "./sessions.ts";

export function keysMatch(given: string | undefined, expected: string): boolean {
  if (typeof given !== "string" || given.length === 0) return false;
  // Hash both sides so lengths match and timingSafeEqual leaks nothing about length.
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

const AddressSchema = z.string().refine((a) => isAddress(a), "invalid address (use a checksummed or lowercase 0x address)");

export const CreateSessionBody = z.object({
  address: AddressSchema,
  mode: z.enum(["live", "replay", "stress"]),
  scenario: z.string().min(1).max(64).optional(),
});

export const FaucetBody = z.object({
  asset: z.enum(FAUCET_ASSETS),
  amount: z.number().positive().finite().max(LIMITS.maxUsdc),
});

export const ScenarioBody = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("replay"), scenario: z.string().min(1).max(64) }),
  z.object({ kind: z.literal("crash"), pct: z.union([z.literal(10), z.literal(30), z.literal(50)]) }),
]);

export interface ServerDeps {
  apiKey: string;
  sessions: SessionService;
  forks: ForkManager;
  /** Forwards a JSON-RPC batch to the fork's anvil. */
  forwardToFork(url: string, reqs: JsonRpcRequest[]): Promise<JsonRpcResponse[]>;
  /** Trust `cf-connecting-ip` / `x-forwarded-for` (only behind Cloudflare Tunnel or a reverse proxy). */
  trustProxy?: boolean;
  /** Accept the session API without `x-simnet-key`, with a per-client cap on session creation. */
  publicApi?: boolean;
  log?: (msg: string, extra?: unknown) => void;
  clock?: () => number;
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const payload = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(payload);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > LIMITS.maxBodyBytes) throw new HttpError(413, { error: "body too large" });
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, { error: "invalid JSON" });
  }
}

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) {
    throw new HttpError(400, {
      error: "validation",
      issues: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  return r.data;
}

function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const cf = req.headers["cf-connecting-ip"];
    if (typeof cf === "string" && cf) return cf;
    const xff = req.headers["x-forwarded-for"];
    if (typeof xff === "string" && xff) return xff.split(",")[0]!.trim();
  }
  return req.socket.remoteAddress ?? "unknown";
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
};

/** Public mode: max session creations per client in a sliding window. */
export const PUBLIC_SESSION_LIMIT = { max: 10, windowMs: 10 * 60_000 } as const;

export function createSimnetServer(deps: ServerDeps): Server {
  const limiter = new RateLimiter(LIMITS.rpcRatePerSec, deps.clock);
  const publicSessionLog = new Map<string, number[]>();
  const now = () => (deps.clock ? deps.clock() : Date.now());

  /** True when this client may create another session in public mode. */
  function takePublicSession(client: string): boolean {
    const t = now();
    const recent = (publicSessionLog.get(client) ?? []).filter((at) => t - at < PUBLIC_SESSION_LIMIT.windowMs);
    if (recent.length >= PUBLIC_SESSION_LIMIT.max) {
      publicSessionLog.set(client, recent);
      return false;
    }
    recent.push(t);
    publicSessionLog.set(client, recent);
    return true;
  }
  const log = deps.log ?? (() => {});

  async function handleRpc(req: IncomingMessage, res: ServerResponse, forkId: string) {
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS);
      res.end();
      return;
    }
    if (req.method !== "POST") return send(res, 405, { error: "method not allowed" }, CORS);
    const fork = deps.forks.get(forkId);
    if (!fork) return send(res, 404, { jsonrpc: "2.0", id: null, error: { code: -32001, message: "unknown fork" } }, CORS);
    deps.forks.touch(forkId);

    const body = await readJson(req);
    const cost = Array.isArray(body) ? Math.min(MAX_BATCH, Math.max(1, body.length)) : 1;
    const ip = clientIp(req, deps.trustProxy ?? false);
    if (!limiter.take(`ip:${ip}`, cost) || !limiter.take(`fork:${forkId}`, cost)) {
      return send(res, 429, { jsonrpc: "2.0", id: null, error: { code: -32005, message: "rate limited" } }, { ...CORS, "retry-after": "1" });
    }

    let head: { at: number; block: bigint } | undefined;
    const ctx: ProxyContext = {
      forward: (reqs) => deps.forwardToFork(fork.runtime.url, reqs),
      latestBlock: async () => {
        if (head && Date.now() - head.at < 1_000) return head.block;
        const [r] = await deps.forwardToFork(fork.runtime.url, [{ jsonrpc: "2.0", id: 0, method: "eth_blockNumber", params: [] }]);
        if (!r || typeof r.result !== "string") throw new Error("no block number");
        head = { at: Date.now(), block: BigInt(r.result) };
        return head.block;
      },
      maxLogsRange: LIMITS.maxLogsBlockRange,
    };
    const out = await handleRpcBody(body, ctx);
    if (out === null) {
      res.writeHead(204, CORS);
      res.end();
      return;
    }
    send(res, 200, out, CORS);
  }

  async function handleApi(req: IncomingMessage, res: ServerResponse, parts: string[]) {
    const key = req.headers["x-simnet-key"];
    const authenticated = keysMatch(typeof key === "string" ? key : undefined, deps.apiKey);
    if (!authenticated && !deps.publicApi) {
      return send(res, 401, { error: "unauthorized" });
    }
    const method = req.method ?? "GET";
    const [resource, id, action] = parts;

    if (!authenticated && resource === "sessions" && parts.length === 1 && method === "POST") {
      // The web server forwards the visitor's IP; direct callers fall back to their own address.
      const forwarded = req.headers["x-sim-client-ip"];
      const client = typeof forwarded === "string" && forwarded ? forwarded : clientIp(req, deps.trustProxy ?? false);
      if (!takePublicSession(client)) {
        return send(res, 429, { error: "rate_limited", retryAfterSec: PUBLIC_SESSION_LIMIT.windowMs / 1000 });
      }
    }

    if (resource === "health" && parts.length === 1 && method === "GET") {
      return send(res, 200, { ok: true, forks: deps.forks.counts() });
    }
    if (resource !== "sessions") throw new HttpError(404, { error: "not found" });

    if (id === undefined) {
      if (method !== "POST") throw new HttpError(405, { error: "method not allowed" });
      const body = parse(CreateSessionBody, await readJson(req));
      return send(res, 201, await deps.sessions.create(body));
    }
    if (action === undefined) {
      if (method !== "DELETE") throw new HttpError(405, { error: "method not allowed" });
      return send(res, 200, await deps.sessions.delete(id));
    }
    if (parts.length !== 3) throw new HttpError(404, { error: "not found" });
    if (action === "status" && method === "GET") return send(res, 200, deps.sessions.status(id));
    if (method !== "POST") throw new HttpError(405, { error: "method not allowed" });
    if (action === "faucet") {
      const body = parse(FaucetBody, await readJson(req));
      return send(res, 200, await deps.sessions.faucet(id, body.asset, body.amount));
    }
    if (action === "scenario") {
      const body = parse(ScenarioBody, await readJson(req));
      return send(res, 200, deps.sessions.scenario(id, body));
    }
    if (action === "extend") return send(res, 200, deps.sessions.extend(id));
    throw new HttpError(404, { error: "not found" });
  }

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://simnet.local");
    const parts = url.pathname.split("/").filter(Boolean);
    try {
      if (parts[0] === "rpc" && parts.length === 2) return await handleRpc(req, res, parts[1]!);
      if (parts[0] === "v1") return await handleApi(req, res, parts.slice(1));
      send(res, 404, { error: "not found" });
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, e.body, parts[0] === "rpc" ? CORS : {});
      log(`${req.method} ${url.pathname} failed`, e);
      if (!res.headersSent) send(res, 500, { error: "internal" });
    }
  });
}

/** Default forwarder: POSTs the batch to anvil on 127.0.0.1. */
export async function forwardToAnvil(url: string, reqs: JsonRpcRequest[]): Promise<JsonRpcResponse[]> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(reqs),
    signal: AbortSignal.timeout(30_000),
  });
  const out = (await res.json()) as JsonRpcResponse | JsonRpcResponse[];
  return Array.isArray(out) ? out : [out];
}

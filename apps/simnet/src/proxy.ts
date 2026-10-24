/**
 * Public JSON-RPC proxy (spec §3.7). Forwards only the allowlist below; every other
 * method (anvil_*, evm_*, hardhat_*, debug_*, eth_sendTransaction, …) gets -32601.
 * Batches are filtered per item.
 */

import type { JsonRpcRequest, JsonRpcResponse } from "./rpc.ts";

export const RPC_ALLOWLIST: ReadonlySet<string> = new Set([
  "eth_chainId",
  "eth_blockNumber",
  "eth_call",
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_feeHistory",
  "eth_getBalance",
  "eth_getCode",
  "eth_getStorageAt",
  "eth_getTransactionCount",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "eth_getBlockByNumber",
  "eth_getLogs",
  "eth_sendRawTransaction",
  "net_version",
]);

/** Equal to the per-second rate limit, so one full batch always fits in a fresh bucket. */
export const MAX_BATCH = 30;

type Id = JsonRpcRequest["id"];

const err = (id: Id, code: number, message: string): JsonRpcResponse => ({ jsonrpc: "2.0", id, error: { code, message } });

export interface ProxyContext {
  /** Forwards allowed requests to anvil (as one batch) and returns responses in any order. */
  forward(reqs: JsonRpcRequest[]): Promise<JsonRpcResponse[]>;
  /** Current fork head, used to resolve block tags in eth_getLogs. */
  latestBlock(): Promise<bigint>;
  maxLogsRange: number;
}

function isRequest(x: unknown): x is JsonRpcRequest {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return false;
  const r = x as Record<string, unknown>;
  return (
    r.jsonrpc === "2.0" &&
    typeof r.method === "string" &&
    (r.params === undefined || Array.isArray(r.params)) &&
    (r.id === undefined || r.id === null || typeof r.id === "string" || typeof r.id === "number")
  );
}

async function resolveTag(tag: unknown, latest: () => Promise<bigint>): Promise<bigint> {
  if (tag === undefined || tag === null || tag === "latest" || tag === "pending" || tag === "safe" || tag === "finalized") {
    return latest();
  }
  if (tag === "earliest") return 0n;
  if (typeof tag === "string" && /^0x[0-9a-f]+$/i.test(tag)) return BigInt(tag);
  throw new Error("invalid block tag");
}

/** Returns an error response if the call must not be forwarded, else null. */
export async function vetCall(req: JsonRpcRequest, ctx: ProxyContext): Promise<JsonRpcResponse | null> {
  const id = req.id ?? null;
  if (!RPC_ALLOWLIST.has(req.method)) return err(id, -32601, `method ${req.method} is not available on simnet`);
  if (req.method === "eth_getLogs") {
    const filter = req.params?.[0];
    if (typeof filter !== "object" || filter === null) return err(id, -32602, "eth_getLogs expects a filter object");
    const f = filter as Record<string, unknown>;
    if (f.blockHash !== undefined) return null;
    try {
      const latest = (() => {
        let p: Promise<bigint> | undefined;
        return () => (p ??= ctx.latestBlock());
      })();
      const from = await resolveTag(f.fromBlock, latest);
      const to = await resolveTag(f.toBlock, latest);
      if (to - from > BigInt(ctx.maxLogsRange)) {
        return err(id, -32602, `eth_getLogs range exceeds ${ctx.maxLogsRange} blocks`);
      }
    } catch {
      return err(id, -32602, "invalid eth_getLogs block range");
    }
  }
  return null;
}

/**
 * Handles a parsed JSON-RPC body (single or batch). Returns null for a single
 * notification (no id) so the caller can reply 204.
 */
export async function handleRpcBody(body: unknown, ctx: ProxyContext): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
  const isBatch = Array.isArray(body);
  const items: unknown[] = isBatch ? (body as unknown[]) : [body];
  if (isBatch && items.length === 0) return err(null, -32600, "empty batch");
  if (items.length > MAX_BATCH) return err(null, -32600, `batch larger than ${MAX_BATCH}`);

  const results: (JsonRpcResponse | undefined)[] = new Array(items.length);
  const toForward: { index: number; req: JsonRpcRequest }[] = [];

  await Promise.all(
    items.map(async (item, index) => {
      if (!isRequest(item)) {
        results[index] = err(null, -32600, "invalid request");
        return;
      }
      const rejected = await vetCall(item, ctx);
      if (rejected) results[index] = rejected;
      else toForward.push({ index, req: item });
    }),
  );

  if (toForward.length > 0) {
    // Re-id so caller-chosen ids (possibly duplicated) map back unambiguously.
    const upstream = toForward.map(({ index, req }) => ({ jsonrpc: "2.0" as const, id: index, method: req.method, params: req.params ?? [] }));
    let responses: JsonRpcResponse[];
    try {
      responses = await ctx.forward(upstream);
    } catch {
      responses = [];
    }
    const byIndex = new Map(responses.map((r) => [r.id, r]));
    for (const { index, req } of toForward) {
      const r = byIndex.get(index);
      results[index] = r
        ? { ...r, id: req.id ?? null }
        : err(req.id ?? null, -32603, "fork unavailable");
    }
  }

  if (!isBatch) {
    const only = items[0];
    if (isRequest(only) && only.id === undefined) return null;
    return results[0]!;
  }
  // Drop notifications (requests without id) from batch replies, per JSON-RPC 2.0.
  return results.filter((r, i): r is JsonRpcResponse => r !== undefined && !(isRequest(items[i]) && (items[i] as JsonRpcRequest).id === undefined));
}

/** Fixed-window-per-second token bucket keyed by IP or fork. */
export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();

  constructor(
    private readonly ratePerSec: number,
    private readonly clock: () => number = Date.now,
  ) {}

  /** Takes `cost` tokens from `key`; false if the bucket is empty. */
  take(key: string, cost = 1): boolean {
    const now = this.clock();
    const b = this.buckets.get(key) ?? { tokens: this.ratePerSec, at: now };
    b.tokens = Math.min(this.ratePerSec, b.tokens + ((now - b.at) / 1000) * this.ratePerSec);
    b.at = now;
    if (b.tokens < cost) {
      this.buckets.set(key, b);
      return false;
    }
    b.tokens -= cost;
    this.buckets.set(key, b);
    if (this.buckets.size > 10_000) this.prune(now);
    return true;
  }

  private prune(now: number) {
    for (const [k, b] of this.buckets) if (now - b.at > 60_000) this.buckets.delete(k);
  }
}

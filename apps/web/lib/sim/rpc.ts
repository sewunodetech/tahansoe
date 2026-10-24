/**
 * Browser JSON-RPC transport to the simnet proxy. Each session lives on its own fork path
 * (`rpcPath` from the session API), so the URL is resolved per request instead of being fixed
 * in the wagmi config. The proxy only forwards an allowlist of eth_* methods (spec §3.7).
 */

import { custom, RpcRequestError } from "viem";
import { SIM_RPC_BASE } from "./chain";

const RPC_PATH_STORAGE = "tahansoe:sim-rpc-path";

let rpcPath: string | null = null;

export function setSimRpcPath(path: string | null): void {
  rpcPath = path;
  try {
    if (path) localStorage.setItem(RPC_PATH_STORAGE, path);
    else localStorage.removeItem(RPC_PATH_STORAGE);
  } catch { /* storage blocked — kept in memory only */ }
}

export function getSimRpcPath(): string | null {
  if (rpcPath) return rpcPath;
  try {
    rpcPath = localStorage.getItem(RPC_PATH_STORAGE);
  } catch { /* storage blocked */ }
  return rpcPath;
}

export function getSimRpcUrl(): string | null {
  const path = getSimRpcPath();
  if (!path || !SIM_RPC_BASE) return null;
  return `${SIM_RPC_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

let nextId = 1;

/** Sends one JSON-RPC request to the current session's fork. */
export async function simRpcRequest(method: string, params?: unknown): Promise<unknown> {
  const url = getSimRpcUrl();
  if (!url) throw new Error("Simulation RPC is not configured (no active simulation session).");
  const id = nextId++;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params: params ?? [] }),
  });
  const body = (await res.json().catch(() => null)) as
    | { result?: unknown; error?: { code: number; message: string; data?: unknown } }
    | null;
  if (!body) throw new Error(`Simulation RPC returned HTTP ${res.status}`);
  if (body.error) throw new RpcRequestError({ body: { method, params }, error: body.error, url });
  return body.result;
}

/** viem/wagmi transport for the simulation chain. */
export const simTransport = custom({ request: ({ method, params }) => simRpcRequest(method, params) });

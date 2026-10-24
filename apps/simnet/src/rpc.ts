/**
 * Minimal JSON-RPC client for talking to a local anvil, including cheat methods
 * (`anvil_*`). Only simnet internals use this; the public proxy never exposes them.
 */

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string | null;
  method: string;
  params?: unknown[];
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: JsonRpcError;
}

export class RpcError extends Error {
  constructor(
    readonly method: string,
    readonly rpcError: JsonRpcError,
  ) {
    super(`${method}: ${rpcError.message} (${rpcError.code})`);
  }
}

export type RpcCall = <T = unknown>(method: string, params?: unknown[]) => Promise<T>;

let nextId = 1;

export function createRpc(url: string, timeoutMs = 30_000): RpcCall {
  return async <T>(method: string, params: unknown[] = []) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
    const body = (await res.json()) as JsonRpcResponse;
    if (body.error) throw new RpcError(method, body.error);
    return body.result as T;
  };
}

export const toHex = (v: bigint | number): `0x${string}` => `0x${BigInt(v).toString(16)}`;

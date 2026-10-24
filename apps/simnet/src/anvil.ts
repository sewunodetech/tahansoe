/**
 * Spawns and stops anvil processes. anvil always binds 127.0.0.1: the only public
 * path into a fork is the allowlisted RPC proxy (spec §3.7).
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { createRpc } from "./rpc.ts";

export interface AnvilOptions {
  bin: string;
  forkUrl: string;
  chainId: number;
  /** Optional fixed block; default = latest. */
  forkBlockNumber?: bigint;
  readyTimeoutMs?: number;
}

export interface AnvilHandle {
  port: number;
  url: string;
  pid: number | undefined;
  stop(): Promise<void>;
}

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr === null || typeof addr === "string") {
        srv.close();
        reject(new Error("could not allocate a port"));
        return;
      }
      const { port } = addr;
      srv.close(() => resolve(port));
    });
  });
}

const live = new Set<ChildProcess>();

/** Kills every anvil this process started. Wired to process exit in main.ts. */
export function killAllAnvils(): void {
  for (const child of live) {
    try {
      child.kill("SIGKILL");
    } catch {
      // already gone
    }
  }
  live.clear();
}

export async function startAnvil(opts: AnvilOptions): Promise<AnvilHandle> {
  const port = await freePort();
  const args = [
    "--fork-url", opts.forkUrl,
    "--chain-id", String(opts.chainId),
    "--host", "127.0.0.1",
    "--port", String(port),
    "--silent",
  ];
  if (opts.forkBlockNumber !== undefined) args.push("--fork-block-number", opts.forkBlockNumber.toString());

  const child = spawn(opts.bin, args, { stdio: ["ignore", "ignore", "pipe"] });
  live.add(child);
  let stderr = "";
  child.stderr?.on("data", (d: Buffer) => {
    stderr = (stderr + d.toString()).slice(-4_000);
  });
  let exited = false;
  child.on("exit", () => {
    exited = true;
    live.delete(child);
  });

  const url = `http://127.0.0.1:${port}`;
  const stop = async () => {
    if (exited) return;
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 3_000);
      child.once("exit", () => {
        clearTimeout(t);
        resolve();
      });
      child.kill("SIGTERM");
    });
  };

  const spawnError = new Promise<never>((_, reject) => {
    child.once("error", (e) => reject(new Error(`failed to start anvil (${opts.bin}): ${e.message}`)));
  });

  const rpc = createRpc(url, 2_000);
  const deadline = Date.now() + (opts.readyTimeoutMs ?? 60_000);
  const waitReady = (async () => {
    while (Date.now() < deadline) {
      if (exited) throw new Error(`anvil exited during startup: ${stderr.trim() || "no output"}`);
      try {
        const id = await rpc<string>("eth_chainId");
        if (BigInt(id) === BigInt(opts.chainId)) return;
      } catch {
        // not listening yet
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error("anvil did not become ready in time");
  })();

  try {
    await Promise.race([waitReady, spawnError]);
  } catch (e) {
    await stop();
    throw e;
  }
  return { port, url, pid: child.pid, stop };
}

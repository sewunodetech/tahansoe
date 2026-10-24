import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleRpcBody, MAX_BATCH, RateLimiter, RPC_ALLOWLIST, type ProxyContext } from "../src/proxy.ts";
import type { JsonRpcRequest, JsonRpcResponse } from "../src/rpc.ts";

function ctx(latest = 1_000_000n) {
  const forwarded: JsonRpcRequest[][] = [];
  const c: ProxyContext = {
    forward: async (reqs) => {
      forwarded.push(reqs);
      return reqs.map((r) => ({ jsonrpc: "2.0" as const, id: r.id, result: `ok:${r.method}` }));
    },
    latestBlock: async () => latest,
    maxLogsRange: 10_000,
  };
  return { c, forwarded };
}

const req = (method: string, id: number | string | null = 1, params: unknown[] = []) => ({ jsonrpc: "2.0", id, method, params });

describe("rpc proxy allowlist", () => {
  it("forwards allowlisted methods", async () => {
    const { c, forwarded } = ctx();
    for (const m of RPC_ALLOWLIST) {
      if (m === "eth_getLogs") continue;
      const out = (await handleRpcBody(req(m, 7), c)) as JsonRpcResponse;
      assert.equal(out.result, `ok:${m}`);
      assert.equal(out.id, 7);
    }
    assert.equal(forwarded.length, RPC_ALLOWLIST.size - 1);
  });

  it("rejects cheat and signing methods with -32601 without forwarding", async () => {
    const { c, forwarded } = ctx();
    for (const m of [
      "anvil_setBalance",
      "anvil_impersonateAccount",
      "evm_mine",
      "evm_increaseTime",
      "hardhat_setBalance",
      "debug_traceTransaction",
      "eth_sendTransaction",
      "eth_sign",
      "personal_sign",
      "eth_accounts",
    ]) {
      const out = (await handleRpcBody(req(m), c)) as JsonRpcResponse;
      assert.equal(out.error?.code, -32601, m);
    }
    assert.equal(forwarded.length, 0);
  });

  it("applies the allowlist per batch item and keeps order and ids", async () => {
    const { c, forwarded } = ctx();
    const out = (await handleRpcBody(
      [req("eth_chainId", "a"), req("anvil_setBalance", "b"), req("eth_blockNumber", "a"), { nope: true }],
      c,
    )) as JsonRpcResponse[];
    assert.equal(out.length, 4);
    assert.deepEqual(out[0], { jsonrpc: "2.0", id: "a", result: "ok:eth_chainId" });
    assert.equal(out[1]!.error?.code, -32601);
    assert.equal(out[1]!.id, "b");
    assert.deepEqual(out[2], { jsonrpc: "2.0", id: "a", result: "ok:eth_blockNumber" });
    assert.equal(out[3]!.error?.code, -32600);
    // Only the two allowed items reached anvil, in one upstream batch.
    assert.equal(forwarded.length, 1);
    assert.deepEqual(forwarded[0]!.map((r) => r.method), ["eth_chainId", "eth_blockNumber"]);
  });

  it("rejects empty and oversized batches", async () => {
    const { c } = ctx();
    assert.equal(((await handleRpcBody([], c)) as JsonRpcResponse).error?.code, -32600);
    const big = Array.from({ length: MAX_BATCH + 1 }, (_, i) => req("eth_chainId", i));
    assert.equal(((await handleRpcBody(big, c)) as JsonRpcResponse).error?.code, -32600);
  });

  it("returns null for a single notification and drops notifications from batches", async () => {
    const { c } = ctx();
    assert.equal(await handleRpcBody({ jsonrpc: "2.0", method: "eth_chainId" }, c), null);
    const out = (await handleRpcBody([{ jsonrpc: "2.0", method: "eth_chainId" }, req("eth_chainId", 2)], c)) as JsonRpcResponse[];
    assert.equal(out.length, 1);
    assert.equal(out[0]!.id, 2);
  });

  it("rejects malformed requests", async () => {
    const { c } = ctx();
    for (const bad of [null, 5, "x", { jsonrpc: "1.0", id: 1, method: "eth_chainId" }, { jsonrpc: "2.0", id: 1, method: "eth_call", params: {} }]) {
      assert.equal(((await handleRpcBody(bad, c)) as JsonRpcResponse).error?.code, -32600);
    }
  });

  it("maps a dead upstream to -32603", async () => {
    const c: ProxyContext = { forward: async () => { throw new Error("down"); }, latestBlock: async () => 0n, maxLogsRange: 10_000 };
    assert.equal(((await handleRpcBody(req("eth_chainId"), c)) as JsonRpcResponse).error?.code, -32603);
  });
});

describe("eth_getLogs range", () => {
  const logs = (filter: unknown) => req("eth_getLogs", 1, [filter]);

  it("allows ranges up to 10,000 blocks", async () => {
    const { c } = ctx();
    const out = (await handleRpcBody(logs({ fromBlock: "0x0", toBlock: "0x2710" }), c)) as JsonRpcResponse;
    assert.equal(out.result, "ok:eth_getLogs");
  });

  it("rejects ranges over 10,000 blocks", async () => {
    const { c, forwarded } = ctx();
    const out = (await handleRpcBody(logs({ fromBlock: "0x0", toBlock: "0x2711" }), c)) as JsonRpcResponse;
    assert.equal(out.error?.code, -32602);
    assert.equal(forwarded.length, 0);
  });

  it("resolves tags against the fork head", async () => {
    const { c } = ctx(1_000_000n);
    const near = (await handleRpcBody(logs({ fromBlock: `0x${(1_000_000 - 100).toString(16)}` }), c)) as JsonRpcResponse;
    assert.equal(near.result, "ok:eth_getLogs");
    const earliest = (await handleRpcBody(logs({ fromBlock: "earliest", toBlock: "latest" }), c)) as JsonRpcResponse;
    assert.equal(earliest.error?.code, -32602);
    const none = (await handleRpcBody(logs({}), c)) as JsonRpcResponse;
    assert.equal(none.result, "ok:eth_getLogs");
  });

  it("allows blockHash filters and rejects garbage", async () => {
    const { c } = ctx();
    assert.equal(((await handleRpcBody(logs({ blockHash: "0xabc" }), c)) as JsonRpcResponse).result, "ok:eth_getLogs");
    assert.equal(((await handleRpcBody(logs({ fromBlock: "yesterday" }), c)) as JsonRpcResponse).error?.code, -32602);
    assert.equal(((await handleRpcBody(req("eth_getLogs", 1, []), c)) as JsonRpcResponse).error?.code, -32602);
  });
});

describe("RateLimiter", () => {
  it("allows 30 per second per key and refills over time", () => {
    let now = 0;
    const rl = new RateLimiter(30, () => now);
    for (let i = 0; i < 30; i++) assert.equal(rl.take("ip:1"), true);
    assert.equal(rl.take("ip:1"), false);
    assert.equal(rl.take("ip:2"), true, "keys are independent");
    now += 500;
    for (let i = 0; i < 15; i++) assert.equal(rl.take("ip:1"), true);
    assert.equal(rl.take("ip:1"), false);
  });

  it("charges batch cost", () => {
    const rl = new RateLimiter(30, () => 0);
    assert.equal(rl.take("fork:a", 25), true);
    assert.equal(rl.take("fork:a", 6), false);
    assert.equal(rl.take("fork:a", 5), true);
  });
});

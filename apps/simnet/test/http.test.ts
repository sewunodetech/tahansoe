import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { getAddress } from "viem";
import { ForkManager } from "../src/forks.ts";
import { createSimnetServer, keysMatch } from "../src/http.ts";
import type { JsonRpcRequest } from "../src/rpc.ts";
import { loadScenarios } from "../src/scenario.ts";
import { SessionService } from "../src/sessions.ts";
import { recordKeeperChecked } from "../src/keeper.ts";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fakeRuntime, GUARDIAN } from "./helpers.ts";

const KEY = "test-key-0123456789abcdef";
const USER = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
const scenarios = loadScenarios(join(dirname(fileURLToPath(import.meta.url)), "../scenarios"), undefined, true);

describe("keysMatch", () => {
  it("compares in constant time and handles length mismatch", () => {
    assert.equal(keysMatch(KEY, KEY), true);
    assert.equal(keysMatch(KEY + "x", KEY), false);
    assert.equal(keysMatch("short", KEY), false);
    assert.equal(keysMatch("", KEY), false);
    assert.equal(keysMatch(undefined, KEY), false);
  });
});

describe("simnet HTTP API", () => {
  let base = "";
  let close: () => Promise<void>;
  const forwarded: JsonRpcRequest[][] = [];

  before(async () => {
    let sessions: SessionService | undefined;
    const forks = new ForkManager(async () => fakeRuntime(), {
      maxPrivate: 1,
      ttlMs: 15 * 60_000,
      onForkGone: (id) => sessions?.forkGone(id),
    });
    sessions = new SessionService(forks, scenarios, 4216199);
    const server = createSimnetServer({
      apiKey: KEY,
      sessions,
      forks,
      forwardToFork: async (_url, reqs) => {
        forwarded.push(reqs);
        return reqs.map((r) => ({ jsonrpc: "2.0" as const, id: r.id, result: r.method === "eth_chainId" ? "0x40553f" : "0x10" }));
      },
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => new Promise((r) => server.close(() => r()));
  });
  after(() => close());

  const api = (path: string, init: { method?: string; body?: unknown; key?: string | null } = {}) =>
    fetch(base + path, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: {
        "content-type": "application/json",
        ...(init.key === null ? {} : { "x-simnet-key": init.key ?? KEY }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });

  it("requires x-simnet-key on /v1", async () => {
    assert.equal((await api("/v1/health", { key: null })).status, 401);
    assert.equal((await api("/v1/health", { key: "wrong-key-wrong-key" })).status, 401);
    const ok = await api("/v1/health");
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { ok: true, forks: { live: false, private: 0, max: 1 } });
  });

  it("validates bodies with Zod", async () => {
    const bad = await api("/v1/sessions", { body: { address: "0x123", mode: "live" } });
    assert.equal(bad.status, 400);
    assert.equal(((await bad.json()) as { error: string }).error, "validation");
    assert.equal((await api("/v1/sessions", { body: { address: USER, mode: "turbo" } })).status, 400);
    assert.equal((await api("/v1/sessions", { body: { address: USER, mode: "live", scenario: "_test" } })).status, 400);
    assert.equal((await api("/v1/sessions", { body: { address: USER, mode: "replay", scenario: "nope" } })).status, 400);
  });

  it("creates a live session, funds it, and reports status", async () => {
    const res = await api("/v1/sessions", { body: { address: USER, mode: "live" } });
    assert.equal(res.status, 201);
    const s = (await res.json()) as Record<string, any>;
    assert.match(s.forkId, /^live-/);
    assert.equal(s.rpcPath, `/rpc/${s.forkId}`);
    assert.equal(s.chainId, 4216199);
    assert.equal(s.expiresAt, null);
    assert.equal(s.contracts.guardian, GUARDIAN);
    assert.ok(s.contracts.pool && s.contracts.weth && s.contracts.usdc);

    const fau = await api(`/v1/sessions/${s.sessionId}/faucet`, { body: { asset: "USDC", amount: 1000 } });
    assert.equal(fau.status, 200);
    assert.deepEqual(((await fau.json()) as any).balances, { ETH: "10", WETH: "0", USDC: "6000" });

    const over = await api(`/v1/sessions/${s.sessionId}/faucet`, { body: { asset: "ETH", amount: 91 } });
    assert.equal(over.status, 429);
    assert.deepEqual(await over.json(), { error: "faucet_limit", asset: "ETH", remaining: 90 });

    const st = (await (await api(`/v1/sessions/${s.sessionId}/status`)).json()) as Record<string, any>;
    assert.equal(st.mode, "live");
    assert.equal(st.priceSource, "mainnet");
    assert.equal(st.price, 2000);
    assert.deepEqual(st.events, []);
    assert.equal(st.keeperCheckedAt, null);
    recordKeeperChecked("http://127.0.0.1:1", 1729780000000);
    const stChecked = (await (await api(`/v1/sessions/${s.sessionId}/status`)).json()) as Record<string, any>;
    assert.equal(stChecked.keeperCheckedAt, "2024-10-24T14:26:40.000Z");

    // Scenarios are refused on the shared fork.
    assert.equal((await api(`/v1/sessions/${s.sessionId}/scenario`, { body: { kind: "crash", pct: 30 } })).status, 409);
    assert.equal((await api(`/v1/sessions/${s.sessionId}`, { method: "DELETE" })).status, 200);
    assert.equal((await api(`/v1/sessions/${s.sessionId}/status`)).status, 404);
  });

  it("runs stress sessions on a private fork and returns 409 capacity when full", async () => {
    const res = await api("/v1/sessions", { body: { address: USER, mode: "stress" } });
    assert.equal(res.status, 201);
    const s = (await res.json()) as Record<string, any>;
    assert.match(s.forkId, /^p-/);
    assert.ok(Date.parse(s.expiresAt) > Date.now());

    const full = await api("/v1/sessions", { body: { address: USER, mode: "replay", scenario: "_test" } });
    assert.equal(full.status, 409);
    const body = (await full.json()) as { error: string; retryAfterSec: number };
    assert.equal(body.error, "capacity");
    assert.ok(body.retryAfterSec > 0);

    assert.equal((await api(`/v1/sessions/${s.sessionId}/scenario`, { body: { kind: "crash", pct: 20 } })).status, 400);
    assert.equal((await api(`/v1/sessions/${s.sessionId}/scenario`, { body: { kind: "crash", pct: 30 } })).status, 200);
    const st = (await (await api(`/v1/sessions/${s.sessionId}/status`)).json()) as Record<string, any>;
    assert.equal(st.priceSource, "stress");
    assert.equal(st.scenarioProgress, 0);

    assert.equal((await api(`/v1/sessions/${s.sessionId}/extend`, { body: {} })).status, 200);
    assert.equal((await api(`/v1/sessions/${s.sessionId}/extend`, { body: {} })).status, 409);

    // Deleting frees the private slot.
    await api(`/v1/sessions/${s.sessionId}`, { method: "DELETE" });
    const again = await api("/v1/sessions", { body: { address: getAddress(USER), mode: "replay", scenario: "_test" } });
    assert.equal(again.status, 201);
    const s2 = (await again.json()) as Record<string, any>;
    const st2 = (await (await api(`/v1/sessions/${s2.sessionId}/status`)).json()) as Record<string, any>;
    assert.equal(st2.priceSource, "replay");
    await api(`/v1/sessions/${s2.sessionId}`, { method: "DELETE" });
  });

  it("proxies allowlisted RPC without a key and blocks cheat methods", async () => {
    const s = (await (await api("/v1/sessions", { body: { address: USER, mode: "live" } })).json()) as Record<string, any>;
    const rpc = (body: unknown) =>
      fetch(base + s.rpcPath, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

    const ok = await rpc({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("access-control-allow-origin"), "*");
    assert.deepEqual(await ok.json(), { jsonrpc: "2.0", id: 1, result: "0x40553f" });

    const before = forwarded.length;
    const cheat = (await (await rpc({ jsonrpc: "2.0", id: 2, method: "anvil_setBalance", params: [USER, "0xffff"] })).json()) as any;
    assert.equal(cheat.error.code, -32601);
    assert.equal(forwarded.length, before, "cheat method never reaches anvil");

    const batch = (await (await rpc([
      { jsonrpc: "2.0", id: 1, method: "eth_blockNumber" },
      { jsonrpc: "2.0", id: 2, method: "evm_mine" },
    ])).json()) as any[];
    assert.equal(batch[0].result, "0x10");
    assert.equal(batch[1].error.code, -32601);

    assert.equal((await fetch(base + "/rpc/unknown", { method: "POST", body: "{}" })).status, 404);
    const pre = await fetch(base + s.rpcPath, { method: "OPTIONS" });
    assert.equal(pre.status, 204);
  });

  it("rate limits RPC at 30 req/s", async () => {
    const live = (await (await api("/v1/sessions", { body: { address: USER, mode: "live" } })).json()) as Record<string, any>;
    const batch = Array.from({ length: 30 }, (_, i) => ({ jsonrpc: "2.0", id: i, method: "eth_chainId" }));
    const post = () => fetch(base + live.rpcPath, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(batch) });
    // Earlier tests may have used some tokens; two full batches back to back must trip the limit.
    const a = await post();
    const b = await post();
    assert.ok([a.status, b.status].includes(429));
  });

  it("returns 404 for unknown routes and 413 for huge bodies", async () => {
    assert.equal((await api("/v1/nope")).status, 404);
    assert.equal((await fetch(base + "/")).status, 404);
    const huge = await api("/v1/sessions", { body: { address: USER, mode: "live", pad: "x".repeat(300_000) } });
    assert.equal(huge.status, 413);
  });
});

describe("simnet HTTP API, public mode (SIM_PUBLIC_API=1)", () => {
  let base = "";
  let close: () => Promise<void>;
  let t = 1_000_000;

  before(async () => {
    let sessions: SessionService | undefined;
    const forks = new ForkManager(async () => fakeRuntime(), {
      maxPrivate: 1,
      ttlMs: 15 * 60_000,
      onForkGone: (id) => sessions?.forkGone(id),
    });
    sessions = new SessionService(forks, scenarios, 4216199);
    const server = createSimnetServer({
      apiKey: KEY,
      sessions,
      forks,
      publicApi: true,
      clock: () => t,
      forwardToFork: async (_url, reqs) => reqs.map((r) => ({ jsonrpc: "2.0" as const, id: r.id, result: "0x10" })),
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => new Promise((r) => server.close(() => r()));
  });
  after(() => close());

  const post = (client: string) =>
    fetch(base + "/v1/sessions", {
      method: "POST",
      headers: { "content-type": "application/json", "x-sim-client-ip": client },
      body: JSON.stringify({ address: USER, mode: "live" }),
    });

  it("accepts the session API without a key", async () => {
    const res = await fetch(base + "/v1/health");
    assert.equal(res.status, 200);
  });

  it("caps session creation per client and frees the cap after the window", async () => {
    const { PUBLIC_SESSION_LIMIT } = await import("../src/http.ts");
    for (let i = 0; i < PUBLIC_SESSION_LIMIT.max; i++) {
      assert.notEqual((await post("198.51.100.7")).status, 429);
    }
    assert.equal((await post("198.51.100.7")).status, 429);
    assert.notEqual((await post("198.51.100.8")).status, 429, "other visitors are not affected");
    t += PUBLIC_SESSION_LIMIT.windowMs + 1;
    assert.notEqual((await post("198.51.100.7")).status, 429);
  });
});

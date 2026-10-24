import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CapacityError, ExtendError, ForkManager, msUntilNextDailyReset, type ForkRuntime } from "../src/forks.ts";
import { fakeRuntime } from "./helpers.ts";

function manager(maxPrivate = 2, ttlMs = 15 * 60_000) {
  let now = 1_000_000;
  const stopped: string[] = [];
  const gone: string[] = [];
  const started: string[] = [];
  const fm = new ForkManager(
    async (id): Promise<ForkRuntime> => {
      started.push(id);
      return fakeRuntime({ onStop: () => stopped.push(id) });
    },
    { maxPrivate, ttlMs, clock: () => now, onForkGone: (id) => gone.push(id) },
  );
  return { fm, stopped, gone, started, advance: (ms: number) => (now += ms) };
}

describe("ForkManager capacity", () => {
  it("never exceeds SIM_MAX_PRIVATE_FORKS, including forks still starting", async () => {
    const { fm } = manager(2);
    const results = await Promise.allSettled([fm.acquirePrivate(), fm.acquirePrivate(), fm.acquirePrivate()]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 2);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    assert.ok(rejected.reason instanceof CapacityError);
    assert.deepEqual(fm.counts(), { live: false, private: 2, max: 2 });
  });

  it("reports retryAfterSec until the soonest expiry", async () => {
    const { fm, advance } = manager(1, 60_000);
    await fm.acquirePrivate();
    advance(15_000);
    await assert.rejects(fm.acquirePrivate(), (e: unknown) => e instanceof CapacityError && e.retryAfterSec === 45);
  });

  it("frees a slot on release", async () => {
    const { fm, gone } = manager(1);
    const rec = await fm.acquirePrivate();
    await fm.release(rec.id);
    assert.deepEqual(gone, [rec.id]);
    await fm.acquirePrivate();
  });

  it("frees the reserved slot when a fork fails to start", async () => {
    let fail = true;
    const fm = new ForkManager(
      async () => {
        if (fail) throw new Error("anvil missing");
        return fakeRuntime();
      },
      { maxPrivate: 1, ttlMs: 1000 },
    );
    await assert.rejects(fm.acquirePrivate(), /anvil missing/);
    assert.equal(fm.counts().private, 0);
    fail = false;
    await fm.acquirePrivate();
  });
});

describe("ForkManager TTL", () => {
  it("kills private forks after TTL", async () => {
    const { fm, stopped, gone, advance } = manager(2, 15 * 60_000);
    const a = await fm.acquirePrivate();
    advance(5 * 60_000);
    const b = await fm.acquirePrivate();
    advance(10 * 60_000 - 1);
    assert.deepEqual(await fm.sweep(), []);
    advance(1);
    assert.deepEqual(await fm.sweep(), [a.id]);
    assert.deepEqual(stopped, [a.id]);
    assert.deepEqual(gone, [a.id]);
    assert.ok(fm.get(b.id));
    assert.equal(fm.get(a.id), undefined);
  });

  it("extends once by one TTL", async () => {
    const { fm, advance } = manager(1, 15 * 60_000);
    const rec = await fm.acquirePrivate();
    const original = rec.expiresAt!;
    assert.equal(fm.extend(rec.id), original + 15 * 60_000);
    assert.throws(() => fm.extend(rec.id), ExtendError);
    advance(29 * 60_000);
    assert.deepEqual(await fm.sweep(), []);
    advance(60_000);
    assert.deepEqual(await fm.sweep(), [rec.id]);
  });

  it("does not expire or extend the live fork", async () => {
    const { fm, advance } = manager();
    const live = await fm.live();
    assert.equal(live.expiresAt, null);
    assert.throws(() => fm.extend(live.id), ExtendError);
    advance(365 * 24 * 3600_000);
    await fm.sweep();
    assert.equal(fm.get(live.id), live);
  });

  it("stopAll kills everything", async () => {
    const { fm, stopped } = manager(2);
    const live = await fm.live();
    const p = await fm.acquirePrivate();
    await fm.stopAll();
    assert.deepEqual(stopped.sort(), [live.id, p.id].sort());
    assert.deepEqual(fm.counts(), { live: false, private: 0, max: 2 });
  });
});

describe("live fork", () => {
  it("shares one start between concurrent callers", async () => {
    const { fm, started } = manager();
    const [a, b] = await Promise.all([fm.live(), fm.live()]);
    assert.equal(a, b);
    assert.equal(started.length, 1);
  });

  it("reset replaces the live fork with a new id", async () => {
    const { fm, gone } = manager();
    const a = await fm.live();
    const b = await fm.resetLive();
    assert.notEqual(a.id, b.id);
    assert.deepEqual(gone, [a.id]);
    assert.equal(fm.get(a.id), undefined);
  });

  it("schedules the daily reset at 04:00 Asia/Jakarta (21:00 UTC)", () => {
    const at = (iso: string) => Date.parse(iso);
    assert.equal(msUntilNextDailyReset(at("2026-10-24T20:00:00Z"), 21), 3600_000);
    // 03:59 WIB = 20:59 UTC → one minute.
    assert.equal(msUntilNextDailyReset(at("2026-10-24T20:59:00Z"), 21), 60_000);
    // Exactly at reset → next day.
    assert.equal(msUntilNextDailyReset(at("2026-10-24T21:00:00Z"), 21), 24 * 3600_000);
    assert.equal(msUntilNextDailyReset(at("2026-10-24T22:00:00Z"), 21), 23 * 3600_000);
  });
});

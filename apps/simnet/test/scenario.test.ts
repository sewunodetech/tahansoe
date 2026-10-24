import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { LIMITS } from "../src/config.ts";
import { PriceController } from "../src/price-controller.ts";
import { crashPriceAt, loadScenarios, parseScenario, replayDurationMs, replayPriceAt } from "../src/scenario.ts";

const scenariosDir = join(dirname(fileURLToPath(import.meta.url)), "../scenarios");
const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

function testScenario() {
  const s = loadScenarios(scenariosDir, (f, e) => assert.fail(`${f}: ${String(e)}`), true).get("_test");
  assert.ok(s, "_test.json must load");
  return s;
}

describe("scenario fixtures", () => {
  it("loads _test.json only when hidden fixtures are requested", () => {
    testScenario();
    assert.equal(loadScenarios(scenariosDir).has("_test"), false);
  });

  it("validates format", () => {
    const base = { id: "x", title: "X", description: "", source: "s", normalized: false };
    assert.throws(() => parseScenario({ ...base, points: [{ t: 1, price: 1 }] }), /2/);
    assert.throws(() => parseScenario({ ...base, points: [{ t: 2, price: 1 }, { t: 1, price: 1 }] }), /increasing/);
    assert.throws(() => parseScenario({ ...base, points: [{ t: 1, price: 1 }, { t: 2, price: -1 }] }));
    assert.throws(() => parseScenario({ ...base, id: "../evil", points: [{ t: 1, price: 1 }, { t: 2, price: 1 }] }));
  });
});

describe("replay interpolation and compression", () => {
  it("defaults to 24 h → 3 min", () => {
    assert.equal(LIMITS.replayCompression, 480);
    close(replayDurationMs(testScenario(), LIMITS.replayCompression), 180_000);
  });

  it("interpolates linearly and scales normalized scenarios to the start price", () => {
    const s = testScenario();
    const opts = { compression: 480, startPrice: 4000 }; // scale ×2
    close(replayPriceAt(s, 0, opts).price, 4000);
    // 12 h of scenario time = 90 s wall clock → second point (1500 × 2).
    close(replayPriceAt(s, 90_000, opts).price, 3000);
    // 6 h = 45 s → halfway between 2000 and 1500 → 1750 × 2.
    const mid = replayPriceAt(s, 45_000, opts);
    close(mid.price, 3500);
    close(mid.progress, 0.25);
    assert.equal(mid.done, false);
    const end = replayPriceAt(s, 999_999, opts);
    close(end.price, 3600);
    assert.equal(end.done, true);
    assert.equal(end.progress, 1);
  });

  it("uses raw prices for non-normalized scenarios", () => {
    const s = { ...testScenario(), normalized: false };
    close(replayPriceAt(s, 90_000, { compression: 480, startPrice: 4000 }).price, 1500);
  });

  it("clamps negative elapsed time", () => {
    close(replayPriceAt(testScenario(), -5, { compression: 480, startPrice: 2000 }).price, 2000);
  });
});

describe("stress crash ramp", () => {
  it("ramps linearly to the target over ~20 s and holds", () => {
    close(crashPriceAt(2000, 30, 0, 20_000).price, 2000);
    close(crashPriceAt(2000, 30, 10_000, 20_000).price, 1700);
    const done = crashPriceAt(2000, 30, 20_000, 20_000);
    close(done.price, 1400);
    assert.equal(done.done, true);
    close(crashPriceAt(2000, 50, 60_000, 20_000).price, 1000);
    close(crashPriceAt(2000, 10, 5_000, 20_000).price, 1950);
  });
});

describe("PriceController", () => {
  it("follows mainnet until a crash, then ignores the relay", async () => {
    let now = 0;
    const writes: number[] = [];
    const pc = new PriceController(async (p) => void writes.push(p), () => now);
    await pc.onMainnetPrice(2000);
    assert.equal(pc.snapshot().priceSource, "mainnet");
    pc.startCrash(50, 20_000);
    now = 10_000;
    await pc.tick();
    close(pc.snapshot().price!, 1500);
    assert.equal(pc.snapshot().priceSource, "stress");
    await pc.onMainnetPrice(2100);
    close(pc.snapshot().price!, 1500);
    now = 30_000;
    await pc.tick();
    close(pc.snapshot().price!, 1000);
    assert.equal(pc.snapshot().scenarioProgress, 1);
    assert.deepEqual(writes, [2000, 1500, 1000]);
  });

  it("plays a replay from the current price", async () => {
    let now = 0;
    const pc = new PriceController(async () => {}, () => now);
    await pc.onMainnetPrice(3000);
    pc.startReplay(testScenario());
    now = 90_000;
    await pc.tick();
    const snap = pc.snapshot();
    assert.equal(snap.priceSource, "replay");
    assert.equal(snap.scenarioId, "_test");
    close(snap.price!, 2250);
    close(snap.scenarioProgress!, 0.5);
  });

  it("refuses scenarios before the first price", () => {
    const pc = new PriceController(async () => {});
    assert.throws(() => pc.startCrash(10), /no price/);
  });

  it("coalesces writes: latest price wins while a write is in flight", async () => {
    const writes: number[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const pc = new PriceController(async (p) => {
      writes.push(p);
      if (writes.length === 1) await gate;
    });
    const first = pc.onMainnetPrice(1);
    void pc.onMainnetPrice(2);
    void pc.onMainnetPrice(3);
    release();
    await first;
    assert.deepEqual(writes, [1, 3]);
  });
});

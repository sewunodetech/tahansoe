/**
 * Unit tests offline untuk Price Sampler dan Price Worker (ADR 0005, spec §3.8).
 *
 * Menguji:
 *  - formatPrice8Decimals
 *  - realizedVolatility (deret pendek, konstan, fluktuatif, window filter)
 *  - maxDrawdown (harga konstan, naik, crash, multiple peaks, filter range)
 *  - sampleOnce (dengan mock viem client dan mock DB)
 *  - PriceWorker (advisory lock 42161002, lock collision, interval loop, error resilience, graceful stop)
 */

import { test, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { PublicClient } from "viem";
import type { Db } from "@tahansoe/db";
import {
  formatPrice8Decimals,
  realizedVolatility,
  maxDrawdown,
  sampleOnce,
} from "../../src/sources/price-sampler.ts";
import {
  PriceWorker,
  PRICE_WORKER_ADVISORY_LOCK_KEY,
  type PriceWorkerClock,
  type PriceWorkerLogger,
} from "../../src/worker/price-worker.ts";
import type { AdvisoryLockClient } from "../../src/worker/lock.ts";

// ============================================================================
// 1. Tests untuk formatPrice8Decimals
// ============================================================================
describe("formatPrice8Decimals", () => {
  it("memformat harga bulat dengan 8 desimal", () => {
    assert.equal(formatPrice8Decimals(250000000000n), "2500.00000000");
    assert.equal(formatPrice8Decimals(100000000n), "1.00000000");
  });

  it("memformat nilai pecahan kecil di bawah $1", () => {
    assert.equal(formatPrice8Decimals(99980000n), "0.99980000");
    assert.equal(formatPrice8Decimals(1n), "0.00000001");
    assert.equal(formatPrice8Decimals(0n), "0.00000000");
  });
});

// ============================================================================
// 2. Tests untuk realizedVolatility
// ============================================================================
describe("realizedVolatility", () => {
  it("mengembalikan 0 jika data kurang dari 2 sample", () => {
    assert.equal(realizedVolatility([]), 0);
    assert.equal(
      realizedVolatility([{ priceUsd: "2500.00", sampledAt: new Date() }]),
      0,
    );
  });

  it("mengembalikan 0 jika harga konstan", () => {
    const t0 = new Date("2026-10-09T00:00:00Z");
    const samples = [
      { priceUsd: "2500.00", sampledAt: new Date(t0.getTime() + 1000) },
      { priceUsd: "2500.00", sampledAt: new Date(t0.getTime() + 2000) },
      { priceUsd: "2500.00", sampledAt: new Date(t0.getTime() + 3000) },
    ];
    assert.equal(realizedVolatility(samples), 0);
  });

  it("menghitung volatilitas positif untuk harga fluktuatif", () => {
    const t0 = new Date("2026-10-09T00:00:00Z");
    const samples = [
      { priceUsd: "100.00", sampledAt: new Date(t0.getTime() + 1000) },
      { priceUsd: "110.00", sampledAt: new Date(t0.getTime() + 2000) },
      { priceUsd: "105.00", sampledAt: new Date(t0.getTime() + 3000) },
      { priceUsd: "115.00", sampledAt: new Date(t0.getTime() + 4000) },
    ];
    const vol = realizedVolatility(samples);
    assert.ok(vol > 0, "Volatilitas harus lebih besar dari 0");
    assert.ok(vol < 1, "Volatilitas realistis untuk fluktuasi kecil");
  });

  it("menghormati filter windowMs", () => {
    const t0 = new Date("2026-10-09T00:00:00Z");
    const samples = [
      { priceUsd: "50.00", sampledAt: new Date(t0.getTime()) }, // di luar window (2 jam lalu)
      { priceUsd: "100.00", sampledAt: new Date(t0.getTime() + 7200000) }, // t_latest - 1m
      { priceUsd: "100.00", sampledAt: new Date(t0.getTime() + 7260000) }, // t_latest
    ];
    // Filter window 5 menit (300000 ms) dari sample terakhir: hanya 2 sample terakhir (harga sama -> 0)
    const vol = realizedVolatility(samples, 300000);
    assert.equal(vol, 0);
  });
});

// ============================================================================
// 3. Tests untuk maxDrawdown
// ============================================================================
describe("maxDrawdown", () => {
  it("mengembalikan 0 jika data kurang dari 2 sample", () => {
    assert.equal(maxDrawdown([]), 0);
    assert.equal(maxDrawdown([{ priceUsd: "100.00", sampledAt: new Date() }]), 0);
  });

  it("mengembalikan 0 jika harga konstan atau monoton naik", () => {
    const t0 = new Date("2026-10-09T00:00:00Z");
    const constantSamples = [
      { priceUsd: "100.00", sampledAt: new Date(t0.getTime() + 1000) },
      { priceUsd: "100.00", sampledAt: new Date(t0.getTime() + 2000) },
    ];
    assert.equal(maxDrawdown(constantSamples), 0);

    const risingSamples = [
      { priceUsd: "100.00", sampledAt: new Date(t0.getTime() + 1000) },
      { priceUsd: "120.00", sampledAt: new Date(t0.getTime() + 2000) },
      { priceUsd: "150.00", sampledAt: new Date(t0.getTime() + 3000) },
    ];
    assert.equal(maxDrawdown(risingSamples), 0);
  });

  it("menghitung drawdown yang tepat pada skenario crash", () => {
    const t0 = new Date("2026-10-09T00:00:00Z");
    // Peak 200 turun ke 100 -> drawdown 50% (0.5)
    const crashSamples = [
      { priceUsd: "100.00", sampledAt: new Date(t0.getTime() + 1000) },
      { priceUsd: "200.00", sampledAt: new Date(t0.getTime() + 2000) },
      { priceUsd: "100.00", sampledAt: new Date(t0.getTime() + 3000) },
      { priceUsd: "120.00", sampledAt: new Date(t0.getTime() + 4000) },
    ];
    const dd = maxDrawdown(crashSamples);
    assert.equal(dd, 0.5);
  });

  it("menghitung peak-to-trough maksimum di antara beberapa puncak", () => {
    const t0 = new Date("2026-10-09T00:00:00Z");
    // 100 -> 120 -> 110 (dd ~8.3%) -> 200 -> 80 (dd 60%) -> 150
    const multiSamples = [
      { priceUsd: "100.00", sampledAt: new Date(t0.getTime() + 1000) },
      { priceUsd: "120.00", sampledAt: new Date(t0.getTime() + 2000) },
      { priceUsd: "110.00", sampledAt: new Date(t0.getTime() + 3000) },
      { priceUsd: "200.00", sampledAt: new Date(t0.getTime() + 4000) },
      { priceUsd: "80.00", sampledAt: new Date(t0.getTime() + 5000) },
      { priceUsd: "150.00", sampledAt: new Date(t0.getTime() + 6000) },
    ];
    const dd = maxDrawdown(multiSamples);
    assert.equal(dd, (200 - 80) / 200); // 0.6
  });

  it("menghormati filter rentang waktu from dan to", () => {
    const t0 = new Date("2026-10-09T00:00:00Z");
    const samples = [
      { priceUsd: "200.00", sampledAt: new Date(t0.getTime() + 1000) },
      { priceUsd: "100.00", sampledAt: new Date(t0.getTime() + 2000) }, // crash di awal
      { priceUsd: "150.00", sampledAt: new Date(t0.getTime() + 3000) },
      { priceUsd: "160.00", sampledAt: new Date(t0.getTime() + 4000) },
    ];
    // Filter hanya waktu t0 + 3000 sampai t0 + 4000 (tidak ada drawdown)
    const dd = maxDrawdown(
      samples,
      new Date(t0.getTime() + 3000),
      new Date(t0.getTime() + 4000),
    );
    assert.equal(dd, 0);
  });
});

// ============================================================================
// 4. Tests untuk sampleOnce (mock client & DB)
// ============================================================================
describe("sampleOnce", () => {
  it("mengambil 4 data harga (WETH & USDC dari Aave & Chainlink) dan menyimpannya ke DB", async () => {
    const testNow = new Date("2026-10-09T12:00:00Z");

    const mockClient = {
      getBlockNumber: async () => 321654987n,
      readContract: async ({ functionName, args }: any) => {
        if (functionName === "getAssetPrice") {
          // AaveOracle: bedakan WETH vs USDC
          if (String(args?.[0]).toLowerCase().includes("82af49")) {
            return 255012340000n; // WETH $2550.12340000
          }
          return 99990000n; // USDC $0.99990000
        }
        if (functionName === "latestRoundData") {
          // Chainlink: [roundId, answer, startedAt, updatedAt, answeredInRound]
          return [1n, 255100000000n, 0n, 0n, 1n];
        }
        throw new Error(`Unexpected function call: ${functionName}`);
      },
    } as unknown as PublicClient;

    const insertedRows: any[] = [];
    const mockDb = {
      insert: () => ({
        values: async (rows: any[]) => {
          insertedRows.push(...rows);
          return rows;
        },
      }),
    } as unknown as Db;

    const samples = await sampleOnce({
      chainId: 42161,
      client: mockClient,
      db: mockDb,
      now: testNow,
    });

    assert.equal(samples.length, 4);

    const aaveWeth = samples.find((s) => s.asset === "WETH" && s.source === "aave_oracle");
    const aaveUsdc = samples.find((s) => s.asset === "USDC" && s.source === "aave_oracle");
    const clWeth = samples.find((s) => s.asset === "WETH" && s.source === "chainlink_proxy");
    const clUsdc = samples.find((s) => s.asset === "USDC" && s.source === "chainlink_proxy");

    assert.ok(aaveWeth);
    assert.equal(aaveWeth.priceUsd, "2550.12340000");
    assert.equal(aaveWeth.blockNumber, 321654987n);
    assert.equal(aaveWeth.sampledAt, testNow);

    assert.ok(aaveUsdc);
    assert.equal(aaveUsdc.priceUsd, "0.99990000");

    assert.ok(clWeth);
    assert.equal(clWeth.priceUsd, "2551.00000000");

    assert.ok(clUsdc);

    // Verifikasi DB insert
    assert.equal(insertedRows.length, 4);
    assert.equal(insertedRows[0].chainId, 42161);
    assert.equal(insertedRows[0].asset, "WETH");
    assert.equal(insertedRows[0].priceUsd, "2550.12340000");
  });
});

// ============================================================================
// 5. Tests untuk PriceWorker
// ============================================================================
describe("PriceWorker", () => {
  it("menggunakan key advisory lock 42161002 dan berhasil start & sample", async () => {
    let queriedLockKey: number | null = null;
    let unlockedLockKey: number | null = null;

    const mockLockClient: AdvisoryLockClient = {
      query: async (sql: string) => {
        if (sql.includes("pg_try_advisory_lock")) {
          const match = sql.match(/pg_try_advisory_lock\((\d+)\)/);
          if (match) queriedLockKey = Number(match[1]);
          return { rows: [{ locked: true }] };
        }
        if (sql.includes("pg_advisory_unlock")) {
          const match = sql.match(/pg_advisory_unlock\((\d+)\)/);
          if (match) unlockedLockKey = Number(match[1]);
          return { rows: [{ unlocked: true }] };
        }
        return { rows: [] };
      },
    };

    const mockClient = {
      getBlockNumber: async () => 100n,
      readContract: async ({ functionName }: any) => {
        if (functionName === "latestRoundData") {
          return [1n, 100000000n, 0n, 0n, 1n];
        }
        return 100000000n;
      },
    } as unknown as PublicClient;

    const scheduledTimers: Array<{ fn: () => void; ms: number }> = [];
    const mockClock: PriceWorkerClock = {
      now: () => new Date("2026-10-09T10:00:00Z"),
      setTimeout: (fn, ms) => {
        const item = { fn, ms };
        scheduledTimers.push(item);
        return item;
      },
      clearTimeout: () => {},
    };

    let sampleCompleted = false;
    const worker = new PriceWorker({
      lockClient: mockLockClient,
      client: mockClient,
      clock: mockClock,
      intervalSec: 60,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      onSampleCompleted: (samples) => {
        if (samples && samples.length === 4) sampleCompleted = true;
      },
    });

    const started = await worker.start();
    assert.equal(started, true);
    assert.equal(queriedLockKey, PRICE_WORKER_ADVISORY_LOCK_KEY);
    assert.equal(sampleCompleted, true);
    assert.equal(scheduledTimers.length, 1);
    const firstTimer = scheduledTimers[0];
    assert.ok(firstTimer, "Timer harus terjadwal");
    assert.equal(firstTimer.ms, 60000);

    // Stop cleanly
    await worker.stop();
    assert.equal(unlockedLockKey, PRICE_WORKER_ADVISORY_LOCK_KEY);
  });

  it("keluar secara bersih jika terjadi lock collision", async () => {
    const mockLockClient: AdvisoryLockClient = {
      query: async () => ({ rows: [{ locked: false }] }),
    };

    let exitCode: number | null = null;
    const worker = new PriceWorker({
      lockClient: mockLockClient,
      exitFn: (code) => {
        exitCode = code;
      },
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });

    const started = await worker.start();
    assert.equal(started, false);
    assert.equal(exitCode, 0); // Clean exit 0
  });

  it("tahan terhadap kegagalan sampling (error resilience) dan tetap menjadwalkan interval berikutnya", async () => {
    const mockLockClient: AdvisoryLockClient = {
      query: async () => ({ rows: [{ locked: true }] }),
    };

    const failingClient = {
      getBlockNumber: async () => {
        throw new Error("RPC timeout simulated");
      },
      readContract: async () => {
        throw new Error("RPC timeout simulated");
      },
    } as unknown as PublicClient;

    const scheduledTimers: Array<{ fn: () => void; ms: number }> = [];
    const mockClock: PriceWorkerClock = {
      now: () => new Date(),
      setTimeout: (fn, ms) => {
        const item = { fn, ms };
        scheduledTimers.push(item);
        return item;
      },
      clearTimeout: () => {},
    };

    let errorLogged = false;
    const worker = new PriceWorker({
      lockClient: mockLockClient,
      client: failingClient,
      clock: mockClock,
      intervalSec: 60,
      logger: {
        info: () => {},
        warn: () => {},
        error: (msg) => {
          if (msg.includes("RPC timeout simulated")) errorLogged = true;
        },
      },
    });

    const started = await worker.start();
    assert.equal(started, true);
    assert.equal(errorLogged, true);
    // Interval berikutnya tetap dijadwalkan meski terjadi error
    assert.equal(scheduledTimers.length, 1);
    const retryTimer = scheduledTimers[0];
    assert.ok(retryTimer, "Interval timer berikutnya harus terjadwal");
    assert.equal(retryTimer.ms, 60000);

    await worker.stop();
  });
});

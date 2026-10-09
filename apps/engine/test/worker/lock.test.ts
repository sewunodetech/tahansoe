/**
 * Test ketahanan advisory lock (bug live scheduler): unwrapError, retry+backoff
 * dengan fake clock + client factory, dan error setelah connect → LOCK LOST.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  unwrapError,
  connectWithRetry,
  openAdvisoryLock,
  type LockPgClient,
} from "../../src/worker/lock.ts";

// --- unwrapError ----------------------------------------------------------

test("unwrapError: ErrorEvent-like → message, bukan [object ErrorEvent]", () => {
  const errorEvent = { type: "error", message: "", error: { message: "WebSocket connection failed" } };
  const out = unwrapError(errorEvent);
  assert.match(out, /WebSocket connection failed/);
  assert.doesNotMatch(out, /\[object/);
});

test("unwrapError: Error dgn code 57P01 → message + code", () => {
  const err = Object.assign(new Error("terminating connection due to administrator command"), { code: "57P01" });
  const out = unwrapError(err);
  assert.match(out, /terminating connection/);
  assert.match(out, /code=57P01/);
});

test("unwrapError: event tanpa message → fallback nama, bukan [object]", () => {
  class ErrorEvent {
    type = "error";
  }
  const out = unwrapError(new ErrorEvent());
  assert.doesNotMatch(out, /\[object/);
  assert.ok(out.length > 0);
});

test("unwrapError: string & null", () => {
  assert.equal(unwrapError("boom"), "boom");
  assert.equal(unwrapError(null), "unknown error");
});

// --- connectWithRetry ------------------------------------------------------

/** Fake client yang gagal connect N kali lalu sukses. */
function makeFlakyFactory(failTimes: number, onConnectError?: unknown) {
  let created = 0;
  const factory = (_url: string): LockPgClient => {
    const idx = created++;
    return {
      async connect() {
        if (idx < failTimes) throw onConnectError ?? { type: "error", error: { message: `open failed #${idx}` } };
      },
      on() {},
      async end() {},
      async query() {
        return { rows: [{ locked: true }] };
      },
    };
  };
  return { factory, createdCount: () => created };
}

test("connectWithRetry: gagal 2x lalu sukses — backoff dgn fake clock", async () => {
  const slept: number[] = [];
  const { factory, createdCount } = makeFlakyFactory(2);
  const client = await connectWithRetry("postgres://x", {
    attempts: 5,
    baseBackoffMs: 1000,
    sleep: async (ms) => void slept.push(ms),
    makeClient: factory,
    logger: { warn: () => {} },
  });
  assert.ok(client);
  assert.equal(createdCount(), 3, "3 client dibuat (2 gagal + 1 sukses)");
  assert.deepEqual(slept, [1000, 2000], "backoff 1s lalu 2s");
});

test("connectWithRetry: semua gagal → lempar error unwrapped (bukan [object])", async () => {
  const slept: number[] = [];
  const { factory } = makeFlakyFactory(5);
  await assert.rejects(
    () =>
      connectWithRetry("postgres://x", {
        attempts: 5,
        baseBackoffMs: 1000,
        sleep: async (ms) => void slept.push(ms),
        makeClient: factory,
        logger: { warn: () => {} },
      }),
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      assert.match(msg, /setelah 5 percobaan/);
      assert.doesNotMatch(msg, /\[object/);
      return true;
    },
  );
  // 4 jeda (antara 5 percobaan): 1,2,4,8s.
  assert.deepEqual(slept, [1000, 2000, 4000, 8000]);
});

// --- openAdvisoryLock: error setelah connect → LOCK LOST -------------------

test("openAdvisoryLock: client error setelah connect → isLost() true (bukan crash)", async () => {
  let errorHandler: ((e: unknown) => void) | null = null;
  const client: LockPgClient = {
    async connect() {},
    on(_e: "error", h: (err: unknown) => void) {
      errorHandler = h;
    },
    async end() {},
    async query() {
      return { rows: [{ locked: true }] };
    },
  };
  const lock = await openAdvisoryLock("postgres://x", 42161003, {
    makeClient: () => client,
    logger: { warn: () => {} },
  });
  assert.equal(lock.acquired, true);
  assert.equal(lock.isLost(), false);
  // Simulasikan terminasi server (57P01) SETELAH connect.
  const handler = errorHandler as unknown as ((e: unknown) => void) | null;
  assert.ok(handler, "handler error terpasang");
  handler!(Object.assign(new Error("terminating connection due to administrator command"), { code: "57P01" }));
  assert.equal(lock.isLost(), true, "lock ditandai hilang, tidak crash");
  await lock.release();
});

test("openAdvisoryLock: pg_try_advisory_lock false → acquired false (instance lain)", async () => {
  const client: LockPgClient = {
    async connect() {},
    on() {},
    async end() {},
    async query() {
      return { rows: [{ locked: false }] };
    },
  };
  const lock = await openAdvisoryLock("postgres://x", 42161003, { makeClient: () => client, logger: { warn: () => {} } });
  assert.equal(lock.acquired, false);
});

test("ResearchWorker: client error event -> lock lost -> reacquire on next tick", async () => {
  let firstErrorHandler: ((e: unknown) => void) | null = null;
  let clientsCreated = 0;
  let runsExecuted = 0;

  const { ResearchWorker } = await import("../../src/worker/research-worker.ts");

  const mockFactory = async (_url: string, opts?: import("../../src/worker/lock.ts").OpenLockOptions) => {
    clientsCreated++;
    const isFirst = clientsCreated === 1;
    const client: LockPgClient = {
      async connect() {},
      on(_e: "error", h: (err: unknown) => void) {
        if (isFirst) firstErrorHandler = h;
        if (opts?.onError) {
          // pasang handler yang meneruskan ke onError
          const orig = h;
          void orig;
        }
      },
      async end() {},
      async query() {
        return { rows: [{ locked: true }] };
      },
    };
    if (opts?.onError && isFirst) {
      firstErrorHandler = (err) => opts.onError!(unwrapError(err));
    }
    return client;
  };

  let timerCb: (() => void) | null = null;
  const mockClock = {
    now: () => new Date(),
    setTimeout: (fn: () => void) => {
      timerCb = fn;
      return 1;
    },
    clearTimeout: () => {
      timerCb = null;
    },
  };

  let runCompletedResolve: (() => void) | null = null;
  let runCompletedPromise = new Promise<void>((r) => {
    runCompletedResolve = r;
  });

  const worker = new ResearchWorker({
    makeLockClient: mockFactory,
    clock: mockClock,
    envOverrides: {
      DATABASE_URL: "postgres://mock-db",
    },
    runner: async () => {
      runsExecuted++;
      return { report: { proposedRegime: "CALM" } as any };
    },
    onRunCompleted: () => {
      runCompletedResolve?.();
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  });

  await worker.start();
  assert.equal(runsExecuted, 1, "Run pertama sukses dijalankan");
  assert.equal(worker.getIsLockLost(), false);
  assert.equal(clientsCreated, 1);

  // Simulasikan koneksi Neon putus (57P01)
  assert.ok(firstErrorHandler, "Handler error harus terpasang pada client pertama");
  (firstErrorHandler as (e: unknown) => void)(Object.assign(new Error("terminating connection due to administrator command"), { code: "57P01" }));
  assert.equal(worker.getIsLockLost(), true, "Worker menandai lock lost setelah error event");

  // Pada tick berikutnya, timer memicu executeRun:
  assert.ok(timerCb, "Timer untuk tick berikutnya harus terjadwal");
  runCompletedPromise = new Promise<void>((r) => {
    runCompletedResolve = r;
  });
  (timerCb as () => void)();
  await runCompletedPromise;

  // Worker harus me-reacquire lock dan menjalankan run kedua
  assert.equal(clientsCreated, 2, "Client kedua dibuat untuk re-acquire lock");
  assert.equal(worker.getIsLockLost(), false, "Lock berhasil diambil kembali");
  assert.equal(runsExecuted, 2, "Run kedua berhasil dijalankan setelah lock pulih");

  await worker.stop();
});

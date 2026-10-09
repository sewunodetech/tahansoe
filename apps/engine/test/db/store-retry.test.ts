/** Test retry transient untuk penulisan DB (compute Neon suspend/cold start). */

import { test } from "node:test";
import assert from "node:assert/strict";
import { withTransientRetry, isTransientDbError } from "../../src/db/store.ts";

test("isTransientDbError: kenali fetch failed / 57P01 / websocket / nested Drizzle cause", () => {
  assert.equal(isTransientDbError(new Error("TypeError: fetch failed")), true);
  assert.equal(isTransientDbError(Object.assign(new Error("terminating connection"), { code: "57P01" })), true);
  assert.equal(isTransientDbError(new Error("Connection terminated unexpectedly")), true);
  assert.equal(isTransientDbError(new Error("Sent before connected")), true);
  // Nested Drizzle error with undici connect timeout
  const nestedDrizzleErr = new Error("Failed query: insert into ... returning id");
  (nestedDrizzleErr as any).cause = {
    message: "Error connecting to database: TypeError: fetch failed",
    sourceError: Object.assign(new Error("fetch failed"), {
      cause: Object.assign(new Error("Connect Timeout Error"), { code: "UND_ERR_CONNECT_TIMEOUT" }),
    }),
  };
  assert.equal(isTransientDbError(nestedDrizzleErr), true);
  // Error logis (bukan transient) tidak di-retry.
  assert.equal(isTransientDbError(new Error('null value in column "chain_id" violates not-null constraint')), false);
});

test("withTransientRetry: gagal transient 2x lalu sukses (fake sleep)", async () => {
  const slept: number[] = [];
  let calls = 0;
  const result = await withTransientRetry(
    async () => {
      calls++;
      if (calls <= 2) throw new Error("fetch failed");
      return "ok";
    },
    { attempts: 5, baseMs: 500, sleep: async (ms) => void slept.push(ms) },
  );
  assert.equal(result, "ok");
  assert.equal(calls, 3);
  assert.deepEqual(slept, [500, 1000], "backoff 0.5s lalu 1s");
});

test("withTransientRetry: error logis dilempar segera (tanpa retry)", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      withTransientRetry(
        async () => {
          calls++;
          throw new Error("duplicate key value violates unique constraint");
        },
        { attempts: 5, baseMs: 1, sleep: async () => {} },
      ),
    /duplicate key/,
  );
  assert.equal(calls, 1, "tidak di-retry untuk error logis");
});

test("withTransientRetry: semua percobaan transient gagal → lempar error terakhir", async () => {
  const slept: number[] = [];
  await assert.rejects(
    () =>
      withTransientRetry(async () => { throw new Error("fetch failed"); }, {
        attempts: 4,
        baseMs: 500,
        sleep: async (ms) => void slept.push(ms),
      }),
    /fetch failed/,
  );
  assert.deepEqual(slept, [500, 1000, 2000], "3 jeda antar 4 percobaan");
});

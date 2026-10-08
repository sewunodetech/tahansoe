/**
 * Unit test offline untuk Scheduled Research Worker:
 *  - Penjadwalan adaptif (schedule.ts)
 *  - Postgres advisory lock utilities (lock.ts)
 *  - Siklus hidup, anti-overlap, kill switch, budget check, dan ketahanan error (research-worker.ts)
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Regime } from "@tahansoe/domain";
import type { ResearchTrigger } from "../../src/config.ts";
import {
  DEFAULT_INTERVAL_ALERT_MS,
  DEFAULT_INTERVAL_CALM_MS,
  formatIntervalMinutes,
  getIntervalMs,
  msUntilNextUtcMidnight,
} from "../../src/worker/schedule.ts";
import {
  acquireAdvisoryLock,
  getDirectPostgresUrl,
  releaseAdvisoryLock,
  RESEARCH_WORKER_ADVISORY_LOCK_KEY,
  type AdvisoryLockClient,
} from "../../src/worker/lock.ts";
import {
  ResearchWorker,
  type ResearchWorkerClock,
  type ResearchWorkerLogger,
} from "../../src/worker/research-worker.ts";
import type { RunResult } from "../../src/agents/run.ts";

// ============================================================================
// 1. Tests untuk schedule.ts
// ============================================================================

test("schedule: interval default CALM adalah 120 menit (2 jam)", () => {
  const ms = getIntervalMs("CALM", {});
  assert.equal(ms, DEFAULT_INTERVAL_CALM_MS);
  assert.equal(ms, 2 * 60 * 60 * 1000);
});

test("schedule: interval default ELEVATED/STRESSED/CRISIS adalah 60 menit (1 jam)", () => {
  for (const regime of ["ELEVATED", "STRESSED", "CRISIS"] as Regime[]) {
    const ms = getIntervalMs(regime, {});
    assert.equal(ms, DEFAULT_INTERVAL_ALERT_MS);
    assert.equal(ms, 1 * 60 * 60 * 1000);
  }
});

test("schedule: input null/undefined fallback ke CALM (120m)", () => {
  assert.equal(getIntervalMs(null, {}), DEFAULT_INTERVAL_CALM_MS);
  assert.equal(getIntervalMs(undefined, {}), DEFAULT_INTERVAL_CALM_MS);
});

test("schedule: override via environment variables dihormati", () => {
  const env = {
    RESEARCH_INTERVAL_CALM_MIN: "45",
    RESEARCH_INTERVAL_ALERT_MIN: "15",
  };
  assert.equal(getIntervalMs("CALM", env), 45 * 60 * 1000);
  assert.equal(getIntervalMs("ELEVATED", env), 15 * 60 * 1000);
  assert.equal(getIntervalMs("CRISIS", env), 15 * 60 * 1000);

  // Nilai non-angka / invalid kembali ke default
  const invalidEnv = {
    RESEARCH_INTERVAL_CALM_MIN: "invalid",
    RESEARCH_INTERVAL_ALERT_MIN: "-5",
  };
  assert.equal(getIntervalMs("CALM", invalidEnv), DEFAULT_INTERVAL_CALM_MS);
  assert.equal(getIntervalMs("STRESSED", invalidEnv), DEFAULT_INTERVAL_ALERT_MS);
});

test("schedule: msUntilNextUtcMidnight menghitung sisa waktu hingga 00:00:00 UTC berikutnya", () => {
  const mockNow = new Date("2026-10-08T22:30:00.000Z");
  const ms = msUntilNextUtcMidnight(mockNow);
  // 1.5 jam = 90 menit = 5,400,000 ms
  assert.equal(ms, 90 * 60 * 1000);
});

test("schedule: formatIntervalMinutes memformat milidetik ke menit string", () => {
  assert.equal(formatIntervalMinutes(120 * 60 * 1000), "120m");
  assert.equal(formatIntervalMinutes(60 * 60 * 1000), "60m");
  assert.equal(formatIntervalMinutes(45 * 60 * 1000), "45m");
});

// ============================================================================
// 2. Tests untuk lock.ts
// ============================================================================

test("lock: getDirectPostgresUrl menghapus '-pooler' dari hostname Neon", () => {
  const poolerUrl =
    "postgres://user:pass@ep-cool-fog-123456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require";
  const directUrl = getDirectPostgresUrl(poolerUrl);
  assert.ok(!directUrl.includes("-pooler"));
  assert.ok(directUrl.includes("ep-cool-fog-123456.us-east-2.aws.neon.tech"));

  // URL tanpa pooler tidak berubah
  const standardUrl = "postgres://user:pass@localhost:5432/testdb";
  assert.equal(getDirectPostgresUrl(standardUrl), standardUrl);
});

test("lock: acquireAdvisoryLock mengembalikan true saat lock didapatkan", async () => {
  const mockClient: AdvisoryLockClient = {
    query: async (sql: string) => {
      assert.ok(sql.includes(String(RESEARCH_WORKER_ADVISORY_LOCK_KEY)));
      return { rows: [{ locked: true }] };
    },
  };

  const acquired = await acquireAdvisoryLock(mockClient);
  assert.equal(acquired, true);
});

test("lock: acquireAdvisoryLock mengembalikan false saat sudah dipegang instance lain", async () => {
  const mockClient: AdvisoryLockClient = {
    query: async () => ({ rows: [{ locked: false }] }),
  };

  const acquired = await acquireAdvisoryLock(mockClient);
  assert.equal(acquired, false);
});

test("lock: releaseAdvisoryLock mengeksekusi pg_advisory_unlock dengan benar", async () => {
  let unlockedCalled = false;
  const mockClient: AdvisoryLockClient = {
    query: async (sql: string) => {
      if (sql.includes("pg_advisory_unlock")) {
        unlockedCalled = true;
      }
      return { rows: [{ unlocked: true }] };
    },
  };

  const res = await releaseAdvisoryLock(mockClient);
  assert.equal(res, true);
  assert.equal(unlockedCalled, true);
});

// ============================================================================
// 3. Tests untuk ResearchWorker
// ============================================================================

function createMockClock(initialDate = new Date("2026-10-08T12:00:00Z")) {
  let currentTime = initialDate.getTime();
  const timers: Map<number, { fn: () => void; due: number }> = new Map();
  let nextTimerId = 1;

  const clock: ResearchWorkerClock = {
    now: () => new Date(currentTime),
    setTimeout: (fn, ms) => {
      const id = nextTimerId++;
      timers.set(id, { fn, due: currentTime + ms });
      return id;
    },
    clearTimeout: (id) => {
      timers.delete(id);
    },
  };

  const advanceTime = (ms: number) => {
    currentTime += ms;
    for (const [id, t] of Array.from(timers.entries())) {
      if (t.due <= currentTime) {
        timers.delete(id);
        t.fn();
      }
    }
  };

  return { clock, advanceTime, timers };
}

function createMockLogger() {
  const logs: { level: string; msg: string }[] = [];
  const logger: ResearchWorkerLogger = {
    info: (msg) => logs.push({ level: "info", msg }),
    warn: (msg) => logs.push({ level: "warn", msg }),
    error: (msg) => logs.push({ level: "error", msg }),
  };
  return { logger, logs };
}

test("worker: single-instance guard exit 0 saat instance lain sudah memegang lock", async () => {
  const { logger, logs } = createMockLogger();
  let exitCode: number | null = null;
  let runnerCalled = false;

  const mockLockClient: AdvisoryLockClient = {
    query: async () => ({ rows: [{ locked: false }] }),
  };

  const worker = new ResearchWorker({
    lockClient: mockLockClient,
    logger,
    exitFn: (code) => {
      exitCode = code;
    },
    runner: async () => {
      runnerCalled = true;
      throw new Error("should not be called");
    },
  });

  const started = await worker.start();
  assert.equal(started, false);
  assert.equal(exitCode, 0);
  assert.equal(runnerCalled, false);
  assert.ok(
    logs.some((l) => l.msg.includes("another research worker is running")),
    "Harus mencatat log bahwa research worker lain sedang berjalan",
  );
});

test("worker: menjalankan run pertama segera saat start() dan menjadwalkan interval CALM (120m)", async () => {
  const { clock, timers } = createMockClock();
  const { logger, logs } = createMockLogger();

  let runnerCalls = 0;
  const mockLockClient: AdvisoryLockClient = {
    query: async () => ({ rows: [{ locked: true }] }),
    end: async () => {},
  };

  const mockReport: any = {
    proposedRegime: "CALM",
    confidence: 0.9,
    summary: "Market is calm",
  };

  const worker = new ResearchWorker({
    lockClient: mockLockClient,
    clock,
    logger,
    runner: async (): Promise<RunResult> => {
      runnerCalls++;
      return {
        report: mockReport,
        reportId: "rep_mock_123",
        diagnostics: {
          roles: [],
          totalInputTokens: 500,
          totalOutputTokens: 200,
          durationMs: 1200,
        },
      };
    },
  });

  const started = await worker.start();
  assert.equal(started, true);
  assert.equal(runnerCalls, 1, "Run pertama harus dijalankan segera saat start()");

  // Cek log baris tunggal
  const runLog = logs.find((l) => l.msg.includes("regime=CALM"));
  assert.ok(runLog, "Harus mencatat log run satu baris");
  assert.ok(runLog.msg.includes("reportId=rep_mock_123"));
  assert.ok(runLog.msg.includes("nextRunIn=120m"));
  assert.ok(runLog.msg.includes("tokens=700"));

  // Verifikasi timer berikutnya dijadwalkan 120 menit kemudian
  assert.equal(timers.size, 1);
  const scheduled = Array.from(timers.values())[0];
  assert.ok(scheduled);
  assert.equal(scheduled.due - clock.now().getTime(), DEFAULT_INTERVAL_CALM_MS);

  await worker.stop();
});

test("worker: menyesuaikan jadwal berikutnya menjadi 60m saat hasil regime ELEVATED", async () => {
  const { clock, timers } = createMockClock();
  const { logger, logs } = createMockLogger();

  const mockLockClient: AdvisoryLockClient = {
    query: async () => ({ rows: [{ locked: true }] }),
    end: async () => {},
  };

  const worker = new ResearchWorker({
    lockClient: mockLockClient,
    clock,
    logger,
    runner: async (): Promise<RunResult> => {
      return {
        report: {
          proposedRegime: "ELEVATED",
          confidence: 0.85,
          summary: "Market elevated",
        } as any,
        reportId: "rep_elevated_456",
        diagnostics: {
          roles: [],
          totalInputTokens: 600,
          totalOutputTokens: 300,
          durationMs: 1500,
        },
      };
    },
  });

  await worker.start();

  const runLog = logs.find((l) => l.msg.includes("regime=ELEVATED"));
  assert.ok(runLog);
  assert.ok(runLog.msg.includes("nextRunIn=60m"));

  const scheduled = Array.from(timers.values())[0];
  assert.ok(scheduled);
  assert.equal(scheduled.due - clock.now().getTime(), DEFAULT_INTERVAL_ALERT_MS);

  await worker.stop();
});

test("worker: anti-overlap guard mencegah dua run tumpang tindih", async () => {
  const { clock } = createMockClock();
  const { logger, logs } = createMockLogger();

  let resolveFirstRun: () => void;
  const firstRunPromise = new Promise<void>((r) => {
    resolveFirstRun = r;
  });

  let runCount = 0;
  const worker = new ResearchWorker({
    lockClient: {
      query: async () => ({ rows: [{ locked: true }] }),
      end: async () => {},
    },
    clock,
    logger,
    runner: async (): Promise<RunResult> => {
      runCount++;
      if (runCount === 1) {
        await firstRunPromise;
      }
      return { report: null, reason: "ok" };
    },
  });

  // Start memicu run 1 secara asinkron (jangan di-await dulu)
  const startPromise = worker.start();

  // Tunggu sejenak agar run 1 masuk ke status isExecuting
  await new Promise((r) => setTimeout(r, 10));

  // Panggil executeRun secara bersamaan saat run 1 belum selesai
  await worker.executeRun("ESCALATION");

  assert.ok(
    logs.some((l) => l.msg.includes("anti-overlap guard")),
    "Panggilan kedua harus ditolak oleh anti-overlap guard",
  );

  // Selesaikan run 1
  resolveFirstRun!();
  await startPromise;

  assert.equal(runCount, 1, "Hanya 1 eksekusi yang boleh diproses");
  await worker.stop();
});

test("worker: kill switch RESEARCH_ENABLED=false melewati run tanpa memanggil runner", async () => {
  const { clock } = createMockClock();
  const { logger, logs } = createMockLogger();
  let runnerInvoked = false;

  const worker = new ResearchWorker({
    lockClient: {
      query: async () => ({ rows: [{ locked: true }] }),
      end: async () => {},
    },
    clock,
    logger,
    envOverrides: {
      RESEARCH_ENABLED: "false",
    },
    runner: async (): Promise<RunResult> => {
      runnerInvoked = true;
      return { report: null, reason: "should not run" };
    },
  });

  await worker.start();
  assert.equal(runnerInvoked, false, "Runner tidak boleh dipanggil saat kill switch aktif");

  const skipLog = logs.find((l) => l.msg.includes("regime=SKIP"));
  assert.ok(skipLog, "Harus mencatat log SKIP");
  assert.ok(skipLog.msg.includes("kill switch"));

  await worker.stop();
});

test("worker: ketahanan error menjaga worker tetap hidup dan menjadwalkan run berikutnya", async () => {
  const { clock, timers } = createMockClock();
  const { logger, logs } = createMockLogger();

  const worker = new ResearchWorker({
    lockClient: {
      query: async () => ({ rows: [{ locked: true }] }),
      end: async () => {},
    },
    clock,
    logger,
    runner: async (): Promise<RunResult> => {
      throw new Error("Simulated network timeout");
    },
  });

  // start tidak boleh melempar unhandled error
  await worker.start();

  const errorLog = logs.find((l) => l.msg.includes("regime=ERROR"));
  assert.ok(errorLog, "Harus mencatat regime=ERROR dalam log baris tunggal");
  assert.ok(errorLog.msg.includes("Simulated network timeout"));

  // Timer run berikutnya tetap harus dijadwalkan
  assert.equal(timers.size, 1, "Run berikutnya tetap harus dijadwalkan meski terjadi error");

  await worker.stop();
});

test("worker: stop() membersihkan timer dan melepaskan advisory lock", async () => {
  const { clock, timers } = createMockClock();
  const { logger } = createMockLogger();

  let lockReleased = false;
  let clientClosed = false;

  const mockLockClient: AdvisoryLockClient = {
    query: async (sql) => {
      if (sql.includes("pg_advisory_unlock")) {
        lockReleased = true;
      }
      return { rows: [{ locked: true, unlocked: true }] };
    },
    end: async () => {
      clientClosed = true;
    },
  };

  const worker = new ResearchWorker({
    lockClient: mockLockClient,
    clock,
    logger,
    runner: async (): Promise<RunResult> => ({ report: null, reason: "ok" }),
  });

  await worker.start();
  assert.equal(timers.size, 1);

  await worker.stop();
  assert.equal(timers.size, 0, "Timer harus dibersihkan");
  assert.equal(lockReleased, true, "Advisory lock harus dilepas");
  assert.equal(clientClosed, true, "Koneksi lock client harus ditutup");
});

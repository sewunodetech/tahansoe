/**
 * Unit test orchestrator `tahansoe start` (spec m3-research-broadcast).
 *
 * Menguji:
 *  - start orchestrator dengan fakes: seluruh bagian dimulai (worker, price, settle, fusion, broadcaster).
 *  - Isolasi I4: kegagalan start broadcaster tidak menghentikan worker / fusi / settle.
 *  - Flag --no-broadcast: broadcaster tidak dimulai, status line disabled.
 *  - Flag --no-research: research worker tidak dijalankan.
 *  - Flag --once: menjalankan satu siklus sampler, research, fusion, settle, broadcast lalu keluar exit 0.
 *  - Startup banner mencantumkan status seluruh komponen.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  startCommand,
  type StartDeps,
} from "../../src/cli/commands/start.ts";
import { EXIT_OK } from "../../src/cli/commands/args.ts";

const fakeFusionResult = {
  chainId: 42161,
  now: new Date(),
  dry: false,
  results: [{ asset: "ETH", assessment: { regime: "CALM" } as any, reasons: [] }],
  activeSignals: [],
};

test("startCommand: seluruh bagian berjalan (fakes) dan shutdown bersih melepas lock", async () => {
  let workerStarted = false;
  let workerStopped = false;
  let priceStarted = false;
  let priceStopped = false;
  let settleJobCalled = false;
  let fusionRunCalled = false;
  let broadcastStarted = false;
  let broadcastStopped = false;

  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];

  const ctrl = new AbortController();

  const fakeDeps: StartDeps = {
    stdout: (m) => stdoutLines.push(m),
    stderr: (m) => stderrLines.push(m),
    isTTY: true,
    shutdownSignal: ctrl.signal,
    startBroadcastWorker: async () => {
      broadcastStarted = true;
      return {
        stop: async () => {
          broadcastStopped = true;
        },
      };
    },
    startPriceWorker: async () => {
      priceStarted = true;
      return async () => {
        priceStopped = true;
      };
    },
    makeWorker: () => ({
      start: async () => {
        workerStarted = true;
        return true;
      },
      stop: async () => {
        workerStopped = true;
      },
    }),
    settleJob: async () => {
      settleJobCalled = true;
      return { totalEvaluated: 1, settled: [], insufficientData: [] };
    },
    makeSettleLock: async () => ({
      acquired: true,
      release: async () => {},
    }),
    fusionRun: async () => {
      fusionRunCalled = true;
      return fakeFusionResult as any;
    },
    makeFusionLock: async () => ({
      acquired: true,
      release: async () => {},
    }),
  };

  // Jalankan startCommand dan picu shutdown setelah beberapa saat
  const runPromise = startCommand(["--no-color"], fakeDeps);

  await new Promise((r) => setTimeout(r, 20));
  ctrl.abort();

  const exitCode = await runPromise;
  assert.equal(exitCode, EXIT_OK);

  // Verifikasi seluruh komponen aktif
  assert.ok(workerStarted, "research worker harus dimulai");
  assert.ok(workerStopped, "research worker harus dihentikan saat shutdown");
  assert.ok(priceStarted, "price worker harus dimulai");
  assert.ok(priceStopped, "price worker harus dihentikan saat shutdown");
  assert.ok(broadcastStarted, "broadcaster harus dimulai");
  assert.ok(broadcastStopped, "broadcaster harus dihentikan saat shutdown");
  assert.ok(settleJobCalled, "settle ticker tick pertama harus berjalan");
  assert.ok(fusionRunCalled, "fusion ticker tick pertama harus berjalan");

  // Verifikasi banner tercetak di stdout
  const output = stdoutLines.join("");
  assert.match(output, /standalone risk agent/i);
  assert.match(output, /research worker/i);
  assert.match(output, /price sampler/i);
  assert.match(output, /risk fusion/i);
  assert.match(output, /broadcaster/i);
});

test("startCommand: isolasi kegagalan broadcaster (I4) — worker dan fusi tetap berjalan normal", async () => {
  let workerStarted = false;
  let workerStopped = false;
  let fusionRunCalled = false;

  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  const ctrl = new AbortController();

  const fakeDeps: StartDeps = {
    stdout: (m) => stdoutLines.push(m),
    stderr: (m) => stderrLines.push(m),
    isTTY: true,
    shutdownSignal: ctrl.signal,
    startBroadcastWorker: async () => {
      throw new Error("Broadcaster start failed");
    },
    startPriceWorker: async () => async () => {},
    makeWorker: () => ({
      start: async () => {
        workerStarted = true;
        return true;
      },
      stop: async () => {
        workerStopped = true;
      },
    }),
    settleJob: async () => ({ totalEvaluated: 0, settled: [], insufficientData: [] }),
    makeSettleLock: async () => ({ acquired: true, release: async () => {} }),
    fusionRun: async () => {
      fusionRunCalled = true;
      return fakeFusionResult as any;
    },
    makeFusionLock: async () => ({ acquired: true, release: async () => {} }),
  };

  const runPromise = startCommand(["--no-color"], fakeDeps);

  await new Promise((r) => setTimeout(r, 20));
  ctrl.abort();

  const exitCode = await runPromise;
  assert.equal(exitCode, EXIT_OK, "proses tidak boleh crash karena broadcaster gagal");

  assert.ok(workerStarted, "worker harus tetap berjalan walau broadcaster error");
  assert.ok(workerStopped, "worker harus stop bersih");
  assert.ok(fusionRunCalled, "fusion tetap berjalan");

  const errOutput = stderrLines.join("");
  assert.match(errOutput, /\[broadcast\] worker gagal dimulai/i);
});

test("startCommand: flag --no-broadcast melewati broadcaster dan menampilkan status disabled", async () => {
  let broadcastCalled = false;
  const stdoutLines: string[] = [];
  const ctrl = new AbortController();

  const fakeDeps: StartDeps = {
    stdout: (m) => stdoutLines.push(m),
    stderr: () => {},
    isTTY: true,
    shutdownSignal: ctrl.signal,
    startBroadcastWorker: async () => {
      broadcastCalled = true;
      return { stop: async () => {} };
    },
    startPriceWorker: async () => async () => {},
    makeWorker: () => ({
      start: async () => true,
      stop: async () => {},
    }),
    settleJob: async () => ({ totalEvaluated: 0, settled: [], insufficientData: [] }),
    makeSettleLock: async () => ({ acquired: true, release: async () => {} }),
    fusionRun: async () => fakeFusionResult as any,
    makeFusionLock: async () => ({ acquired: true, release: async () => {} }),
  };

  const runPromise = startCommand(["--no-broadcast", "--no-color"], fakeDeps);

  await new Promise((r) => setTimeout(r, 20));
  ctrl.abort();

  const exitCode = await runPromise;
  assert.equal(exitCode, EXIT_OK);
  assert.equal(broadcastCalled, false, "broadcaster tidak boleh dipanggil saat --no-broadcast");

  const output = stdoutLines.join("");
  assert.match(output, /OFF: --no-broadcast/);
});

test("startCommand: flag --no-research melewati research worker", async () => {
  let workerStarted = false;
  const stdoutLines: string[] = [];
  const ctrl = new AbortController();

  const fakeDeps: StartDeps = {
    stdout: (m) => stdoutLines.push(m),
    stderr: () => {},
    shutdownSignal: ctrl.signal,
    startPriceWorker: async () => async () => {},
    makeWorker: () => ({
      start: async () => {
        workerStarted = true;
        return true;
      },
      stop: async () => {},
    }),
    settleJob: async () => ({ totalEvaluated: 0, settled: [], insufficientData: [] }),
    makeSettleLock: async () => ({ acquired: true, release: async () => {} }),
    fusionRun: async () => fakeFusionResult as any,
    makeFusionLock: async () => ({ acquired: true, release: async () => {} }),
  };

  const runPromise = startCommand(["--no-research", "--no-color", "--no-broadcast"], fakeDeps);

  await new Promise((r) => setTimeout(r, 20));
  ctrl.abort();

  const exitCode = await runPromise;
  assert.equal(exitCode, EXIT_OK);
  assert.equal(workerStarted, false, "worker tidak boleh dimulai saat --no-research");

  const output = stdoutLines.join("");
  assert.match(output, /OFF: --no-research/);
});

test("startCommand: flag --once menjalankan satu siklus penuh lalu keluar dengan exit 0", async () => {
  let samplePriceCalled = false;
  let sampleRatesCalled = false;
  let workerStarted = false;
  let workerStopped = false;
  let fusionCalled = false;
  let settleCalled = false;

  const stdoutLines: string[] = [];

  const fakeDeps: StartDeps = {
    stdout: (m) => stdoutLines.push(m),
    stderr: () => {},
    sampleOnce: async () => {
      samplePriceCalled = true;
    },
    sampleRatesOnce: async () => {
      sampleRatesCalled = true;
    },
    makeWorker: (opts) => ({
      start: async () => {
        workerStarted = true;
        opts?.onRunCompleted?.({
          report: { id: "rep-123" },
        } as any);
        return true;
      },
      stop: async () => {
        workerStopped = true;
      },
    }),
    fusionRun: async () => {
      fusionCalled = true;
      return fakeFusionResult as any;
    },
    makeFusionLock: async () => ({
      acquired: true,
      release: async () => {},
    }),
    settleJob: async () => {
      settleCalled = true;
      return { totalEvaluated: 1, settled: [], insufficientData: [] };
    },
    makeSettleLock: async () => ({
      acquired: true,
      release: async () => {},
    }),
  };

  const exitCode = await startCommand(["--once", "--no-color", "--no-broadcast"], fakeDeps);
  assert.equal(exitCode, EXIT_OK);

  assert.ok(samplePriceCalled, "sampleOnce harus dipanggil");
  assert.ok(sampleRatesCalled, "sampleRatesOnce harus dipanggil");
  assert.ok(workerStarted, "worker start dipanggil");
  assert.ok(workerStopped, "worker stop dipanggil");
  assert.ok(fusionCalled, "fusion dipanggil setelah report sukses");
  assert.ok(settleCalled, "settle dipanggil");

  const out = stdoutLines.join("");
  assert.match(out, /Running single cycle/i);
  assert.match(out, /Single cycle finished/i);
});

test("startCommand (daemon): pid file ditulis SEBELUM run riset pertama selesai; stop membatalkan startup", async () => {
  const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
  const { existsSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { daemonPaths, runningDaemon } = await import("../../src/cli/commands/daemon.ts");

  const dir = await mkdtemp(join(tmpdir(), "tahansoe-start-daemon-"));
  const paths = daemonPaths({ TAHANSOE_DATA_DIR: dir });
  let releaseFirstRun: (() => void) | null = null;
  let workerStopped = false;
  try {
    const runPromise = startCommand(["--no-color", "--no-broadcast"], {
      env: { TAHANSOE_DAEMON: "1", DATABASE_URL: "postgres://fake" },
      daemonPaths: paths,
      exitFn: () => {},
      stdout: () => {},
      stderr: () => {},
      startPriceWorker: async () => async () => {},
      makeWorker: () => ({
        start: () =>
          new Promise<boolean>((resolve) => {
            releaseFirstRun = () => resolve(true);
          }),
        stop: async () => {
          workerStopped = true;
          releaseFirstRun?.();
        },
      }),
      settleJob: async () => ({ totalEvaluated: 0, settled: [], insufficientData: [] }),
      makeSettleLock: async () => ({ acquired: true, release: async () => {} }),
      fusionRun: async () => fakeFusionResult as any,
      makeFusionLock: async () => ({ acquired: true, release: async () => {} }),
    });

    await new Promise((r) => setTimeout(r, 50));
    assert.equal(runningDaemon(paths)?.pid, process.pid, "pid file harus ada selama run pertama berjalan");

    await writeFile(paths.stopFile, "now");
    const exitCode = await runPromise;
    assert.equal(exitCode, EXIT_OK);
    assert.equal(workerStopped, true, "stop saat startup harus menghentikan worker");
    assert.equal(existsSync(paths.pidFile), false, "pid file dibersihkan setelah shutdown");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

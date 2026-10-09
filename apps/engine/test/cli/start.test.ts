/**
 * Unit test orchestrator `tahansoe start` (spec m3-channel-gateway-telegram §1–§4, §7).
 *
 * Menguji:
 *  - start orchestrator dengan fakes: seluruh bagian dimulai (worker, price, settle, fusion, gateway).
 *  - Isolasi I6: kegagalan start gateway tidak menghentikan worker / fusi / settle.
 *  - Flag --no-gateway: gateway tidak dimulai, status line disabled.
 *  - Flag --no-research: research worker tidak dijalankan.
 *  - Flag --once: menjalankan satu siklus sampler, research, fusion, settle lalu keluar exit 0.
 *  - formatGatewayDashboardLine: formatting baris status TTY dengan berbagai kondisi.
 *  - Startup banner mencantumkan status seluruh komponen.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  startCommand,
  formatGatewayDashboardLine,
  type StartDeps,
  type GatewayStatusResult,
} from "../../src/cli/commands/start.ts";
import { EXIT_OK } from "../../src/cli/commands/args.ts";

const fakeFusionResult = {
  chainId: 42161,
  now: new Date(),
  dry: false,
  results: [{ asset: "ETH", assessment: { regime: "CALM" } as any, reasons: [] }],
  activeSignals: [],
};

test("formatGatewayDashboardLine: memformat berbagai kondisi gateway secara benar", () => {
  // 1. noGateway = true
  const lineDisabled = formatGatewayDashboardLine(null, { noGateway: true });
  assert.equal(lineDisabled, "Gateway: (disabled)");

  // 2. status not configured
  const lineNotConf = formatGatewayDashboardLine({ configured: false, channels: [] });
  assert.equal(lineNotConf, "Gateway: (not configured)");

  // 3. gateway failed to start
  const lineFailed = formatGatewayDashboardLine(
    { configured: true, channels: ["telegram"] },
    { isRunning: false },
  );
  assert.equal(lineFailed, "Gateway: (failed to start)");

  // 4. normal running dengan bot name, chats, dan last alert
  const lineActive = formatGatewayDashboardLine({
    configured: true,
    channels: ["telegram"],
    botUsername: "tahansoe_risk_bot",
    allowedChatsCount: 3,
    lastAlertAt: new Date("2026-10-09T14:30:00Z"),
  });
  assert.equal(lineActive, "Gateway: telegram @tahansoe_risk_bot, 3 chats, last alert 14:30");

  // 5. normal running tanpa alert sebelumnya
  const lineNoAlert = formatGatewayDashboardLine({
    configured: true,
    channels: ["telegram"],
    botName: "mybot",
    allowedChatsCount: 0,
    lastAlertAt: null,
  });
  assert.equal(lineNoAlert, "Gateway: telegram @mybot, 0 chats, last alert —");
});

test("startCommand: seluruh bagian berjalan (fakes) dan shutdown bersih melepas lock", async () => {
  let workerStarted = false;
  let workerStopped = false;
  let priceStarted = false;
  let priceStopped = false;
  let settleJobCalled = false;
  let fusionRunCalled = false;
  let gatewayStarted = false;
  let gatewayStopped = false;

  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];

  const ctrl = new AbortController();

  const fakeDeps: StartDeps = {
    stdout: (m) => stdoutLines.push(m),
    stderr: (m) => stderrLines.push(m),
    isTTY: true,
    shutdownSignal: ctrl.signal,
    gatewayStatus: () => ({
      configured: true,
      channels: ["telegram"],
      botUsername: "tahansoe_agent_bot",
      allowedChatsCount: 2,
      lastAlertAt: null,
    }),
    startGateway: async () => {
      gatewayStarted = true;
      return {
        stop: async () => {
          gatewayStopped = true;
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

  // Tunggu sejenak agar seluruh inisialisasi berjalan, lalu abort
  await new Promise((r) => setTimeout(r, 20));
  ctrl.abort();

  const exitCode = await runPromise;
  assert.equal(exitCode, EXIT_OK);

  // Verifikasi seluruh komponen aktif
  assert.ok(workerStarted, "research worker harus dimulai");
  assert.ok(workerStopped, "research worker harus dihentikan saat shutdown");
  assert.ok(priceStarted, "price worker harus dimulai");
  assert.ok(priceStopped, "price worker harus dihentikan saat shutdown");
  assert.ok(gatewayStarted, "gateway harus dimulai");
  assert.ok(gatewayStopped, "gateway harus dihentikan saat shutdown");
  assert.ok(settleJobCalled, "settle ticker tick pertama harus berjalan");
  assert.ok(fusionRunCalled, "fusion ticker tick pertama harus berjalan");

  // Verifikasi banner tercetak di stdout
  const output = stdoutLines.join("");
  assert.match(output, /standalone risk agent/i);
  assert.match(output, /research worker/i);
  assert.match(output, /price sampler/i);
  assert.match(output, /risk fusion/i);
  assert.match(output, /channel gateway/i);
  assert.match(output, /Gateway: telegram @tahansoe_agent_bot, 2 chats/);
});

test("startCommand: isolasi kegagalan gateway (I6) — worker dan fusi tetap berjalan normal", async () => {
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
    gatewayStatus: () => ({
      configured: true,
      channels: ["telegram"],
      botUsername: "test_bot",
    }),
    startGateway: async () => {
      throw new Error("Telegram Bot API network timeout 504");
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
  assert.equal(exitCode, EXIT_OK, "proses tidak boleh crash karena gateway gagal");

  assert.ok(workerStarted, "worker harus tetap berjalan walau gateway error");
  assert.ok(workerStopped, "worker harus stop bersih");
  assert.ok(fusionRunCalled, "fusion tetap berjalan");

  const errOutput = stderrLines.join("");
  assert.match(errOutput, /gagal start.*riset & fusi tetap berjalan/i);
});

test("startCommand: flag --no-gateway melewati gateway dan menampilkan status disabled", async () => {
  let gatewayCalled = false;
  const stdoutLines: string[] = [];
  const ctrl = new AbortController();

  const fakeDeps: StartDeps = {
    stdout: (m) => stdoutLines.push(m),
    stderr: () => {},
    isTTY: true,
    shutdownSignal: ctrl.signal,
    gatewayStatus: () => ({ configured: true, channels: ["telegram"] }),
    startGateway: async () => {
      gatewayCalled = true;
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

  const runPromise = startCommand(["--no-gateway", "--no-color"], fakeDeps);

  await new Promise((r) => setTimeout(r, 20));
  ctrl.abort();

  const exitCode = await runPromise;
  assert.equal(exitCode, EXIT_OK);
  assert.equal(gatewayCalled, false, "gateway tidak boleh dipanggil saat --no-gateway");

  const output = stdoutLines.join("");
  assert.match(output, /Gateway: \(disabled\)/);
  assert.match(output, /OFF: --no-gateway/);
});

test("startCommand: flag --no-research melewati research worker", async () => {
  let workerStarted = false;
  const stdoutLines: string[] = [];
  const ctrl = new AbortController();

  const fakeDeps: StartDeps = {
    stdout: (m) => stdoutLines.push(m),
    stderr: () => {},
    shutdownSignal: ctrl.signal,
    gatewayStatus: () => ({ configured: false, channels: [] }),
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

  const runPromise = startCommand(["--no-research", "--no-color"], fakeDeps);

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
        // Simulasikan penghasilan report
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

  const exitCode = await startCommand(["--once", "--no-color"], fakeDeps);
  assert.equal(exitCode, EXIT_OK);

  assert.ok(samplePriceCalled, "sampleOnce harus dipanggil");
  assert.ok(sampleRatesCalled, "sampleRatesOnce harus dipanggil");
  assert.ok(workerStarted, "worker start dipanggil");
  assert.ok(workerStopped, "worker stop dipanggil");
  assert.ok(fusionCalled, "fusion dipanggil setelah report sukses");
  assert.ok(settleCalled, "settle dipanggil");

  const out = stdoutLines.join("");
  assert.match(out, /running single cycle/);
  assert.match(out, /single cycle completed/);
});

test("startCommand: gateway mendeteksi webhook_active mencetak pesan instruktif tanpa mematikan riset", async () => {
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  const shutdownController = new AbortController();

  const fakeDeps: StartDeps = {
    stdout: (m) => stdoutLines.push(m),
    stderr: (m) => stderrLines.push(m),
    env: { TELEGRAM_BOT_TOKEN: "fake_token_wh" },
    gatewayStatus: async () => ({
      configured: true,
      channels: ["telegram"],
      botUsername: "WebhookBot",
    }),
    startGateway: async () => {
      // Simulasikan status webhook_active
      return {
        stop: async () => {},
        status: "webhook_active",
        webhookHost: "n8n.workflow.io",
      } as any;
    },
    startPriceWorker: async () => async () => {},
    shutdownSignal: shutdownController.signal,
  };

  setTimeout(() => shutdownController.abort(), 20);

  const exitCode = await startCommand(["--no-research", "--no-fusion", "--no-settle", "--no-color"], fakeDeps);
  assert.equal(exitCode, EXIT_OK);

  const combined = stdoutLines.concat(stderrLines).join("");
  assert.match(
    combined,
    /This bot uses a webhook to n8n\.workflow\.io\. Messages go there, not to Tahansoe\. Use a dedicated bot, or run: tahansoe gateway pair --delete-webhook/,
  );
});

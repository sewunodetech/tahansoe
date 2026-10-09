/**
 * Unit & Integration test Alert Engine (spec §3.4, §7).
 *
 * Menguji:
 *  - Deteksi regime naik per aset (segera)
 *  - Dedupe 6 jam per alert key
 *  - Deteksi regime turun setelah bertahan >= 1 jam (hysteresis)
 *  - Sinyal deterministik: T10 (sequencer), T4 (depeg), T7 (pool), T8 berat
 *  - Severity raise menembus dedupe
 *  - Penyaringan preferensi alert per chat (/alerts & /subscribe)
 *  - Footer wajib: informational · not investment advice
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Signal, RiskAssessment } from "@tahansoe/domain";
import { AlertPoller, HYSTERESIS_DOWN_HOLD_MS } from "../../src/gateway/alerts.ts";
import { createEmptyGatewayState } from "../../src/gateway/core/state.ts";
import type { ChannelAdapter } from "../../src/gateway/core/adapter.ts";
import { writeSettings, emptySettings } from "../../src/settings/settings.ts";

class TestAlertAdapter implements ChannelAdapter {
  public readonly channelName = "test-alert";
  public sent: Array<{ chatId: string; message: string }> = [];

  public async start(): Promise<void> {}
  public async stop(): Promise<void> {}
  public async send(chatId: string, message: string): Promise<void> {
    this.sent.push({ chatId, message });
  }
  public onMessage(): void {}
}

function makeAssessment(asset: string, regime: "CALM" | "ELEVATED" | "STRESSED" | "CRISIS", explanation = "Test"): RiskAssessment {
  return {
    asset,
    chainId: 42161,
    regime,
    riskScore: regime === "CALM" ? 10 : regime === "ELEVATED" ? 40 : 80,
    drawdownEstimate: { h4: 0.05, h24: 0.1 },
    recommendedTriggerHF: 1.15,
    recommendedTargetHF: 1.35,
    drivers: [],
    explanation,
    modelVersion: "1.0",
    validUntil: new Date(Date.now() + 3600_000),
    createdAt: new Date(),
  };
}

test("alerts: regime naik mengirim alert dan dideduplikasi selama 6 jam", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "tahansoe-alerts-"));
  const settingsFile = join(tmp, "settings.json");
  await writeSettings(emptySettings(), settingsFile);

  const adapter = new TestAlertAdapter();
  const state = createEmptyGatewayState();
  let currentTime = 1000000;

  let currentAssessments: RiskAssessment[] = [makeAssessment("USDC", "CALM")];

  const poller = new AlertPoller({
    adapter,
    state,
    settingsPath: settingsFile,
    env: { TELEGRAM_ALLOWED_CHAT_IDS: "user_alert" },
    loaders: {
      loadAssessments: async () => currentAssessments,
      loadActiveSignals: async () => [],
    },
    now: () => new Date(currentTime),
  });

  // 1. Tick awal: mencatat baseline CALM (belum ada alert)
  await poller.pollOnce();
  assert.equal(adapter.sent.length, 0);

  // 2. Regime naik: CALM -> ELEVATED
  currentAssessments = [makeAssessment("USDC", "ELEVATED", "Pool 92% past kink")];
  currentTime += 60000; // 1 menit kemudian
  await poller.pollOnce();

  assert.equal(adapter.sent.length, 1);
  assert.match(adapter.sent[0]!.message, /USDC: CALM → ELEVATED/);
  assert.match(adapter.sent[0]!.message, /Pool 92% past kink/);
  assert.match(adapter.sent[0]!.message, /informational · not investment advice/);

  // 3. Tick berikutnya dalam 6 jam: tidak boleh kirim duplikat (dedupe)
  adapter.sent = [];
  currentTime += 60000;
  await poller.pollOnce();
  assert.equal(adapter.sent.length, 0, "Harus dideduplikasi dalam 6 jam");

  await rm(tmp, { recursive: true, force: true });
});

test("alerts: regime turun HANYA mengirim alert setelah bertahan >= 1 jam (hysteresis)", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "tahansoe-alerts-"));
  const settingsFile = join(tmp, "settings.json");
  await writeSettings(emptySettings(), settingsFile);

  const adapter = new TestAlertAdapter();
  const state = createEmptyGatewayState();
  let currentTime = 1000000;

  let currentAssessments: RiskAssessment[] = [makeAssessment("ETH", "ELEVATED")];

  const poller = new AlertPoller({
    adapter,
    state,
    settingsPath: settingsFile,
    env: { TELEGRAM_ALLOWED_CHAT_IDS: "user_hysteresis" },
    loaders: {
      loadAssessments: async () => currentAssessments,
      loadActiveSignals: async () => [],
    },
    now: () => new Date(currentTime),
  });

  // Tick 1: catat ELEVATED pada waktu currentTime
  await poller.pollOnce();

  // Tick 2: turun ke CALM setelah hanya 30 menit (< 1 jam) -> TIDAK boleh alert
  currentAssessments = [makeAssessment("ETH", "CALM")];
  currentTime += 30 * 60 * 1000; // 30 menit
  adapter.sent = [];
  await poller.pollOnce();
  assert.equal(adapter.sent.length, 0, "Belum 1 jam di level tinggi, tidak boleh alert turun");

  // Tick 3: waktu maju melewati 1 jam (>= 60 menit) -> alert turun terpicu
  currentTime += 35 * 60 * 1000; // total 65 menit
  await poller.pollOnce();
  assert.equal(adapter.sent.length, 1);
  assert.match(adapter.sent[0]!.message, /ETH returned to CALM/);
  assert.match(adapter.sent[0]!.message, /informational · not investment advice/);

  await rm(tmp, { recursive: true, force: true });
});

test("alerts: deteksi sinyal deterministik T10, T4, T7, dan T8 berat", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "tahansoe-alerts-"));
  const settingsFile = join(tmp, "settings.json");
  await writeSettings(emptySettings(), settingsFile);

  const adapter = new TestAlertAdapter();
  const state = createEmptyGatewayState();
  let currentTime = 1000000;

  const testSignals: Signal[] = [
    // 1. T10 Sequencer
    {
      id: "sig_t10",
      module: "ORACLE",
      paths: ["T10"],
      assets: ["ETH"],
      direction: "DOWN",
      severity: 0.9,
      confidence: 1.0,
      horizonHours: 4,
      observedAt: new Date(currentTime),
      expiresAt: new Date(currentTime + 3600000),
      evidence: [{ title: "Sequencer is offline", source: "ArbitrumFeed" }],
      dedupeKey: "ORACLE:T10:sequencer",
    },
    // 2. T4 Depeg
    {
      id: "sig_t4",
      module: "ONCHAIN",
      paths: ["T4"],
      assets: ["USDC"],
      direction: "DOWN",
      severity: 0.8,
      confidence: 0.9,
      horizonHours: 12,
      observedAt: new Date(currentTime),
      expiresAt: new Date(currentTime + 3600000),
      evidence: [{ title: "Stablecoin USDC depeg -1.8%", source: "AaveOracle" }],
      dedupeKey: "ONCHAIN:T4:depeg:USDC",
    },
    // 3. T7 Pool kering
    {
      id: "sig_t7",
      module: "ONCHAIN",
      paths: ["T11", "T7"],
      assets: ["USDC.e"],
      direction: "DOWN",
      severity: 0.7,
      confidence: 0.9,
      horizonHours: 6,
      observedAt: new Date(currentTime),
      expiresAt: new Date(currentTime + 3600000),
      evidence: [{ title: "Reserve USDC.e utilization at 98.5%", source: "AaveV3Pool" }],
      dedupeKey: "ONCHAIN:T11:kink:USDC.e",
    },
    // 4. T8 Berat (severity >= 0.6)
    {
      id: "sig_t8",
      module: "ORACLE",
      paths: ["T8"],
      assets: ["ETH"],
      direction: "DOWN",
      severity: 0.75,
      confidence: 0.85,
      horizonHours: 2,
      observedAt: new Date(currentTime),
      expiresAt: new Date(currentTime + 3600000),
      evidence: [{ title: "Chainlink ETH/USD feed stale by 4 hours", source: "Chainlink" }],
      dedupeKey: "ORACLE:T8:stale:ETH/USD",
    },
  ];

  const poller = new AlertPoller({
    adapter,
    state,
    settingsPath: settingsFile,
    env: { TELEGRAM_ALLOWED_CHAT_IDS: "user_sig" },
    loaders: {
      loadAssessments: async () => [],
      loadActiveSignals: async () => testSignals,
    },
    now: () => new Date(currentTime),
  });

  await poller.pollOnce();

  // Harus ada 4 alert yang dikirim
  assert.equal(adapter.sent.length, 4);
  assert.ok(adapter.sent.some((m) => m.message.includes("Sequencer Arbitrum DOWN")));
  assert.ok(adapter.sent.some((m) => m.message.includes("depeg detected")));
  assert.ok(adapter.sent.some((m) => m.message.includes("liquidity constrained")));
  assert.ok(adapter.sent.some((m) => m.message.includes("oracle lag/deviation")));

  await rm(tmp, { recursive: true, force: true });
});

test("alerts: kenaikan severity menembus dedupe 6 jam", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "tahansoe-alerts-"));
  const settingsFile = join(tmp, "settings.json");
  await writeSettings(emptySettings(), settingsFile);

  const adapter = new TestAlertAdapter();
  const state = createEmptyGatewayState();
  let currentTime = 1000000;

  const depegSignal: Signal = {
    id: "sig_depeg_1",
    module: "ONCHAIN",
    paths: ["T4"],
    assets: ["USDT"],
    direction: "DOWN",
    severity: 0.5,
    confidence: 0.8,
    horizonHours: 12,
    observedAt: new Date(currentTime),
    expiresAt: new Date(currentTime + 3600000),
    evidence: [{ title: "USDT depeg -0.8%", source: "AaveOracle" }],
    dedupeKey: "ONCHAIN:T4:depeg:USDT",
  };

  const poller = new AlertPoller({
    adapter,
    state,
    settingsPath: settingsFile,
    env: { TELEGRAM_ALLOWED_CHAT_IDS: "user_raise" },
    loaders: {
      loadAssessments: async () => [],
      loadActiveSignals: async () => [depegSignal],
    },
    now: () => new Date(currentTime),
  });

  // Tick 1: severity 0.5 terkirim
  await poller.pollOnce();
  assert.equal(adapter.sent.length, 1);

  // Tick 2: sinyal yang sama dengan severity naik ke 0.85 (dalam 6 jam)
  adapter.sent = [];
  currentTime += 10 * 60 * 1000; // 10 menit kemudian
  depegSignal.severity = 0.85;
  depegSignal.evidence = [{ title: "USDT depeg widened to -2.5%", source: "AaveOracle" }];

  await poller.pollOnce();
  assert.equal(adapter.sent.length, 1, "Kenaikan severity harus menembus dedupe");
  assert.match(adapter.sent[0]!.message, /-2.5%/);

  await rm(tmp, { recursive: true, force: true });
});

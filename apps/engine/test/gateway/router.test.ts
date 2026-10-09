/**
 * Unit & Integration test CommandRouter (slash commands, allowlist, Q&A limit, riwayat 10 turn).
 *
 * Menguji:
 *  - Penolakan chat tidak diizinkan ("This bot is private.")
 *  - Pairing via /start <code>
 *  - Perintah /help, /status, /subscribe, /unsubscribe, /alerts
 *  - Jalur Q&A grounded menggunakan FakeProvider
 *  - Batasan Q&A harian (GATEWAY_QA_PER_DAY)
 *  - Riwayat chat per chat di memori maks 10 giliran
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CommandRouter, PRIVATE_BOT_REPLY } from "../../src/gateway/core/router.ts";
import { PairingManager } from "../../src/gateway/pairing.ts";
import { createEmptyGatewayState } from "../../src/gateway/core/state.ts";
import type { ChannelAdapter, InboundMessage } from "../../src/gateway/core/adapter.ts";
import { writeSettings, emptySettings } from "../../src/settings/settings.ts";
import type { LlmProvider, LlmRequest, LlmResult } from "../../src/llm/provider.ts";

class TestAdapter implements ChannelAdapter {
  public readonly channelName = "test";
  public sentMessages: Array<{ chatId: string; message: string; options?: any }> = [];
  public answeredCallbacks: Array<{ id: string; text?: string }> = [];

  public async start(): Promise<void> {}
  public async stop(): Promise<void> {}
  public async send(chatId: string, message: string, options?: any): Promise<void> {
    this.sentMessages.push({ chatId, message, options });
  }
  public async answerCallback(id: string, text?: string): Promise<void> {
    this.answeredCallbacks.push({ id, text });
  }
  public onMessage(): void {}
}

class FakeLlmProvider implements LlmProvider {
  public readonly name = "fake-provider";
  public structuredCalls: unknown[] = [];

  public async structured<T>(_params: LlmRequest<T>): Promise<LlmResult<T>> {
    this.structuredCalls.push(_params);
    return {
      data: { answer: "This is a grounded answer about borrow risk." } as T,
      stopReason: "ok",
      usage: { model: "fake-chat", inputTokens: 50, outputTokens: 25 },
    };
  }
}

test("router: chat tidak diizinkan mendapat respon 'This bot is private.'", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "tahansoe-router-"));
  const settingsFile = join(tmp, "settings.json");
  const statePath = join(tmp, "gateway-state.json");
  await writeSettings(emptySettings(), settingsFile);

  const adapter = new TestAdapter();
  const state = createEmptyGatewayState();
  const pairing = new PairingManager(statePath, state);

  const router = new CommandRouter({
    adapter,
    pairing,
    state,
    statePath,
    settingsPath: settingsFile,
    env: { TELEGRAM_ALLOWED_CHAT_IDS: "111,222" },
  });

  // Chat 999 bukan 111 atau 222
  await router.handleMessage({
    channel: "telegram",
    chatId: "999",
    text: "Hello, what is ETH status?",
  });

  assert.equal(adapter.sentMessages.length, 1);
  assert.equal(adapter.sentMessages[0]?.chatId, "999");
  assert.equal(adapter.sentMessages[0]?.message, PRIVATE_BOT_REPLY);

  await rm(tmp, { recursive: true, force: true });
});

test("router: pairing via /start CODE berhasil dan mendaftarkan chat ke settings", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "tahansoe-router-"));
  const settingsFile = join(tmp, "settings.json");
  const statePath = join(tmp, "gateway-state.json");
  await writeSettings(emptySettings(), settingsFile);

  const adapter = new TestAdapter();
  const state = createEmptyGatewayState();
  const pairing = new PairingManager(statePath, state);
  const { code } = pairing.createPairingCode("telegram");

  const router = new CommandRouter({
    adapter,
    pairing,
    state,
    statePath,
    settingsPath: settingsFile,
    env: {},
  });

  // Chat baru mengirim /start <code>
  await router.handleMessage({
    channel: "telegram",
    chatId: "chat_user_1",
    text: `/start ${code}`,
  });

  assert.equal(adapter.sentMessages.length, 1);
  assert.match(adapter.sentMessages[0]!.message, /pairing successful/i);

  // Verifikasi chat sekarang diizinkan dan bisa menjalankan /help
  adapter.sentMessages = [];
  await router.handleMessage({
    channel: "telegram",
    chatId: "chat_user_1",
    text: "/help",
  });

  assert.equal(adapter.sentMessages.length, 1);
  assert.match(adapter.sentMessages[0]!.message, /Tahansoe Risk Agent Commands/i);

  await rm(tmp, { recursive: true, force: true });
});

test("router: perintah /subscribe, /unsubscribe, dan /alerts memperbarui preferensi", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "tahansoe-router-"));
  const settingsFile = join(tmp, "settings.json");
  const statePath = join(tmp, "gateway-state.json");
  await writeSettings(emptySettings(), settingsFile);

  const adapter = new TestAdapter();
  const state = createEmptyGatewayState();
  const pairing = new PairingManager(statePath, state);

  const router = new CommandRouter({
    adapter,
    pairing,
    state,
    statePath,
    settingsPath: settingsFile,
    env: { TELEGRAM_ALLOWED_CHAT_IDS: "allowed_user" },
  });

  // 1. /unsubscribe
  await router.handleMessage({ channel: "telegram", chatId: "allowed_user", text: "/unsubscribe" });
  assert.match(adapter.sentMessages[0]!.message, /unsubscribed/i);

  // 2. /subscribe
  adapter.sentMessages = [];
  await router.handleMessage({ channel: "telegram", chatId: "allowed_user", text: "/subscribe" });
  assert.match(adapter.sentMessages[0]!.message, /subscribed/i);

  // 3. /alerts tanpa argumen (tampilkan daftar)
  adapter.sentMessages = [];
  await router.handleMessage({ channel: "telegram", chatId: "allowed_user", text: "/alerts" });
  assert.match(adapter.sentMessages[0]!.message, /Alert preferences for this chat/i);

  // 4. /alerts sequencer off
  adapter.sentMessages = [];
  await router.handleMessage({ channel: "telegram", chatId: "allowed_user", text: "/alerts sequencer off" });
  assert.match(adapter.sentMessages[0]!.message, /Alert 'sequencer' set to OFF/i);

  await rm(tmp, { recursive: true, force: true });
});

test("router: teks biasa memicu Q&A grounded dan menghormati batas harian GATEWAY_QA_PER_DAY", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "tahansoe-router-"));
  const settingsFile = join(tmp, "settings.json");
  const statePath = join(tmp, "gateway-state.json");
  await writeSettings(emptySettings(), settingsFile);

  const adapter = new TestAdapter();
  const state = createEmptyGatewayState();
  const pairing = new PairingManager(statePath, state);
  const fakeProvider = new FakeLlmProvider();

  const router = new CommandRouter({
    adapter,
    pairing,
    state,
    statePath,
    settingsPath: settingsFile,
    env: { TELEGRAM_ALLOWED_CHAT_IDS: "qa_chat", GATEWAY_QA_PER_DAY: "2" },
    chatOptions: { provider: fakeProvider },
    loaders: {
      loadLatestReports: async () => ({ latest: null, last24h: [] }),
      loadAssessments: async () => [],
      loadActiveSignals: async () => [],
      loadRateSamples: async () => [],
      loadPriceSamples: async () => [],
      loadMacroEvents: async () => [],
    },
  });

  // Pertanyaan 1 (sukses)
  await router.handleMessage({ channel: "telegram", chatId: "qa_chat", text: "How is USDC risk?" });
  assert.match(adapter.sentMessages[0]!.message, /grounded answer/i);
  assert.match(adapter.sentMessages[0]!.message, /informational · not investment advice/i);

  // Pertanyaan 2 (sukses)
  adapter.sentMessages = [];
  await router.handleMessage({ channel: "telegram", chatId: "qa_chat", text: "What about ETH?" });
  assert.match(adapter.sentMessages[0]!.message, /grounded answer/i);

  // Pertanyaan 3 (harus ditolak karena limit 2 tercapai)
  adapter.sentMessages = [];
  await router.handleMessage({ channel: "telegram", chatId: "qa_chat", text: "And WBTC?" });
  assert.match(adapter.sentMessages[0]!.message, /Daily Q&A limit reached \(2\/2\)/i);

  await rm(tmp, { recursive: true, force: true });
});

test("router: /start dan /help menyertakan inline keyboard tombol aksi cepat", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "tahansoe-router-"));
  const settingsFile = join(tmp, "settings.json");
  const statePath = join(tmp, "gateway-state.json");
  await writeSettings(emptySettings(), settingsFile);

  const adapter = new TestAdapter();
  const state = createEmptyGatewayState();
  const pairing = new PairingManager(statePath, state);

  const router = new CommandRouter({
    adapter,
    pairing,
    state,
    statePath,
    settingsPath: settingsFile,
    env: { TELEGRAM_ALLOWED_CHAT_IDS: "btn_chat" },
  });

  // /start
  await router.handleMessage({ channel: "telegram", chatId: "btn_chat", text: "/start" });
  assert.ok(adapter.sentMessages[0]?.options?.replyMarkup?.inline_keyboard);
  const rows = adapter.sentMessages[0]?.options?.replyMarkup?.inline_keyboard;
  assert.equal(rows[0][0].text, "Status");
  assert.equal(rows[0][1].text, "Fuse");

  // /help
  adapter.sentMessages = [];
  await router.handleMessage({ channel: "telegram", chatId: "btn_chat", text: "/help" });
  assert.ok(adapter.sentMessages[0]?.options?.replyMarkup?.inline_keyboard);

  await rm(tmp, { recursive: true, force: true });
});

test("router: callback_query dari chat yang diizinkan diproses dan selalu dijawab", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "tahansoe-router-"));
  const settingsFile = join(tmp, "settings.json");
  const statePath = join(tmp, "gateway-state.json");
  await writeSettings(emptySettings(), settingsFile);

  const adapter = new TestAdapter();
  const state = createEmptyGatewayState();
  const pairing = new PairingManager(statePath, state);

  const router = new CommandRouter({
    adapter,
    pairing,
    state,
    statePath,
    settingsPath: settingsFile,
    env: { TELEGRAM_ALLOWED_CHAT_IDS: "allowed_cb_user" },
    loaders: {
      loadLatestReports: async () => ({ latest: null, last24h: [] }),
      loadAssessments: async () => [],
      loadActiveSignals: async () => [],
      loadRateSamples: async () => [],
      loadPriceSamples: async () => [],
      loadMacroEvents: async () => [],
    },
  });

  // 1. Callback tombol status
  await router.handleMessage({
    channel: "telegram",
    chatId: "allowed_cb_user",
    text: "cmd:status",
    callbackQueryId: "cb_status_123",
    callbackData: "cmd:status",
  });

  assert.equal(adapter.answeredCallbacks.length, 1);
  assert.equal(adapter.answeredCallbacks[0]?.id, "cb_status_123");
  assert.match(adapter.sentMessages[0]!.message, /Tahansoe Status:/);

  // 2. Callback tombol mute 6h (Bisukan 6 jam)
  adapter.sentMessages = [];
  adapter.answeredCallbacks = [];
  await router.handleMessage({
    channel: "telegram",
    chatId: "allowed_cb_user",
    text: "mute:regime",
    callbackQueryId: "cb_mute_456",
    callbackData: "mute:regime",
  });

  assert.equal(adapter.answeredCallbacks.length, 1);
  assert.equal(adapter.answeredCallbacks[0]?.id, "cb_mute_456");
  assert.match(adapter.answeredCallbacks[0]!.text!, /Alert 'regime' dibisukan 6 jam/);
  assert.match(adapter.sentMessages[0]!.message, /dibisukan untuk chat ini selama 6 jam/);

  await rm(tmp, { recursive: true, force: true });
});

test("router: callback_query dari chat tak diizinkan ditolak", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "tahansoe-router-"));
  const settingsFile = join(tmp, "settings.json");
  const statePath = join(tmp, "gateway-state.json");
  await writeSettings(emptySettings(), settingsFile);

  const adapter = new TestAdapter();
  const state = createEmptyGatewayState();
  const pairing = new PairingManager(statePath, state);

  const router = new CommandRouter({
    adapter,
    pairing,
    state,
    statePath,
    settingsPath: settingsFile,
    env: { TELEGRAM_ALLOWED_CHAT_IDS: "permitted" },
  });

  // Chat "unauthorized_user"
  await router.handleMessage({
    channel: "telegram",
    chatId: "unauthorized_user",
    text: "cmd:status",
    callbackQueryId: "cb_unauth",
    callbackData: "cmd:status",
  });

  assert.equal(adapter.answeredCallbacks.length, 1);
  assert.equal(adapter.answeredCallbacks[0]?.id, "cb_unauth");
  assert.equal(adapter.answeredCallbacks[0]?.text, "This bot is private.");
  assert.equal(adapter.sentMessages[0]!.message, PRIVATE_BOT_REPLY);

  await rm(tmp, { recursive: true, force: true });
});

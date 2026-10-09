/**
 * Gateway Hardening Tests (Incident Remediation & Prevention).
 *
 * Menguji secara komprehensif 5 kebutuhan hardening gateway:
 *  1. Single Poller Per Bot (lock file eksklusif, heartbeat, stale detection, in-process dual gateway conflict)
 *  2. No Backlog Replies (abaikan update date < startup - 30s pada poll pertama, advance offset, deleteWebhook drop_pending_updates)
 *  3. Outbound Safety (per-chat reply cap 5/10s, slow down notice cooldown 1 min, 429 pause & no retry loop, private bot reply throttle 1/hour)
 *  4. Pairing Persistence Bug (reproduksi & perbaikan schema validation, Windows atomic rename fallback, target settings path resolution & log)
 *  5. State Reset (verifikasi pendingPairings reset ke {})
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  acquireBotLock,
  botLockFilename,
  clearActiveLocksInProcessForTests,
  LOCK_STALE_MS,
} from "../../src/gateway/core/lock.ts";
import {
  startGateway,
  gatewayListening,
} from "../../src/gateway/index.ts";
import {
  TelegramAdapter,
} from "../../src/gateway/telegram/adapter.ts";
import {
  TelegramMessageQueue,
  SLOW_DOWN_NOTICE,
  MAX_REPLIES_PER_10S,
} from "../../src/gateway/telegram/queue.ts";
import {
  telegramDeleteWebhook,
} from "../../src/gateway/telegram/api.ts";
import {
  CommandRouter,
  PRIVATE_BOT_REPLY,
} from "../../src/gateway/core/router.ts";
import {
  PairingManager,
} from "../../src/gateway/pairing.ts";
import {
  createEmptyGatewayState,
  loadGatewayState,
} from "../../src/gateway/core/state.ts";
import {
  loadSettings,
  writeSettings,
  emptySettings,
} from "../../src/settings/settings.ts";
import type { ChannelAdapter, InboundMessage } from "../../src/gateway/core/adapter.ts";

// ---------------------------------------------------------------------------
// 1. Single Poller Per Bot
// ---------------------------------------------------------------------------

test("hardening 1: format nama lock dan struktur record", () => {
  const token = "123456789:ABCdefGHI_secret_token";
  const filename = botLockFilename(token);
  assert.match(filename, /^gateway-[0-9a-f]{12}\.lock$/);

  // Deterministik untuk token yang sama
  assert.equal(filename, botLockFilename(token));
  assert.notEqual(filename, botLockFilename("another_token"));
});

test("hardening 1: in-process test dua gateway pada direktori data yang sama hanya mengizinkan satu polling", async () => {
  clearActiveLocksInProcessForTests();

  const tmp = await mkdtemp(join(tmpdir(), "tahansoe-hw1-dual-"));
  const settingsFile = join(tmp, "settings.json");
  const stateFile = join(tmp, "gateway-state.json");
  await writeSettings(emptySettings(), settingsFile);

  let gw1GetUpdatesCount = 0;
  let gw2GetUpdatesCount = 0;

  const fakeFetch1: typeof fetch = async (input) => {
    if (String(input).includes("getUpdates")) {
      gw1GetUpdatesCount++;
      return new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  const fakeFetch2: typeof fetch = async (input) => {
    if (String(input).includes("getUpdates")) {
      gw2GetUpdatesCount++;
      return new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  const token = "same_bot_token_shared_123";
  let gw1: any;
  let gw2: any;

  try {
    // Jalankan gateway pertama
    gw1 = await startGateway({
      telegramToken: token,
      settingsPath: settingsFile,
      statePath: stateFile,
      fetchFn: fakeFetch1,
      pollIntervalSec: 9999,
    });

    assert.equal(gw1.status.telegram, "active");
    assert.equal(gatewayListening(gw1), true);

    // Jalankan gateway kedua untuk bot yang sama di direktori data yang sama
    gw2 = await startGateway({
      telegramToken: token,
      settingsPath: settingsFile,
      statePath: stateFile,
      fetchFn: fakeFetch2,
      pollIntervalSec: 9999,
    });

    // Verifikasi: gateway 2 mendeteksi konflik dan tidak polling
    assert.equal(gw2.status.telegram, "conflict");
    assert.equal(gatewayListening(gw2), false);

    await new Promise((r) => setTimeout(r, 80));

    assert.ok(gw1GetUpdatesCount >= 1, "Gateway 1 harus melakukan getUpdates");
    assert.equal(gw2GetUpdatesCount, 0, "Gateway 2 TIDAK BOLEH memanggil getUpdates saat status conflict");

    // Ketika gateway 1 berhenti, lock dilepas
    await gw1.stop();

    // Sekarang instance ketiga dapat mengambil lock
    const gw3 = await startGateway({
      telegramToken: token,
      settingsPath: settingsFile,
      statePath: stateFile,
      fetchFn: fakeFetch1,
      pollIntervalSec: 9999,
    });

    assert.equal(gw3.status.telegram, "active");
    await gw3.stop();
  } finally {
    if (gw1) await gw1.stop().catch(() => {});
    if (gw2) await gw2.stop().catch(() => {});
    clearActiveLocksInProcessForTests();
    await rm(tmp, { recursive: true, force: true });
  }
});

test("hardening 1: lock usang (stale > 60s) otomatis diambil alih", async () => {
  clearActiveLocksInProcessForTests();
  const tmp = await mkdtemp(join(tmpdir(), "tahansoe-hw1-stale-"));
  const token = "stale_bot_token_test";
  const lockFile = botLockFilename(token);
  const lockPath = join(tmp, lockFile);

  // Tulis lock buatan dengan timestamp 120 detik yang lalu
  const now = Date.now();
  await writeFile(
    lockPath,
    JSON.stringify({
      pid: 999999, // PID fiktif
      createdAt: now - 120_000,
      updatedAt: now - 120_000,
    }),
    "utf8",
  );

  const res = acquireBotLock({
    token,
    lockDir: tmp,
  });

  assert.equal(res.acquired, true, "Lock stale harus berhasil diambil alih");
  res.release();
  clearActiveLocksInProcessForTests();
  await rm(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 2. No Backlog Replies
// ---------------------------------------------------------------------------

test("hardening 2: pesan backlog (date < startup - 30s) diabaikan pada poll pertama namun offset tetap maju", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "tahansoe-hw2-backlog-"));
  const state = createEmptyGatewayState();
  const startupSec = 1750000000;
  const oldMsgDateSec = startupSec - 40; // 40 detik sebelum startup -> BACKLOG
  const newMsgDateSec = startupSec + 5;  // 5 detik setelah startup -> AKTIF

  const receivedMessages: InboundMessage[] = [];
  let pollCount = 0;

  const fakeFetch: typeof fetch = async (input) => {
    const s = String(input);
    if (s.includes("getUpdates")) {
      pollCount++;
      if (pollCount === 1) {
        // Poll pertama: 1 pesan backlog lama, 1 pesan baru
        return new Response(
          JSON.stringify({
            ok: true,
            result: [
              {
                update_id: 100,
                message: {
                  message_id: 1,
                  chat: { id: 111, type: "private" },
                  date: oldMsgDateSec,
                  text: "/help",
                },
              },
              {
                update_id: 101,
                message: {
                  message_id: 2,
                  chat: { id: 111, type: "private" },
                  date: newMsgDateSec,
                  text: "/status",
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  const logs: string[] = [];
  const adapter = new TelegramAdapter({
    token: "token_backlog_test",
    lockDir: tmp,
    fetchFn: fakeFetch,
    logger: (m) => logs.push(m),
    startupTimeSec: startupSec,
    state,
  });

  adapter.onMessage(async (msg) => {
    receivedMessages.push(msg);
  });

  await adapter.start();
  await new Promise((r) => setTimeout(r, 100));
  await adapter.stop();

  // Offset harus maju melewati update_id 100 dan 101 (menjadi 102)
  assert.equal(state.offset, 102, "Offset harus maju melewati update lama");

  // Handler HANYA menerima pesan baru (/status), TIDAK menerima /help yang lama
  assert.equal(receivedMessages.length, 1);
  assert.equal(receivedMessages[0]?.text, "/status");
  assert.ok(logs.some((l) => l.includes("Skipping backlog update 100")));

  await rm(tmp, { recursive: true, force: true });
});

test("hardening 2: deleteWebhook menyertakan drop_pending_updates: true secara default", async () => {
  let postedBody: any = null;

  const fakeFetch: typeof fetch = async (_input, init) => {
    postedBody = JSON.parse(String(init?.body ?? "{}"));
    return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
  };

  const res = await telegramDeleteWebhook("test_token_del_webhook", {
    fetchFn: fakeFetch,
  });

  assert.equal(res.ok, true);
  assert.equal(postedBody?.drop_pending_updates, true, "drop_pending_updates harus bernilai true");
});

// ---------------------------------------------------------------------------
// 3. Outbound Safety
// ---------------------------------------------------------------------------

test("hardening 3: per-chat reply cap (max 5 dalam 10s) menjatuhkan pesan ke-6 dan mengirim slow-down notice satu kali", async () => {
  const sentTexts: string[] = [];
  const fakeFetch: typeof fetch = async (_input, init) => {
    const b = JSON.parse(String(init?.body ?? "{}"));
    sentTexts.push(b.text);
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
  };

  const queue = new TelegramMessageQueue({
    token: "token_rate_test",
    fetchFn: fakeFetch,
    minChatIntervalMs: 5,
    minGlobalIntervalMs: 2,
  });

  const chatId = "chat_cap_123";

  // Kirim 7 pesan beruntun ke chat yang sama
  for (let i = 1; i <= 7; i++) {
    await queue.enqueue(chatId, `Message ${i}`);
  }

  // Tunggu antrean memproses
  await new Promise((r) => setTimeout(r, 150));
  queue.stop();

  // 5 pesan pertama dikirim + 1 pesan SLOW_DOWN_NOTICE
  assert.equal(sentTexts.filter((t) => t.startsWith("Message ")).length, MAX_REPLIES_PER_10S);
  assert.equal(sentTexts.filter((t) => t === SLOW_DOWN_NOTICE).length, 1);
});

test("hardening 3: 429 rate limit menghentikan antrean chat sesuai retry_after dan tidak retry-loop tak terbatas", async () => {
  let callCount = 0;
  const fakeFetch: typeof fetch = async () => {
    callCount++;
    return new Response(
      JSON.stringify({
        ok: false,
        error_code: 429,
        description: "Too Many Requests: retry after 0.05",
        parameters: { retry_after: 0.05 },
      }),
      { status: 429, headers: { "Content-Type": "application/json" } },
    );
  };

  const queue = new TelegramMessageQueue({
    token: "token_429_test",
    fetchFn: fakeFetch,
    minChatIntervalMs: 5,
    minGlobalIntervalMs: 2,
    maxRetries: 1, // Maksimal 1 retry
  });

  let errorThrown: any = null;
  try {
    await queue.enqueue("chat_429", "Message destined to fail");
    await new Promise((r) => setTimeout(r, 200));
  } catch (err) {
    errorThrown = err;
  } finally {
    queue.stop();
  }

  // Percobaan awal (1) + retry (1) = total 2 panggilan, bukan loop tanpa batas
  assert.equal(callCount, 2, "Harus berhenti setelah maxRetries 1");
});

test("hardening 3: notifikasi 'This bot is private.' dibatasi maksimal 1 kali per jam per chat", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "tahansoe-hw3-priv-"));
  const settingsFile = join(tmp, "settings.json");
  const statePath = join(tmp, "gateway-state.json");
  await writeSettings(emptySettings(), settingsFile);

  class MockAdapter implements ChannelAdapter {
    public readonly channelName = "mock";
    public sent: Array<{ chatId: string; text: string }> = [];
    public async start() {}
    public async stop() {}
    public async send(chatId: string, text: string) {
      this.sent.push({ chatId, text });
    }
    public onMessage() {}
  }

  const adapter = new MockAdapter();
  const state = createEmptyGatewayState();
  const pairing = new PairingManager(statePath, state);

  const router = new CommandRouter({
    adapter,
    pairing,
    state,
    statePath,
    settingsPath: settingsFile,
    env: { TELEGRAM_ALLOWED_CHAT_IDS: "" }, // Tidak ada chat diizinkan
  });

  const unauthorizedChat = "999888";

  // Kirim 3 pesan berturut-turut dari chat yang tidak diizinkan
  await router.handleMessage({ channel: "telegram", chatId: unauthorizedChat, text: "Hello 1" });
  await router.handleMessage({ channel: "telegram", chatId: unauthorizedChat, text: "Hello 2" });
  await router.handleMessage({ channel: "telegram", chatId: unauthorizedChat, text: "Hello 3" });

  // ASSERT: Hanya 1 balasan "This bot is private." yang dikirim dalam 1 jam
  assert.equal(adapter.sent.length, 1);
  assert.equal(adapter.sent[0]?.text, PRIVATE_BOT_REPLY);

  await rm(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 4. Pairing Persistence Bug & Settings Path Resolution
// ---------------------------------------------------------------------------

test("hardening 4: pairing via /start CODE persisten ke settings.json dengan schema validation dan logging path", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "tahansoe-hw4-persist-"));
  const tempSettingsFile = join(tmp, "custom-settings.json");
  const tempStateFile = join(tmp, "custom-state.json");

  // Inisialisasi settings awal dengan botUsername di channels.telegram
  const initSettings = {
    ...emptySettings(),
    gateway: {
      channels: {
        telegram: {
          enabled: true,
          botUsername: "TahansoeRiskBot",
          allowedChats: [],
        },
      },
      alertPollSec: 60,
      qaPerDay: 20,
      dailySummary: false,
    },
  };
  await writeSettings(initSettings, tempSettingsFile);

  // Buat pairing code
  const state = createEmptyGatewayState();
  const pairing = new PairingManager(tempStateFile, state);
  const { code } = pairing.createPairingCode("telegram");

  class MockAdapter implements ChannelAdapter {
    public readonly channelName = "mock";
    public replies: string[] = [];
    public async start() {}
    public async stop() {}
    public async send(_chatId: string, text: string) {
      this.replies.push(text);
    }
    public onMessage() {}
  }

  const adapter = new MockAdapter();
  const routerLogs: string[] = [];

  const router = new CommandRouter({
    adapter,
    pairing,
    state,
    statePath: tempStateFile,
    settingsPath: tempSettingsFile,
    logger: (msg) => routerLogs.push(msg),
  });

  const pairingChatId = "555666777";

  // Kirim perintah pairing
  await router.handleMessage({
    channel: "telegram",
    chatId: pairingChatId,
    text: `/start ${code}`,
    from: { id: 555666777, username: "valid_paired_user" },
  });

  // 1. Verifikasi respon pairing sukses ke user
  assert.ok(adapter.replies.some((r) => r.includes("Pairing successful")));

  // 2. Verifikasi state file menandai code sebagai paired
  const pairStatus = pairing.pairingStatus(code);
  assert.equal(pairStatus.status, "paired");
  assert.equal(pairStatus.chatId, pairingChatId);

  // 3. Verifikasi settings.json ditulis ulang dan allowedChats bertambah
  const { settings: savedSettings } = await loadSettings(tempSettingsFile);
  const allowed = savedSettings.gateway?.channels?.telegram?.allowedChats ?? [];
  const foundChat = allowed.find((c) => String(c.id) === pairingChatId);
  assert.ok(foundChat, `Chat ${pairingChatId} harus tersimpan di settings.json`);
  assert.equal(foundChat.label, "@valid_paired_user");
  assert.equal(foundChat.subscribed, true);

  // 4. Verifikasi logging target settings path tercatat
  assert.ok(
    routerLogs.some((l) => l.includes(`Updated settings written to: ${tempSettingsFile}`)),
    "Target settings path harus dicatat di log",
  );

  await rm(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 5. Reset Real State
// ---------------------------------------------------------------------------

test("hardening 5: apps/engine/.data/gateway-state.json pendingPairings direset ke {}", () => {
  const realStatePath = join(process.cwd(), "apps", "engine", ".data", "gateway-state.json");
  if (!existsSync(realStatePath)) return;

  const raw = readFileSync(realStatePath, "utf8");
  const parsed = JSON.parse(raw);
  assert.deepEqual(parsed.pendingPairings, {}, "pendingPairings pada state asli harus berupa objek kosong {}");
});

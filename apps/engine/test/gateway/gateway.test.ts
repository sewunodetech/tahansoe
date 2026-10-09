/**
 * Integration test startGateway(), gatewayStatus(), dan gatewayListening() (spec §3.5, §7).
 *
 * Menguji:
 *  - gatewayStatus mendeteksi konfigurasi berdasarkan env dan settings
 *  - startGateway siklus hidup normal (start, listening, pairing, stop)
 *  - Override token eksplisit via opts.telegramToken
 *  - Tanpa token: status channel inactive dan gatewayListening false
 *  - Penanganan HTTP 409 Conflict: log satu kali (token masked), poller stop, status conflict
 *  - Cross-process pairing: proses A membuat kode, gateway B menerima /start CODE
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  startGateway,
  gatewayStatus,
  gatewayListening,
} from "../../src/gateway/index.ts";
import {
  createPairingCode,
  pairingStatus,
} from "../../src/gateway/pairing.ts";
import {
  writeSettings,
  emptySettings,
  loadSettings,
} from "../../src/settings/settings.ts";

test("gateway: gatewayStatus mendeteksi konfigurasi berdasarkan env dan settings", () => {
  // Tanpa token
  const statusEmpty = gatewayStatus({});
  assert.equal(statusEmpty.configured, false);
  assert.deepEqual(statusEmpty.channels, []);

  // Dengan token aktif
  const statusActive = gatewayStatus({ TELEGRAM_BOT_TOKEN: "fake_token_123" });
  assert.equal(statusActive.configured, true);
  assert.deepEqual(statusActive.channels, ["telegram"]);

  // Dengan token tapi settings disabled
  const statusDisabled = gatewayStatus(
    { TELEGRAM_BOT_TOKEN: "fake_token_123" },
    {
      ...emptySettings(),
      gateway: {
        channels: { telegram: { enabled: false, allowedChats: [] } },
        alertPollSec: 60,
        qaPerDay: 20,
        dailySummary: false,
      },
    },
  );
  assert.equal(statusDisabled.configured, false);
  assert.deepEqual(statusDisabled.channels, []);
});

test("gateway: startGateway memulai lifecycle dan mengembalikan stop() serta pairing api", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "tahansoe-gw-"));
  const settingsFile = join(tmp, "settings.json");
  const stateFile = join(tmp, "gateway-state.json");
  await writeSettings(emptySettings(), settingsFile);

  const fakeFetch: typeof fetch = async (input) => {
    const s = String(input);
    if (s.includes("getUpdates")) {
      return new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  const logs: string[] = [];
  let instance: any;
  try {
    instance = await startGateway({
      env: { TELEGRAM_BOT_TOKEN: "fake_test_token_gw" },
      settingsPath: settingsFile,
      statePath: stateFile,
      fetchFn: fakeFetch,
      logger: (msg: string) => logs.push(msg),
      pollIntervalSec: 9999,
    });

    assert.ok(instance.pairing, "Harus menyediakan instance pairing");
    assert.equal(instance.status.telegram, "active");
    assert.equal(gatewayListening(instance), true);

    const { code } = instance.pairing.createPairingCode("telegram");
    assert.ok(code.length >= 8);
    assert.equal(instance.pairing.pairingStatus(code).status, "pending");

    assert.ok(logs.some((l) => l.includes("Adapter started")));

    // ASSERT: token tidak bocor di logs
    for (const l of logs) {
      assert.ok(!l.includes("fake_test_token_gw"), `Token leaked in log: ${l}`);
    }
  } finally {
    if (instance) await instance.stop();
    await rm(tmp, { recursive: true, force: true });
  }
  assert.ok(logs.some((l) => l.includes("Gateway stopped")));
});

test("gateway: token override via opts.telegramToken diutamakan dibanding env", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "tahansoe-gw-override-"));
  const settingsFile = join(tmp, "settings.json");
  const stateFile = join(tmp, "gateway-state.json");
  await writeSettings(emptySettings(), settingsFile);

  const capturedUrls: string[] = [];
  const fakeFetch: typeof fetch = async (input) => {
    capturedUrls.push(String(input));
    return new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 });
  };

  let instance: any;
  try {
    instance = await startGateway({
      telegramToken: "token_override_999",
      env: { TELEGRAM_BOT_TOKEN: "ignored_env_token_000" },
      settingsPath: settingsFile,
      statePath: stateFile,
      fetchFn: fakeFetch,
      pollIntervalSec: 9999,
    });

    assert.equal(instance.status.telegram, "active");
    assert.equal(gatewayListening(instance), true);

    // Pastikan request menggunakan token override
    assert.ok(capturedUrls.some((u) => u.includes("token_override_999")));
    assert.ok(!capturedUrls.some((u) => u.includes("ignored_env_token_000")));
  } finally {
    if (instance) await instance.stop();
    await rm(tmp, { recursive: true, force: true });
  }
});

test("gateway: tanpa token mengembalikan status inactive dan gatewayListening false", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "tahansoe-gw-notoken-"));
  const settingsFile = join(tmp, "settings.json");
  const stateFile = join(tmp, "gateway-state.json");
  await writeSettings(emptySettings(), settingsFile);

  const logs: string[] = [];
  let instance: any;
  try {
    instance = await startGateway({
      env: {},
      settingsPath: settingsFile,
      statePath: stateFile,
      logger: (msg: string) => logs.push(msg),
    });

    assert.equal(instance.status.telegram, "inactive");
    assert.equal(gatewayListening(instance), false);
    assert.ok(instance.pairing, "Pairing API harus tetap tersedia");
    assert.ok(logs.some((l) => l.includes("Telegram channel inactive")));
  } finally {
    if (instance) await instance.stop();
    await rm(tmp, { recursive: true, force: true });
  }
});

test("gateway: HTTP 409 Conflict menghentikan poller tanpa retry-loop dan mencatat status conflict", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "tahansoe-gw-409-"));
  const settingsFile = join(tmp, "settings.json");
  const stateFile = join(tmp, "gateway-state.json");
  await writeSettings(emptySettings(), settingsFile);

  let getUpdatesCount = 0;
  const fakeFetch: typeof fetch = async (input) => {
    const s = String(input);
    if (s.includes("getUpdates")) {
      getUpdatesCount++;
      return new Response(
        JSON.stringify({
          ok: false,
          error_code: 409,
          description: "Conflict: terminated by other getUpdates request; make sure that only one bot instance is running",
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  const logs: string[] = [];
  let instance: any;
  try {
    instance = await startGateway({
      telegramToken: "conflict_token_123",
      settingsPath: settingsFile,
      statePath: stateFile,
      fetchFn: fakeFetch,
      logger: (msg: string) => logs.push(msg),
      pollIntervalSec: 9999,
    });

    // Tunggu jeda singkat agar polling loop mengeksekusi request pertama
    await new Promise((r) => setTimeout(r, 60));

    assert.equal(instance.status.telegram, "conflict");
    assert.equal(gatewayListening(instance), false);

    // Verifikasi log satu kali dan token disamarkan
    const conflictLogs = logs.filter((l) =>
      l.includes("another Tahansoe agent is already polling this bot; pairing will be handled by it"),
    );
    assert.equal(conflictLogs.length, 1, "Pesan conflict harus dicatat tepat satu kali");
    assert.equal(getUpdatesCount, 1, "Poller tidak boleh melakukan retry-loop saat 409");

    for (const l of logs) {
      assert.ok(!l.includes("conflict_token_123"), `Token leaked in log: ${l}`);
    }
  } finally {
    if (instance) await instance.stop();
    await rm(tmp, { recursive: true, force: true });
  }
});

test("gateway: cross-process pairing — kode dibuat proses A diterima oleh gateway B", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "tahansoe-gw-crosspair-"));
  const settingsFile = join(tmp, "settings.json");
  const stateFile = join(tmp, "gateway-state.json");
  await writeSettings(emptySettings(), settingsFile);

  // 1. Proses A membuat pairing code ke state file
  const { code } = createPairingCode("telegram", stateFile);
  assert.equal(pairingStatus(code, stateFile).status, "pending");

  // 2. Gateway B berjalan di proses lain dengan state file & settings file yang sama
  let sentMessage = "";
  let pollIteration = 0;

  const fakeFetch: typeof fetch = async (input, init) => {
    const s = String(input);
    if (s.includes("getUpdates")) {
      pollIteration++;
      if (pollIteration === 1) {
        return new Response(
          JSON.stringify({
            ok: true,
            result: [
              {
                update_id: 501,
                message: {
                  message_id: 10,
                  chat: { id: 888999, type: "private" },
                  date: 1700000000,
                  text: `/start ${code}`,
                  from: { id: 888999, username: "user_paired_ab" },
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 });
    }

    if (s.includes("sendMessage")) {
      const body = JSON.parse(String(init?.body ?? "{}"));
      sentMessage = body.text ?? "";
      return new Response(JSON.stringify({ ok: true, result: { message_id: 11 } }), { status: 200 });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  let instanceB: any;
  try {
    instanceB = await startGateway({
      telegramToken: "token_gateway_b",
      settingsPath: settingsFile,
      statePath: stateFile,
      fetchFn: fakeFetch,
      pollIntervalSec: 9999,
    });

    // Tunggu sejenak agar gateway B memproses pesan update
    await new Promise((r) => setTimeout(r, 120));

    // 3. Verifikasi: proses A melihat status menjadi paired
    const statusA = pairingStatus(code, stateFile);
    assert.equal(statusA.status, "paired");
    assert.equal(statusA.chatId, "888999");

    // 4. Verifikasi: settings.json diperbarui dengan chat baru di allowlist
    const { settings } = await loadSettings(settingsFile);
    const allowed = settings.gateway?.channels?.telegram?.allowedChats ?? [];
    const chatItem = allowed.find((c) => String(c.id) === "888999");
    assert.ok(chatItem, "Chat 888999 harus terdaftar di allowedChats");
    assert.equal(chatItem.label, "@user_paired_ab");
    assert.equal(chatItem.subscribed, true);

    // 5. Pesan konfirmasi dikirim ke Telegram
    assert.ok(sentMessage.includes("Pairing successful"));
  } finally {
    if (instanceB) await instanceB.stop();
    await rm(tmp, { recursive: true, force: true });
  }
});

test("gateway: HTTP 409 Conflict akibat webhook aktif menghasilkan status webhook_active dan mencatat host webhook", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "tahansoe-gw-wh409-"));
  const settingsFile = join(tmp, "settings.json");
  const stateFile = join(tmp, "gateway-state.json");
  await writeSettings(emptySettings(), settingsFile);

  let getUpdatesCount = 0;
  const fakeFetch: typeof fetch = async (input) => {
    const s = String(input);
    if (s.includes("getWebhookInfo")) {
      return new Response(
        JSON.stringify({
          ok: true,
          result: {
            url: "https://n8n.workflow.mycompany.com/webhook/test-token",
            has_custom_certificate: false,
            pending_update_count: 5,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (s.includes("getUpdates")) {
      getUpdatesCount++;
      return new Response(
        JSON.stringify({
          ok: false,
          error_code: 409,
          description: "Conflict: can't use getUpdates method while webhook is active; use deleteWebhook to delete the webhook first",
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  const logs: string[] = [];
  let instance: any;
  try {
    instance = await startGateway({
      telegramToken: "wh_conflict_token_123",
      settingsPath: settingsFile,
      statePath: stateFile,
      fetchFn: fakeFetch,
      logger: (msg: string) => logs.push(msg),
      pollIntervalSec: 9999,
    });

    await new Promise((r) => setTimeout(r, 60));

    assert.equal(instance.status.telegram, "webhook_active");
    assert.equal(instance.webhookHost, "n8n.workflow.mycompany.com");
    assert.equal(gatewayListening(instance), false);

    assert.ok(
      logs.some((l) =>
        l.includes("This bot uses a webhook to <n8n.workflow.mycompany.com>. Use a dedicated bot, or run tahansoe gateway pair --delete-webhook"),
      ),
      "Pesan edukatif webhook harus tercatat",
    );
    assert.equal(getUpdatesCount, 1, "Poller harus berhenti tanpa looping");
  } finally {
    if (instance) await instance.stop();
    await rm(tmp, { recursive: true, force: true });
  }
});

test("gateway: startGateway dengan deleteWebhook: true menghapus webhook sebelum memulai polling", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "tahansoe-gw-delwh-"));
  const settingsFile = join(tmp, "settings.json");
  const stateFile = join(tmp, "gateway-state.json");
  await writeSettings(emptySettings(), settingsFile);

  let deleteWebhookCalled = false;
  const fakeFetch: typeof fetch = async (input) => {
    const s = String(input);
    if (s.includes("deleteWebhook")) {
      deleteWebhookCalled = true;
      return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
    }
    if (s.includes("getUpdates")) {
      return new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  const logs: string[] = [];
  let instance: any;
  try {
    instance = await startGateway({
      telegramToken: "token_del_wh_test",
      deleteWebhook: true,
      settingsPath: settingsFile,
      statePath: stateFile,
      fetchFn: fakeFetch,
      logger: (msg: string) => logs.push(msg),
      pollIntervalSec: 9999,
    });

    assert.equal(deleteWebhookCalled, true, "deleteWebhook harus dipanggil");
    assert.equal(instance.status.telegram, "active");
    assert.ok(logs.some((l) => l.includes("Existing Telegram webhook deleted as requested")));
  } finally {
    if (instance) await instance.stop();
    await rm(tmp, { recursive: true, force: true });
  }
});

/**
 * Unit test langkah Telegram dalam `tahansoe setup` (spec m3-channel-gateway-telegram §2, §7).
 *
 * Menguji:
 *  - Mode non-interaktif (--yes) dengan --telegram-token-env <NAME>:
 *    - Token dibaca dari env var (tidak pernah lewat argv).
 *    - Token rahasia TIDAK PERNAH tercetak ke stdout maupun stderr (I8).
 *    - Validasi bot via telegramGetMe menampilkan username bot.
 *    - In-process pairing sementara dimulai (startGateway), createPairingCode dipanggil.
 *    - Polling pairing status hingga paired, mencetak chat ID yang disensor (masked).
 *    - Gateway sementara dihentikan (stop()) setelah pairing selesai.
 *    - TELEGRAM_BOT_TOKEN dan komentar default GATEWAY_* ditulis ke file .env target.
 *  - Mode non-interaktif dengan --skip-telegram: langkah Telegram dilewati secara bersih.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupCommand, maskChatId } from "../../src/cli/commands/setup.ts";
import { EXIT_OK, EXIT_ERROR } from "../../src/cli/commands/args.ts";

test("maskChatId: menyensor chat ID dengan format **** atau id****id", () => {
  assert.equal(maskChatId("123"), "****");
  assert.equal(maskChatId("1234"), "****");
  assert.equal(maskChatId("123456789"), "12****89");
  assert.equal(maskChatId(987654321), "98****21");
  assert.equal(maskChatId(""), "****");
});

test("setupCommand: langkah Telegram non-interaktif (--yes) dengan fake getMe dan pairing", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "tahansoe-setup-tg-"));
  const tmpEnv = join(tmp, ".env");
  const tmpSettings = join(tmp, "settings.json");

  await writeFile(
    tmpSettings,
    JSON.stringify({ version: 2, roles: {} }),
    "utf-8",
  );

  const secretBotToken = "77889900:ABC-DEF_super_secret_telegram_token";
  const customEnv: NodeJS.ProcessEnv = {
    MY_CUSTOM_BOT_TOKEN_VAR: secretBotToken,
    LLM_API_KEY: "dummy-key",
  };

  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];

  let getMeCalledWith = "";
  let gatewayStarted = false;
  let gatewayStopped = false;
  let pairingCodeCreated = false;
  let pollAttempts = 0;

  try {
    const exitCode = await setupCommand(
      ["--yes", "--telegram-token-env", "MY_CUSTOM_BOT_TOKEN_VAR", "--model", "gpt-6-luna"],
      {
        env: customEnv,
        envPath: tmpEnv,
        settingsPath: tmpSettings,
        stdout: (s) => stdoutChunks.push(s),
        stderr: (s) => stderrChunks.push(s),
        runDoctorImpl: async () => [],
        ensureDbImpl: async () => {},
        sleepImpl: async () => {}, // Instant sleep untuk pengujian cepat
        telegramGetMe: async (token) => {
          getMeCalledWith = token;
          return { ok: true, username: "TahansoeAlertBot" };
        },
        startGateway: async () => {
          gatewayStarted = true;
          return {
            stop: async () => {
              gatewayStopped = true;
            },
            pairing: {
              createPairingCode: (channel: string) => {
                pairingCodeCreated = true;
                assert.equal(channel, "telegram");
                return { code: "PAIR1234", expiresAt: new Date(Date.now() + 600_000) };
              },
              pairingStatus: (code: string) => {
                assert.equal(code, "PAIR1234");
                pollAttempts++;
                // Simulasikan paired pada pemanggilan ke-2
                if (pollAttempts >= 2) {
                  return { status: "paired", chatId: 987654321 };
                }
                return { status: "pending" };
              },
            },
          };
        },
      },
    );

    assert.equal(exitCode, EXIT_OK);

    // Verifikasi pemanggilan getMe & token tidak bocor
    assert.equal(getMeCalledWith, secretBotToken, "token harus dibaca dari env var");

    const fullStdout = stdoutChunks.join("");
    const fullStderr = stderrChunks.join("");

    // Verifikasi pesan output: validasi token & hint ke 'tahansoe gateway pair'
    assert.match(fullStdout, /@TahansoeAlertBot/);
    assert.match(fullStdout, /Next: run 'tahansoe gateway pair' to connect your chat/);

    // INVARIANT I8: Token bot rahasia TIDAK PERNAH boleh muncul di log/output
    assert.ok(!fullStdout.includes(secretBotToken), "Token rahasia tidak boleh bocor ke stdout");
    assert.ok(!fullStderr.includes(secretBotToken), "Token rahasia tidak boleh bocor ke stderr");

    // Verifikasi penulisan ke file .env target
    const envContent = await readFile(tmpEnv, "utf-8");
    assert.match(envContent, new RegExp(`^TELEGRAM_BOT_TOKEN=${secretBotToken}$`, "m"));
    assert.match(envContent, /# TELEGRAM_ALLOWED_CHAT_IDS=/);
    assert.match(envContent, /# GATEWAY_ALERT_POLL_SEC=60/);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("setupCommand: opsi --skip-telegram melewati langkah Telegram secara bersih", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "tahansoe-setup-skip-tg-"));
  const tmpEnv = join(tmp, ".env");
  const tmpSettings = join(tmp, "settings.json");

  await writeFile(
    tmpSettings,
    JSON.stringify({ version: 2, roles: {} }),
    "utf-8",
  );
  await writeFile(tmpEnv, "EXISTING=1\n", "utf-8");

  let getMeCalled = false;
  let gatewayCalled = false;

  try {
    const exitCode = await setupCommand(
      ["--yes", "--skip-telegram", "--model", "gpt-6-luna"],
      {
        env: { LLM_API_KEY: "dummy-key" },
        envPath: tmpEnv,
        settingsPath: tmpSettings,
        stdout: () => {},
        stderr: () => {},
        runDoctorImpl: async () => [],
        ensureDbImpl: async () => {},
        telegramGetMe: async () => {
          getMeCalled = true;
          return { ok: true, username: "bot" };
        },
        startGateway: async () => {
          gatewayCalled = true;
          return { stop: async () => {} };
        },
      },
    );

    assert.equal(exitCode, EXIT_OK);
    assert.equal(getMeCalled, false, "telegramGetMe tidak boleh dipanggil saat --skip-telegram");
    assert.equal(gatewayCalled, false, "startGateway tidak boleh dipanggil saat --skip-telegram");

    const envContent = await readFile(tmpEnv, "utf-8");
    assert.ok(!envContent.includes("TELEGRAM_BOT_TOKEN="), "TELEGRAM_BOT_TOKEN tidak boleh ditulis saat di-skip");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("gatewayPairCommand: membuat kode pairing, menjalankan temporary gateway, dan poll hingga paired", async () => {
  const stdoutChunks: string[] = [];
  let gatewayStarted = false;
  let gatewayStopped = false;
  let pollAttempts = 0;

  const { gatewayPairCommand } = await import("../../src/cli/commands/gateway-pair.ts");

  const exitCode = await gatewayPairCommand([], {
    env: { TELEGRAM_BOT_TOKEN: "fake_pair_token" },
    stdout: (s) => stdoutChunks.push(s),
    sleepImpl: async () => {},
    telegramGetMe: async () => ({ ok: true, username: "TahansoeBot" }),
    startGateway: async () => {
      gatewayStarted = true;
      return {
        stop: async () => {
          gatewayStopped = true;
        },
        pairing: {
          createPairingCode: () => ({ code: "PAIR9999", expiresAt: new Date(Date.now() + 600_000) }),
          pairingStatus: () => {
            pollAttempts++;
            if (pollAttempts >= 2) return { status: "paired", chatId: "5551234555" };
            return { status: "pending" };
          },
        },
      };
    },
  });

  assert.equal(exitCode, EXIT_OK);
  assert.ok(gatewayStarted, "temporary gateway harus dimulai");
  assert.ok(gatewayStopped, "temporary gateway harus dihentikan setelah selesai");
  const out = stdoutChunks.join("");
  assert.match(out, /Send.*\/start PAIR9999.*to @TahansoeBot/);
  assert.match(out, /Berhasil terhubung dengan chat 55\*\*\*\*55/);
});

test("gatewayPairCommand: mendeteksi conflict (agent sudah running) dan hanya poll tanpa stop", async () => {
  const stdoutChunks: string[] = [];
  let pollAttempts = 0;
  let stopCalled = false;

  const { gatewayPairCommand } = await import("../../src/cli/commands/gateway-pair.ts");

  const exitCode = await gatewayPairCommand([], {
    env: { TELEGRAM_BOT_TOKEN: "fake_pair_token" },
    stdout: (s) => stdoutChunks.push(s),
    sleepImpl: async () => {},
    telegramGetMe: async () => ({ ok: true, username: "TahansoeBot" }),
    createPairingCode: () => ({ code: "ALREADY123", expiresAt: new Date(Date.now() + 600_000) }),
    pairingStatus: () => {
      pollAttempts++;
      if (pollAttempts >= 2) return { status: "paired", chatId: 12345 };
      return { status: "pending" };
    },
    startGateway: async () => ({
      status: "conflict",
      stop: async () => {
        stopCalled = true;
      },
    }),
  });

  assert.equal(exitCode, EXIT_OK);
  assert.equal(stopCalled, false, "Gateway milik agent yang sedang berjalan tidak boleh di-stop");
  const out = stdoutChunks.join("");
  assert.match(out, /Agent is already running; it will handle the pairing/);
  assert.match(out, /Berhasil terhubung dengan chat 12\*\*\*\*45/);
});

test("gatewayStatusCommand: menampilkan username bot, allowed chats count, dan agent polling status", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "tahansoe-gw-status-"));
  const tmpSettings = join(tmp, "settings.json");
  await writeFile(
    tmpSettings,
    JSON.stringify({
      version: 2,
      gateway: {
        channels: {
          telegram: {
            allowedChats: [
              { id: "111222333" },
              { id: "444555666" },
            ],
          },
        },
      },
    }),
    "utf-8",
  );

  const { gatewayStatusCommand } = await import("../../src/cli/commands/gateway-pair.ts");
  const stdoutChunks: string[] = [];
  try {
    const exitCode = await gatewayStatusCommand([], {
      env: { TELEGRAM_BOT_TOKEN: "fake_status_token" },
      settingsPath: tmpSettings,
      stdout: (s) => stdoutChunks.push(s),
      telegramGetMe: async () => ({ ok: true, username: "StatusBot" }),
      gatewayListening: async () => true,
    });

    assert.equal(exitCode, EXIT_OK);
    const out = stdoutChunks.join("");
    assert.match(out, /Bot: @StatusBot/);
    assert.match(out, /Mode: polling/);
    assert.match(out, /Allowed chats: 2/);
    assert.match(out, /11\*\*\*\*33/);
    assert.match(out, /Agent polling:.*active/);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("gatewayPairCommand: mendeteksi webhook aktif tanpa --delete-webhook, mencetak pesan instruktif dan keluar dengan error", async () => {
  const stdoutChunks: string[] = [];
  let deleteWebhookCalled = false;

  const { gatewayPairCommand } = await import("../../src/cli/commands/gateway-pair.ts");

  const exitCode = await gatewayPairCommand([], {
    env: { TELEGRAM_BOT_TOKEN: "fake_wh_token" },
    stdout: (s) => stdoutChunks.push(s),
    telegramGetMe: async () => ({ ok: true, username: "WebhookBot" }),
    startGateway: async () => ({
      stop: async () => {},
      status: "webhook_active",
      webhookHost: "n8n.my-domain.com",
    } as any),
    telegramDeleteWebhook: async () => {
      deleteWebhookCalled = true;
      return { ok: true, result: true };
    },
  });

  assert.equal(exitCode, EXIT_ERROR);
  assert.equal(deleteWebhookCalled, false, "Webhook TIDAK boleh dihapus secara implisit");
  const out = stdoutChunks.join("");
  assert.match(
    out,
    /This bot uses a webhook to n8n\.my-domain\.com\. Messages go there, not to Tahansoe\. Use a dedicated bot, or run: tahansoe gateway pair --delete-webhook/,
  );
});

test("gatewayPairCommand: flag --delete-webhook dengan konfirmasi 'N' membatalkan tanpa menghapus webhook", async () => {
  const stdoutChunks: string[] = [];
  let deleteWebhookCalled = false;

  const { gatewayPairCommand } = await import("../../src/cli/commands/gateway-pair.ts");

  const exitCode = await gatewayPairCommand(["--delete-webhook"], {
    env: { TELEGRAM_BOT_TOKEN: "fake_wh_token" },
    stdout: (s) => stdoutChunks.push(s),
    telegramGetMe: async () => ({ ok: true, username: "WebhookBot" }),
    telegramGetWebhookInfo: async () => ({ ok: true, host: "n8n.my-domain.com" }),
    confirmDeleteWebhook: async (host) => {
      assert.equal(host, "n8n.my-domain.com");
      return false; // User menolak
    },
    telegramDeleteWebhook: async () => {
      deleteWebhookCalled = true;
      return { ok: true, result: true };
    },
  });

  assert.equal(exitCode, EXIT_OK);
  assert.equal(deleteWebhookCalled, false, "deleteWebhook TIDAK boleh dipanggil saat user menolak");
  const out = stdoutChunks.join("");
  assert.match(out, /Dibatalkan: webhook tidak dihapus/);
});

test("gatewayPairCommand: flag --delete-webhook dengan konfirmasi 'y' menghapus webhook dan memulai pairing", async () => {
  const stdoutChunks: string[] = [];
  let deleteWebhookCalled = false;
  let startGatewayCalledWithDelete = false;

  const { gatewayPairCommand } = await import("../../src/cli/commands/gateway-pair.ts");

  const exitCode = await gatewayPairCommand(["--delete-webhook"], {
    env: { TELEGRAM_BOT_TOKEN: "fake_wh_token" },
    stdout: (s) => stdoutChunks.push(s),
    sleepImpl: async () => {},
    telegramGetMe: async () => ({ ok: true, username: "WebhookBot" }),
    telegramGetWebhookInfo: async () => ({ ok: true, host: "n8n.my-domain.com" }),
    confirmDeleteWebhook: async (host) => {
      assert.equal(host, "n8n.my-domain.com");
      return true; // User menyetujui
    },
    telegramDeleteWebhook: async () => {
      deleteWebhookCalled = true;
      return { ok: true, result: true };
    },
    startGateway: async (opts: any) => {
      startGatewayCalledWithDelete = Boolean(opts?.deleteWebhook);
      return {
        stop: async () => {},
        pairing: {
          createPairingCode: () => ({ code: "PAIR1234", expiresAt: new Date(Date.now() + 600_000) }),
          pairingStatus: () => ({ status: "paired", chatId: "999888777" }),
        },
      } as any;
    },
  });

  assert.equal(exitCode, EXIT_OK);
  assert.equal(deleteWebhookCalled, true, "telegramDeleteWebhook harus dipanggil saat dikonfirmasi");
  assert.equal(startGatewayCalledWithDelete, true, "startGateway harus menerima deleteWebhook: true");
  const out = stdoutChunks.join("");
  assert.match(out, /✔ Webhook ke n8n\.my-domain\.com berhasil dihapus/);
  assert.match(out, /Send.*\/start PAIR1234.*to @WebhookBot/);
  assert.match(out, /Berhasil terhubung dengan chat 99\*\*\*\*77/);
});

test("gatewayStatusCommand: menampilkan Mode: webhook to <host> dan pesan instruktif jika webhook aktif", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "tahansoe-gw-wh-status-"));
  const tmpSettings = join(tmp, "settings.json");
  await writeFile(
    tmpSettings,
    JSON.stringify({
      version: 2,
      gateway: {
        channels: {
          telegram: {
            allowedChats: [{ id: "12345678" }],
          },
        },
      },
    }),
    "utf-8",
  );

  const { gatewayStatusCommand } = await import("../../src/cli/commands/gateway-pair.ts");
  const stdoutChunks: string[] = [];
  try {
    const exitCode = await gatewayStatusCommand([], {
      env: { TELEGRAM_BOT_TOKEN: "fake_wh_status_token" },
      settingsPath: tmpSettings,
      stdout: (s) => stdoutChunks.push(s),
      telegramGetMe: async () => ({ ok: true, username: "StatusWhBot" }),
      telegramGetWebhookInfo: async () => ({ ok: true, host: "n8n.external.co" }),
    });

    assert.equal(exitCode, EXIT_OK);
    const out = stdoutChunks.join("");
    assert.match(out, /Bot: @StatusWhBot/);
    assert.match(out, /Mode: webhook to n8n\.external\.co/);
    assert.match(out, /Allowed chats: 1/);
    assert.match(
      out,
      /This bot uses a webhook to n8n\.external\.co\. Messages go there, not to Tahansoe\. Use a dedicated bot, or run: tahansoe gateway pair --delete-webhook/,
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});


test("gatewayPairCommand: webhook aktif dicek DI AWAL - tanpa konfirmasi tidak membuat kode pairing", async () => {
  const stdoutChunks: string[] = [];
  let codeCreated = false;
  let deleteCalled = false;
  const { gatewayPairCommand } = await import("../../src/cli/commands/gateway-pair.ts");
  const exitCode = await gatewayPairCommand([], {
    env: { TELEGRAM_BOT_TOKEN: "fake_wh_token" },
    stdout: (s: string) => stdoutChunks.push(s),
    telegramGetMe: async () => ({ ok: true, username: "WebhookBot" }),
    telegramGetWebhookInfo: async () => ({ ok: true, host: "n8n.example.com" }),
    confirmDeleteWebhook: async () => false,
    createPairingCode: () => {
      codeCreated = true;
      return { code: "SHOULDNOTSHOW", expiresAt: Date.now() + 600000 };
    },
    telegramDeleteWebhook: async () => {
      deleteCalled = true;
      return { ok: true, result: true };
    },
  } as any);
  const out = stdoutChunks.join("");
  assert.equal(codeCreated, false, "kode pairing tidak boleh dibuat selama webhook aktif");
  assert.equal(deleteCalled, false, "webhook tidak dihapus tanpa konfirmasi");
  assert.doesNotMatch(out, /SHOULDNOTSHOW/);
  assert.match(out, /webhook to n8n\.example\.com/);
  assert.equal(exitCode, EXIT_OK);
});

test("gatewayPairCommand: gateway sementara milik proses ini yang listening BUKAN 'already running' - pakai pairing-nya dan stop setelahnya", async () => {
  const stdoutChunks: string[] = [];
  let stopCalled = false;
  let codeFromGw = false;
  const { gatewayPairCommand } = await import("../../src/cli/commands/gateway-pair.ts");
  const exitCode = await gatewayPairCommand([], {
    env: { TELEGRAM_BOT_TOKEN: "fake_pair_token" },
    stdout: (s: string) => stdoutChunks.push(s),
    sleepImpl: async () => {},
    telegramGetMe: async () => ({ ok: true, username: "TahansoeBot" }),
    telegramGetWebhookInfo: async () => ({ ok: true, host: "" }),
    gatewayListening: async () => true,
    startGateway: async () => ({
      status: "listening",
      pairing: {
        createPairingCode: () => {
          codeFromGw = true;
          return { code: "OWNGW12345", expiresAt: Date.now() + 600_000 };
        },
        pairingStatus: () => ({ status: "paired", chatId: "98765" }),
      },
      stop: async () => {
        stopCalled = true;
      },
    }),
  } as any);
  const out = stdoutChunks.join("");
  assert.equal(exitCode, EXIT_OK);
  assert.doesNotMatch(out, /Agent is already running/);
  assert.equal(codeFromGw, true, "kode harus dibuat oleh gateway sementara milik proses ini");
  assert.equal(stopCalled, true, "gateway sementara harus dihentikan (melepas lock) setelah pairing");
});

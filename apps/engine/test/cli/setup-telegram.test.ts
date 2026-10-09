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
import { EXIT_OK } from "../../src/cli/commands/args.ts";

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

    // Verifikasi pemanggilan getMe & pairing
    assert.equal(getMeCalledWith, secretBotToken, "token harus dibaca dari env var");
    assert.ok(gatewayStarted, "temporary gateway harus dijalankan untuk pairing");
    assert.ok(pairingCodeCreated, "createPairingCode harus dipanggil");
    assert.ok(pollAttempts >= 2, "pairingStatus harus dipolling");
    assert.ok(gatewayStopped, "temporary gateway harus dihentikan setelah pairing");

    const fullStdout = stdoutChunks.join("");
    const fullStderr = stderrChunks.join("");

    // Verifikasi pesan output
    assert.match(fullStdout, /@TahansoeAlertBot/);
    assert.match(fullStdout, /Send \/start PAIR1234/);
    assert.match(fullStdout, /Berhasil terhubung dengan chat 98\*\*\*\*21/);

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

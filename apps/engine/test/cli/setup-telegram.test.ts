/**
 * Unit test langkah Telegram dalam `tahansoe setup` (spec m3-research-broadcast).
 *
 * Menguji:
 *  - Mode non-interaktif (--yes) dengan --telegram-token-env <NAME>:
 *    - Token dibaca dari env var (tidak pernah lewat argv).
 *    - Token rahasia TIDAK PERNAH tercetak ke stdout maupun stderr (I8).
 *    - Validasi bot via telegramGetMe menampilkan username bot.
 *    - Pesan menghubungkan akun diarahkan ke web dashboard.
 *    - TELEGRAM_BOT_TOKEN dan komentar default BROADCAST_* ditulis ke file .env target.
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

test("setupCommand: langkah Telegram non-interaktif (--yes) dengan fake getMe", async () => {
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
        migrateImpl: async () => {},
        sleepImpl: async () => {},
        telegramGetMe: async (token) => {
          getMeCalledWith = token;
          return { ok: true, username: "TahansoeAlertBot" };
        },
      },
    );

    assert.equal(exitCode, EXIT_OK);

    // Verifikasi pemanggilan getMe & token tidak bocor
    assert.equal(getMeCalledWith, secretBotToken, "token harus dibaca dari env var");

    const fullStdout = stdoutChunks.join("");
    const fullStderr = stderrChunks.join("");

    // Verifikasi pesan output: validasi token & hint link dari dashboard
    assert.match(fullStdout, /@TahansoeAlertBot/);
    assert.match(fullStdout, /dashboard/i);

    // INVARIANT I8: Token bot rahasia TIDAK PERNAH boleh muncul di log/output
    assert.ok(!fullStdout.includes(secretBotToken), "Token rahasia tidak boleh bocor ke stdout");
    assert.ok(!fullStderr.includes(secretBotToken), "Token rahasia tidak boleh bocor ke stderr");

    // Verifikasi penulisan ke file .env target
    const envContent = await readFile(tmpEnv, "utf-8");
    assert.match(envContent, new RegExp(`^TELEGRAM_BOT_TOKEN=${secretBotToken}$`, "m"));
    assert.match(envContent, /# BROADCAST_ENABLED=true/);
    assert.match(envContent, /# BROADCAST_DIGEST_TIMES=/);
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
        migrateImpl: async () => {},
        telegramGetMe: async () => {
          getMeCalled = true;
          return { ok: true, username: "bot" };
        },
      },
    );

    assert.equal(exitCode, EXIT_OK);
    assert.equal(getMeCalled, false, "telegramGetMe tidak boleh dipanggil saat --skip-telegram");

    const envContent = await readFile(tmpEnv, "utf-8");
    assert.ok(!envContent.includes("TELEGRAM_BOT_TOKEN="), "TELEGRAM_BOT_TOKEN tidak boleh ditulis saat di-skip");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

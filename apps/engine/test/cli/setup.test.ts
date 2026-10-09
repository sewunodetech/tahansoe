/**
 * Unit test wizard tahansoe setup (spec ADR 0009 & ADR 0010).
 *
 * Menguji:
 *  - askHidden: input tertangkap dengan benar, namun teks rahasia TIDAK pernah
 *    di-echo ke stream output. Fallback ke nilai eksisting saat Enter.
 *  - testGateway: sukses (count model), kegagalan HTTP, error/timeout.
 *  - setupCommand non-interaktif (--yes):
 *    - Membaca key dari nama env var (--llm-key-env), bukan dari argv.
 *    - Secret ditulis ke target .env file tanpa bocor ke stdout atau stderr.
 *    - settings.json diperbarui dengan gpt-6-luna untuk seluruh peran.
 *    - Inisialisasi PGlite terpanggil.
 *    - Opsi DB neon didukung.
 *    - Exit code 0 (EXIT_OK).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { askHidden, askQuestion, testGateway, setupCommand } from "../../src/cli/commands/setup.ts";
import { EXIT_OK } from "../../src/cli/commands/args.ts";

test("askHidden: menangkap input rahasia tanpa pernah mencetaknya ke stream output", async () => {
  const secret = "super-secret-api-key-999";
  const inputStream = Readable.from([secret + "\n"]);

  let capturedOutput = "";
  const outputStream = new Writable({
    write(chunk, _encoding, callback) {
      capturedOutput += chunk.toString();
      callback();
    },
  });

  const answer = await askHidden("Enter API Key: ", {
    input: inputStream,
    output: outputStream,
  });

  assert.equal(answer, secret, "harus mengembalikan string secret yang diketik");
  assert.ok(capturedOutput.includes("Enter API Key: "), "harus mencetak prompt");
  assert.ok(!capturedOutput.includes(secret), "secret TIDAK BOLEH muncul di output stream");
});

test("askHidden: menggunakan nilai eksisting jika input kosong", async () => {
  const inputStream = Readable.from(["\n"]);
  let capturedOutput = "";
  const outputStream = new Writable({
    write(chunk, _encoding, callback) {
      capturedOutput += chunk.toString();
      callback();
    },
  });

  const answer = await askHidden("Enter Key [set (hidden)]: ", {
    input: inputStream,
    output: outputStream,
    existing: "existing-saved-secret",
  });

  assert.equal(answer, "existing-saved-secret");
  assert.ok(!capturedOutput.includes("existing-saved-secret"));
});

test("askQuestion: mengembalikan nilai default bila input kosong", async () => {
  const inputStream = Readable.from(["\n"]);
  let capturedOutput = "";
  const outputStream = new Writable({
    write(chunk, _encoding, callback) {
      capturedOutput += chunk.toString();
      callback();
    },
  });

  const answer = await askQuestion("Pilihan [default]: ", {
    input: inputStream,
    output: outputStream,
    defaultValue: "my-default",
  });

  assert.equal(answer, "my-default");
});

test("testGateway: sukses mengembalikan ok true dan jumlah model", async () => {
  const mockFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: [{ id: "gpt-6-luna" }, { id: "deepseek-v4-flash" }] }),
    text: async () => "",
  });

  const res = await testGateway("https://router.bynara.id/v1", "key-test", mockFetch as any);
  assert.equal(res.ok, true);
  assert.equal(res.count, 2);
  assert.equal(res.error, undefined);
});

test("testGateway: menangani status error HTTP", async () => {
  const mockFetch = async () => ({
    ok: false,
    status: 401,
    json: async () => ({ error: "unauthorized" }),
    text: async () => "",
  });

  const res = await testGateway("https://router.bynara.id/v1", "bad-key", mockFetch as any);
  assert.equal(res.ok, false);
  assert.equal(res.count, 0);
  assert.equal(res.error, "HTTP 401");
});

test("testGateway: menangani exception koneksi/timeout", async () => {
  const mockFetch = async () => {
    throw new Error("ECONNREFUSED connect");
  };

  const res = await testGateway("https://router.bynara.id/v1", "key", mockFetch as any);
  assert.equal(res.ok, false);
  assert.equal(res.count, 0);
  assert.match(res.error!, /ECONNREFUSED/);
});

test("setupCommand non-interaktif (--yes): menulis .env & settings.json, rahasia tidak bocor", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "tahansoe-setup-test-"));
  const tmpEnv = join(tmp, ".env");
  const tmpSettings = join(tmp, "settings.json");

  // Inisialisasi settings awal
  await writeFile(
    tmpSettings,
    JSON.stringify({
      version: 2,
      roles: { analyst: ["old-model"] },
      pricingUrl: "https://router.bynara.id/api/pricing",
      modelPrices: {},
      estimate: { runsPerDay: 12 },
    }),
    "utf-8",
  );

  const secretKey = "super-secret-production-token-xyz-987";
  const customEnv: NodeJS.ProcessEnv = {
    MY_TEST_KEY_VAR: secretKey,
  };

  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];

  let ensureDbCalled = false;
  let doctorCalled = false;

  try {
    const exitCode = await setupCommand(
      [
        "--yes",
        "--llm-url",
        "https://router.bynara.id/v1",
        "--llm-key-env",
        "MY_TEST_KEY_VAR",
        "--db",
        "pglite",
        "--model",
        "gpt-6-luna",
      ],
      {
        env: customEnv,
        envPath: tmpEnv,
        settingsPath: tmpSettings,
        stdout: (s) => stdoutChunks.push(s),
        stderr: (s) => stderrChunks.push(s),
        ensureDbImpl: async () => {
          ensureDbCalled = true;
        },
        runDoctorImpl: async () => {
          doctorCalled = true;
          return [
            { name: "LLM_API_URL", ok: true, detail: "router.bynara.id" },
            { name: "LLM_API_KEY", ok: true, detail: "set (hidden)" },
          ];
        },
      },
    );

    assert.equal(exitCode, EXIT_OK, "harus mengembalikan exit code 0");
    assert.equal(ensureDbCalled, true, "ensureDb harus dipanggil untuk driver pglite");
    assert.equal(doctorCalled, true, "doctor harus dipanggil di akhir setup");

    // Periksa file .env
    const envContent = await readFile(tmpEnv, "utf-8");
    assert.match(envContent, /^LLM_API_URL=https:\/\/router\.bynara\.id\/v1$/m);
    assert.match(envContent, /^LLM_API_KEY=super-secret-production-token-xyz-987$/m);
    assert.match(envContent, /^DB_DRIVER=pglite$/m);
    assert.match(envContent, /^PGLITE_DATA_DIR=apps\/engine\/\.data\/pglite$/m);
    assert.match(envContent, /^RESEARCH_ENABLED=true$/m);

    // Periksa settings.json
    const settingsRaw = await readFile(tmpSettings, "utf-8");
    const settings = JSON.parse(settingsRaw);
    assert.deepEqual(settings.roles.analyst, ["gpt-6-luna", "deepseek-v4-flash"]);
    assert.deepEqual(settings.roles.debate, ["gpt-6-luna", "deepseek-v4-flash"]);
    assert.deepEqual(settings.roles.assessor, ["gpt-6-luna", "deepseek-v4-flash"]);
    assert.deepEqual(settings.roles.reflector, ["gpt-6-luna", "deepseek-v4-flash"]);
    assert.deepEqual(settings.roles.chat, ["gpt-6-luna", "deepseek-v4-flash"]);

    // Invariant I8: Key rahasia TIDAK BOLEH ada di stdout maupun stderr
    const fullStdout = stdoutChunks.join("");
    const fullStderr = stderrChunks.join("");
    assert.ok(
      !fullStdout.includes(secretKey),
      "Secret API key tidak boleh muncul di log stdout",
    );
    assert.ok(
      !fullStderr.includes(secretKey),
      "Secret API key tidak boleh muncul di log stderr",
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("setupCommand non-interaktif (--yes): opsi --db neon", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "tahansoe-setup-neon-"));
  const tmpEnv = join(tmp, ".env");
  const tmpSettings = join(tmp, "settings.json");

  await writeFile(
    tmpSettings,
    JSON.stringify({ version: 2, roles: {} }),
    "utf-8",
  );

  const customEnv: NodeJS.ProcessEnv = {
    DATABASE_URL: "postgresql://neon-user:pass@ep-cool.neon.tech/main",
  };

  try {
    const exitCode = await setupCommand(
      ["--yes", "--db", "neon", "--model", "gpt-6-luna"],
      {
        env: customEnv,
        envPath: tmpEnv,
        settingsPath: tmpSettings,
        stdout: () => {},
        stderr: () => {},
        runDoctorImpl: async () => [],
      },
    );

    assert.equal(exitCode, EXIT_OK);

    const envContent = await readFile(tmpEnv, "utf-8");
    assert.match(envContent, /^DB_DRIVER=neon$/m);
    assert.match(envContent, /^DATABASE_URL=postgresql:\/\/neon-user:pass@ep-cool\.neon\.tech\/main$/m);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("setupCommand: --help menampilkan bantuan", async () => {
  const out: string[] = [];
  const exitCode = await setupCommand(["--help"], {
    stdout: (s) => out.push(s),
  });
  assert.equal(exitCode, EXIT_OK);
  assert.ok(out.join("").includes("Usage: tahansoe setup"));
});

test("askHidden: simulasi kasus REPL-aktif memastikan secret TIDAK PERNAH muncul di captured stdout", async () => {
  const secret = "8930492810:AAG_very_secret_bot_token_sample";
  const { PassThrough } = await import("node:stream");
  const inputStream = new PassThrough();
  let capturedStdout = "";
  const outputStream = new Writable({
    write(chunk, _encoding, callback) {
      capturedStdout += chunk.toString();
      callback();
    },
  });

  const readline = await import("node:readline");
  const replRl = readline.createInterface({
    input: inputStream,
    output: outputStream,
    terminal: true,
    prompt: "› ",
  });

  const hiddenPromise = askHidden("  TELEGRAM_BOT_TOKEN: ", {
    input: inputStream,
    output: outputStream,
    replRl,
  });

  // Tulis secret ke input stream
  inputStream.write(secret + "\n");

  const answer = await hiddenPromise;
  assert.equal(answer, secret);

  // Periksa captured stdout: prompt harus ada, namun secret SAMA SEKALI tidak boleh muncul
  assert.ok(capturedStdout.includes("TELEGRAM_BOT_TOKEN: "), "prompt harus muncul");
  assert.ok(!capturedStdout.includes(secret), "secret TIDAK PERNAH boleh bocor di captured stdout saat REPL aktif");
  assert.ok(!capturedStdout.includes(`› ${secret}`), "tidak boleh ada echo prompt REPL bersama secret");

  replRl.close();
});

test("setupCommand: konfigurasi neon eksisting + semua Enter -> .env dan settings.json byte-identical", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "tahansoe-setup-byte-identical-"));
  const tmpEnv = join(tmp, ".env");
  const tmpSettings = join(tmp, "settings.json");

  const initialEnvContent = [
    "LLM_API_URL=https://router.bynara.id/v1",
    "LLM_API_KEY=existing-secret-llm-key-999",
    "DB_DRIVER=neon",
    "DATABASE_URL=postgresql://neon-user:secret-pass@ep-cool.neon.tech/main",
    "RESEARCH_ENABLED=true",
    "ARBITRUM_RPC_URL=https://arb-custom.io/rpc",
    "FRED_API_KEY=fred-secret-888",
    "TELEGRAM_BOT_TOKEN=555666:Secret_TG_Token_777",
    "# TELEGRAM_ALLOWED_CHAT_IDS=",
    "# GATEWAY_ALERT_POLL_SEC=60",
    "",
  ].join("\n");

  const initialSettingsContent = JSON.stringify(
    {
      version: 2,
      roles: {
        analyst: ["gpt-6-luna", "deepseek-v4-flash"],
        debate: ["gpt-6-luna", "deepseek-v4-flash"],
        assessor: ["gpt-6-luna", "deepseek-v4-flash"],
        reflector: ["gpt-6-luna", "deepseek-v4-flash"],
        chat: ["gpt-6-luna", "deepseek-v4-flash"],
      },
    },
    null,
    2,
  ) + "\n";

  await writeFile(tmpEnv, initialEnvContent, "utf-8");
  await writeFile(tmpSettings, initialSettingsContent, "utf-8");

  const envVars: NodeJS.ProcessEnv = {
    LLM_API_URL: "https://router.bynara.id/v1",
    LLM_API_KEY: "existing-secret-llm-key-999",
    DB_DRIVER: "neon",
    DATABASE_URL: "postgresql://neon-user:secret-pass@ep-cool.neon.tech/main",
    RESEARCH_ENABLED: "true",
    ARBITRUM_RPC_URL: "https://arb-custom.io/rpc",
    FRED_API_KEY: "fred-secret-888",
    TELEGRAM_BOT_TOKEN: "555666:Secret_TG_Token_777",
  };

  // Simulasikan menekan tombol Enter (string kosong) pada seluruh prompt interaktif
  let lineIdx = 0;
  const inputStream = new Readable({
    read() {
      setTimeout(() => {
        if (lineIdx < 8) {
          lineIdx++;
          this.push("\n");
        } else {
          this.push(null);
        }
      }, 5);
    },
  });

  const stdoutChunks: string[] = [];

  const exitCode = await setupCommand([], {
    env: envVars,
    envPath: tmpEnv,
    settingsPath: tmpSettings,
    stdin: inputStream,
    stdout: (s) => stdoutChunks.push(s),
    stderr: () => {},
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: "gpt-6-luna" }] }),
      text: async () => "",
    }) as any,
    telegramGetMe: async () => ({ ok: true, username: "ExistingBot" }),
    runDoctorImpl: async () => [],
  });

  assert.equal(exitCode, EXIT_OK);

  // Verifikasi output menampilkan (current)
  const fullOut = stdoutChunks.join("");
  assert.ok(fullOut.includes("(current)"), "harus menampilkan (current) di sebelah nilai default");

  // VERIFIKASI UTAMA (Bug B): file .env dan settings.json HARUS BYTE-IDENTICAL
  const finalEnvContent = await readFile(tmpEnv, "utf-8");
  const finalSettingsContent = await readFile(tmpSettings, "utf-8");

  assert.equal(
    finalEnvContent,
    initialEnvContent,
    ".env harus persis sama (byte-identical) saat semua konfigurasi dipertahankan",
  );
  assert.equal(
    finalSettingsContent,
    initialSettingsContent,
    "settings.json harus persis sama (byte-identical) saat model dipertahankan",
  );

  await rm(tmp, { recursive: true, force: true });
});


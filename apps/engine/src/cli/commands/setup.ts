/**
 * `tahansoe setup` — Wizard konfigurasi awal terpadu (spec ADR 0009 & ADR 0010).
 *
 * Mengonfigurasi:
 *  1. LLM gateway: LLM_API_URL dan LLM_API_KEY (input tersembunyi, tes GET /models 25s).
 *  2. Pilihan model: Rekomendasi gpt-6-luna untuk seluruh peran (eval 24/24) dengan
 *     fallback deepseek-v4-flash, atau pilihan dari daftar gateway / custom.
 *  3. Database: PGlite (default lokal tanpa akun) atau Neon (cloud via DATABASE_URL).
 *     Menjalankan migrasi langsung untuk PGlite (ensureDb).
 *  4. Opsional: ARBITRUM_RPC_URL (Enter = public RPC), FRED_API_KEY (tersembunyi),
 *     dan RESEARCH_ENABLED (default true).
 *  5. Menyimpan secret hanya ke apps/engine/.env via env-writer (mempertahankan baris lain).
 *  6. Menyimpan konfigurasi non-secret (roles) ke settings.json.
 *  7. Menjalankan doctor dan mencetak langkah selanjutnya.
 *
 * Mendukung mode non-interaktif (--yes) untuk otomasi scripting dan pengujian.
 */

import { parseArgs } from "node:util";
import * as readline from "node:readline";
import { Writable } from "node:stream";
import pc from "picocolors";

import { EXIT_OK, EXIT_ERROR, EXIT_CONFIG } from "./args.ts";
import { detectTheme, maskHost, type Theme } from "../render.ts";
import { writeEnvUpdates, defaultEnvPath } from "../env-writer.ts";
import { loadSettingsSync, writeSettings, settingsPath } from "../../settings/settings.ts";
import { runDoctor, formatDoctor, type DoctorFetch, type CheckResult } from "./doctor.ts";

export const SETUP_HELP = `tahansoe setup — wizard konfigurasi awal (gateway, models, database, telegram)

Usage: tahansoe setup [options]

Options:
  --yes                        Mode non-interaktif (otomatis dengan opsi yang diberikan/default)
  --llm-url <url>              URL endpoint LLM gateway (default: https://router.bynara.id/v1)
  --llm-key-env <NAME>         Nama env var yang memuat LLM_API_KEY (jangan lewat argv)
  --db <pglite|neon>           Pilihan database: pglite (lokal, default) atau neon (cloud)
  --model <name>               Model acuan untuk seluruh peran (default: gpt-6-luna)
  --telegram-token-env <NAME>  Nama env var yang memuat TELEGRAM_BOT_TOKEN (jangan lewat argv)
  --skip-telegram              Lewati langkah konfigurasi Telegram
  --target-env <path>          Override path file .env target (default: apps/engine/.env).
                               (Bukan --env-file: nama itu ditangkap Node.js sebelum sampai ke CLI.)
  --no-color                   Nonaktifkan ANSI colors
  --help                       Tampilkan bantuan ini`;

export interface SetupDeps {
  stdin?: NodeJS.ReadableStream;
  outputStream?: NodeJS.WritableStream;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
  fetchImpl?: DoctorFetch;
  envPath?: string;
  settingsPath?: string;
  ensureDbImpl?: () => Promise<unknown>;
  runDoctorImpl?: (deps?: Record<string, unknown>) => Promise<CheckResult[]>;
  env?: NodeJS.ProcessEnv;
  telegramGetMe?: (token: string) => Promise<{ ok: boolean; username?: string; error?: string }>;
  startGateway?: (opts?: unknown) => Promise<{
    stop: () => Promise<void>;
    pairing?: {
      createPairingCode: (channel: string) => { code: string; expiresAt: Date | number };
      pairingStatus: (code: string) => { status: "pending" | "paired" | "expired"; chatId?: string | number };
    };
  }>;
  sleepImpl?: (ms: number) => Promise<void>;
}

/** Sensor chat ID agar id privat tidak tercetak penuh ke log/layar. */
export function maskChatId(chatId: string | number): string {
  const s = String(chatId).trim();
  if (!s || s.length <= 4) return "****";
  return `${s.slice(0, 2)}****${s.slice(-2)}`;
}

export async function defaultTelegramGetMe(
  token: string,
): Promise<{ ok: boolean; username?: string; error?: string }> {
  try {
    // @ts-ignore - concurrently built by Antigravity #1
    const { telegramGetMe } = await import("../../gateway/telegram/api.ts");
    return await telegramGetMe(token);
  } catch {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      const data = (await res.json()) as any;
      if (data?.ok && data?.result?.username) {
        return { ok: true, username: data.result.username };
      }
      return { ok: false, error: data?.description || `HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

async function defaultStartGateway(opts?: unknown) {
  // @ts-ignore - concurrently built by Antigravity #1
  const { startGateway } = await import("../../gateway/index.ts");
  return startGateway(opts);
}

/**
 * Helper input teks tersembunyi (password/API key) yang tidak pernah di-echo
 * ke terminal atau dicetak ke stdout/stderr.
 */
export async function askHidden(
  promptText: string,
  options: {
    input?: NodeJS.ReadableStream;
    output?: NodeJS.WritableStream;
    existing?: string;
  } = {},
): Promise<string> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;

  return new Promise((resolve) => {
    let muted = false;
    const mutableStdout = new Writable({
      write(chunk, encoding, callback) {
        if (!muted) {
          output.write(chunk, encoding);
        }
        callback();
      },
    });

    const rl = readline.createInterface({
      input,
      output: mutableStdout,
      terminal: Boolean((input as any).isTTY),
    });

    output.write(promptText);
    muted = true;

    rl.question("", (answer) => {
      muted = false;
      output.write("\n");
      rl.close();
      const trimmed = answer.trim();
      if (!trimmed && options.existing) {
        resolve(options.existing);
      } else {
        resolve(trimmed);
      }
    });
  });
}

/**
 * Helper input teks biasa.
 */
export async function askQuestion(
  promptText: string,
  options: {
    input?: NodeJS.ReadableStream;
    output?: NodeJS.WritableStream;
    defaultValue?: string;
  } = {},
): Promise<string> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;

  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input,
      output,
      terminal: Boolean((input as any).isTTY),
    });

    rl.question(promptText, (answer) => {
      rl.close();
      const trimmed = answer.trim();
      resolve(trimmed || options.defaultValue || "");
    });
  });
}

/**
 * Tes konektivitas endpoint GET {url}/models (timeout 25 detik).
 */
export async function testGateway(
  url: string,
  apiKey: string,
  fetchImpl: DoctorFetch = globalThis.fetch as unknown as DoctorFetch,
): Promise<{ ok: boolean; count: number; error?: string }> {
  const normUrl = url.replace(/\/+$/, "");
  const endpoint = normUrl.endsWith("/models") ? normUrl : `${normUrl}/models`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25_000);
  try {
    const headers: Record<string, string> = { accept: "application/json" };
    if (apiKey) {
      headers["authorization"] = `Bearer ${apiKey}`;
    }
    const res = await fetchImpl(endpoint, {
      method: "GET",
      headers,
      signal: ctrl.signal,
    });
    if (!res.ok) {
      return { ok: false, count: 0, error: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as any;
    const list = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
    return { ok: true, count: list.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, count: 0, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

export async function setupCommand(argv: string[], deps: SetupDeps = {}): Promise<number> {
  const writeOut = deps.stdout ?? ((s: string) => void process.stdout.write(s));
  const writeErr = deps.stderr ?? ((s: string) => void process.stderr.write(s));
  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetchImpl ?? (globalThis.fetch as unknown as DoctorFetch);

  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        yes: { type: "boolean" },
        "llm-url": { type: "string" },
        "llm-key-env": { type: "string" },
        db: { type: "string" },
        model: { type: "string" },
        "telegram-token-env": { type: "string" },
        "skip-telegram": { type: "boolean" },
        "target-env": { type: "string" },
        "no-color": { type: "boolean" },
        help: { type: "boolean" },
      },
      allowPositionals: false,
    });
  } catch (err) {
    writeErr(`argumen tidak valid: ${err instanceof Error ? err.message : String(err)}\n`);
    return EXIT_ERROR;
  }

  const f = parsed.values;
  if (f.help) {
    writeOut(SETUP_HELP + "\n");
    return EXIT_OK;
  }

  const theme: Theme = detectTheme(argv, env, process.stdout);
  const isNonInteractive = Boolean(f.yes);
  const targetEnvPath =
    deps.envPath ??
    (f["target-env"] ? String(f["target-env"]) : undefined) ??
    defaultEnvPath(env);
  const targetSettingsPath = deps.settingsPath ?? settingsPath(env);

  writeOut(pc.bold("\n=== Tahansoe Setup Wizard ===\n"));
  writeOut("Konfigurasi LLM gateway, model riset, dan database untuk Core Risk Engine.\n\n");

  let apiUrl = "";
  let apiKey = "";
  let dbDriver = "pglite";
  let databaseUrl = "";
  let selectedModel = "gpt-6-luna";
  let arbitrumRpcUrl = "";
  let fredApiKey = "";
  let telegramToken = "";

  // -------------------------------------------------------------------------
  // 1. LLM Gateway & API Key
  // -------------------------------------------------------------------------
  if (isNonInteractive) {
    apiUrl = f["llm-url"] || env.LLM_API_URL || "https://router.bynara.id/v1";
    if (f["llm-key-env"]) {
      apiKey = env[f["llm-key-env"]] || "";
    } else {
      apiKey = env.LLM_API_KEY || "";
    }
    dbDriver = f.db?.toLowerCase() === "neon" ? "neon" : "pglite";
    if (dbDriver === "neon") {
      databaseUrl = env.DATABASE_URL || "";
    }
    selectedModel = f.model || "gpt-6-luna";

    const skipTelegram = Boolean(f["skip-telegram"]);
    if (!skipTelegram) {
      if (f["telegram-token-env"]) {
        telegramToken = env[String(f["telegram-token-env"])] || "";
      } else {
        telegramToken = env.TELEGRAM_BOT_TOKEN || "";
      }

      if (telegramToken) {
        writeOut("Memvalidasi bot token Telegram...\n");
        const getMe = deps.telegramGetMe ?? defaultTelegramGetMe;
        const meRes = await getMe(telegramToken);
        if (meRes.ok && meRes.username) {
          writeOut(pc.green(`✔ Bot Telegram terverifikasi: @${meRes.username}\n`));
          try {
            const startGw = deps.startGateway ?? defaultStartGateway;
            const gw = await startGw({
              logger: { info: () => {}, warn: () => {}, error: () => {} },
            });
            if (gw?.pairing) {
              const { code } = gw.pairing.createPairingCode("telegram");
              writeOut(`Send /start ${code} to @${meRes.username} within 10 minutes\n`);
              const sleep = deps.sleepImpl ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
              let paired = false;
              let expired = false;
              const maxPolls = 200;
              for (let i = 0; i < maxPolls; i++) {
                const pStatus = gw.pairing.pairingStatus(code);
                if (pStatus.status === "paired") {
                  paired = true;
                  writeOut(pc.green(`✔ Berhasil terhubung dengan chat ${maskChatId(pStatus.chatId ?? "")}\n`));
                  break;
                } else if (pStatus.status === "expired") {
                  expired = true;
                  writeOut(pc.yellow("Kode pairing kedaluwarsa.\n"));
                  break;
                }
                await sleep(3000);
              }
            }
            if (gw) await gw.stop();
          } catch (gwErr) {
            writeErr(pc.yellow(`Perhatian: temporary gateway pairing: ${gwErr instanceof Error ? gwErr.message : String(gwErr)}\n`));
          }
        } else {
          writeErr(pc.yellow(`Perhatian: Token Telegram tidak valid: ${meRes.error ?? "gagal verifikasi"}\n`));
        }
      }
    }
  } else {
    // Mode Interaktif
    writeOut(pc.cyan("1. LLM Gateway (OpenAI-compatible)\n"));
    const defaultUrl = env.LLM_API_URL || "https://router.bynara.id/v1";
    apiUrl = await askQuestion(`  LLM_API_URL [${defaultUrl}]: `, {
      input: deps.stdin,
      output: deps.outputStream,
      defaultValue: defaultUrl,
    });

    const existingKey = env.LLM_API_KEY || "";
    const keyPrompt = existingKey
      ? "  LLM_API_KEY [set (hidden)]: "
      : "  LLM_API_KEY: ";

    let gatewayReady = false;
    while (!gatewayReady) {
      apiKey = await askHidden(keyPrompt, {
        input: deps.stdin,
        output: deps.outputStream,
        existing: existingKey,
      });

      writeOut(`  Menguji koneksi ke ${maskHost(apiUrl)}/models...\n`);
      const testResult = await testGateway(apiUrl, apiKey, fetchImpl);
      if (testResult.ok) {
        writeOut(pc.green(`  ✔ Gateway terhubung (${testResult.count} model tersedia)\n\n`));
        gatewayReady = true;
      } else {
        writeOut(pc.yellow(`  ✖ Gagal menghubungi gateway: ${testResult.error}\n`));
        const action = await askQuestion("  Pilihan: [r] Coba lagi / [c] Tetap lanjutkan [c]: ", {
          input: deps.stdin,
          output: deps.outputStream,
          defaultValue: "c",
        });
        if (action.toLowerCase() !== "r") {
          gatewayReady = true;
          writeOut("\n");
        }
      }
    }

    // -----------------------------------------------------------------------
    // 2. Pemilihan Model
    // -----------------------------------------------------------------------
    writeOut(pc.cyan("2. Model Riset & Chat\n"));
    writeOut("  [1] Rekomendasi: gpt-6-luna untuk semua peran (eval 24/24, ~Rp 1-2 per tanya) [default]\n");
    writeOut("  [2] Masukkan nama model custom\n");
    const modelChoice = await askQuestion("  Pilihan [1]: ", {
      input: deps.stdin,
      output: deps.outputStream,
      defaultValue: "1",
    });

    if (modelChoice === "2") {
      selectedModel = await askQuestion("  Nama model: ", {
        input: deps.stdin,
        output: deps.outputStream,
        defaultValue: "gpt-6-luna",
      });
    } else {
      selectedModel = "gpt-6-luna";
    }
    writeOut(pc.green(`  ✔ Model dipilih: ${selectedModel} (fallback: deepseek-v4-flash)\n\n`));

    // -----------------------------------------------------------------------
    // 3. Database Choice
    // -----------------------------------------------------------------------
    writeOut(pc.cyan("3. Database Engine\n"));
    writeOut("  [1] PGlite (lokal, embedded Postgres WASM — tanpa server/akun cloud, default)\n");
    writeOut("  [2] Neon (cloud serverless Postgres — butuh DATABASE_URL)\n");
    const dbChoice = await askQuestion("  Pilihan [1]: ", {
      input: deps.stdin,
      output: deps.outputStream,
      defaultValue: "1",
    });

    if (dbChoice === "2") {
      dbDriver = "neon";
      const existingDbUrl = env.DATABASE_URL || "";
      const dbUrlPrompt = existingDbUrl
        ? "  DATABASE_URL [set (hidden)]: "
        : "  DATABASE_URL: ";
      databaseUrl = await askHidden(dbUrlPrompt, {
        input: deps.stdin,
        output: deps.outputStream,
        existing: existingDbUrl,
      });
      writeOut(pc.green("  ✔ Driver database: neon\n\n"));
    } else {
      dbDriver = "pglite";
      writeOut(pc.green("  ✔ Driver database: pglite (lokal: apps/engine/.data/pglite)\n\n"));
    }

    // -----------------------------------------------------------------------
    // 4. Kanal & Notifikasi Telegram (Opsional)
    // -----------------------------------------------------------------------
    const skipTelegram = Boolean(f["skip-telegram"]);
    if (!skipTelegram) {
      writeOut(pc.cyan("4. Kanal & Notifikasi Telegram (Opsional)\n"));
      writeOut("  Hubungkan bot Telegram untuk menerima alert risiko & perintah chat.\n");
      writeOut("  Buat bot baru di @BotFather di Telegram untuk mendapatkan bot token.\n");

      const existingTgToken = env.TELEGRAM_BOT_TOKEN || "";
      const tgPrompt = existingTgToken
        ? "  TELEGRAM_BOT_TOKEN [set (hidden), Enter = simpan]: "
        : "  TELEGRAM_BOT_TOKEN [Enter = lewati]: ";

      let tgReady = false;
      while (!tgReady) {
        telegramToken = await askHidden(tgPrompt, {
          input: deps.stdin,
          output: deps.outputStream,
          existing: existingTgToken,
        });

        if (!telegramToken) {
          writeOut("  Langkah Telegram dilewati.\n\n");
          tgReady = true;
          break;
        }

        writeOut("  Memverifikasi token bot Telegram...\n");
        const getMe = deps.telegramGetMe ?? defaultTelegramGetMe;
        const meRes = await getMe(telegramToken);
        if (meRes.ok && meRes.username) {
          writeOut(pc.green(`  ✔ Bot terhubung: @${meRes.username}\n\n`));
          tgReady = true;

          // Temporary in-process gateway pairing
          writeOut(pc.cyan("  Pairing Chat Telegram:\n"));
          let gw: any = null;
          try {
            const startGw = deps.startGateway ?? defaultStartGateway;
            gw = await startGw({
              logger: { info: () => {}, warn: () => {}, error: () => {} },
            });
            if (gw?.pairing) {
              const { code } = gw.pairing.createPairingCode("telegram");
              writeOut(`  Send ${pc.bold(`/start ${code}`)} to @${meRes.username} within 10 minutes\n`);
              writeOut("  Menunggu pesan pairing (Ctrl+C untuk melewati)...\n");

              let aborted = false;
              const onSigInt = () => {
                aborted = true;
              };
              process.once("SIGINT", onSigInt);

              const sleep = deps.sleepImpl ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
              let pollCount = 0;
              const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
              while (!aborted) {
                if (process.stdout.isTTY) {
                  const spinChar = SPINNER[pollCount % SPINNER.length];
                  process.stdout.write(`\r  ${spinChar} Menunggu /start ${code}...`);
                }
                await sleep(3000);
                if (aborted) break;
                pollCount++;
                const pStatus = gw.pairing.pairingStatus(code);
                if (pStatus.status === "paired") {
                  if (process.stdout.isTTY) process.stdout.write("\r\x1b[K");
                  writeOut(pc.green(`  ✔ Berhasil terhubung dengan chat ${maskChatId(pStatus.chatId ?? "")}\n\n`));
                  break;
                } else if (pStatus.status === "expired") {
                  if (process.stdout.isTTY) process.stdout.write("\r\x1b[K");
                  writeOut(pc.yellow("  Kode pairing telah kedaluwarsa. Anda dapat melakukan pairing nanti.\n\n"));
                  break;
                }
              }
              process.removeListener("SIGINT", onSigInt);
              if (aborted) {
                if (process.stdout.isTTY) process.stdout.write("\r\x1b[K");
                writeOut("\n  Pairing dilewati.\n\n");
              }
            } else {
              writeOut("  Pairing API tidak tersedia, pairing dilewati.\n\n");
            }
          } catch (err) {
            writeErr(pc.yellow(`  Gagal menjalankan gateway pairing: ${err instanceof Error ? err.message : String(err)}\n\n`));
          } finally {
            if (gw) {
              try {
                await gw.stop();
              } catch {
                /* abaikan */
              }
            }
          }
        } else {
          writeOut(pc.yellow(`  ✖ Token Telegram tidak valid: ${meRes.error ?? "HTTP error"}\n`));
          const action = await askQuestion("  Pilihan: [r] Coba lagi / [s] Lewati Telegram / [c] Tetap simpan token [c]: ", {
            input: deps.stdin,
            output: deps.outputStream,
            defaultValue: "c",
          });
          const act = action.toLowerCase();
          if (act === "s") {
            telegramToken = "";
            tgReady = true;
            writeOut("\n");
          } else if (act !== "r") {
            tgReady = true;
            writeOut("\n");
          }
        }
      }
    }

    // -----------------------------------------------------------------------
    // 5. Pengaturan Tambahan (Opsional)
    // -----------------------------------------------------------------------
    writeOut(pc.cyan("5. Pengaturan Tambahan (Opsional)\n"));
    const rpcPrompt = "  ARBITRUM_RPC_URL [Enter = RPC publik https://arb1.arbitrum.io/rpc]: ";
    arbitrumRpcUrl = await askQuestion(rpcPrompt, {
      input: deps.stdin,
      output: deps.outputStream,
      defaultValue: "",
    });

    const fredPrompt = "  FRED_API_KEY [opsional untuk kalender/makro, Enter = lewati]: ";
    fredApiKey = await askHidden(fredPrompt, {
      input: deps.stdin,
      output: deps.outputStream,
      existing: env.FRED_API_KEY || "",
    });
    writeOut("\n");
  }

  // -------------------------------------------------------------------------
  // 6. Eksekusi Migrasi DB (PGlite)
  // -------------------------------------------------------------------------
  if (dbDriver === "pglite") {
    process.env.DB_DRIVER = "pglite";
    env.DB_DRIVER = "pglite";
    writeOut("Menyiapkan database PGlite lokal...\n");
    try {
      if (deps.ensureDbImpl) {
        await deps.ensureDbImpl();
      } else {
        const { ensureDb } = await import("@tahansoe/db");
        await ensureDb();
      }
      writeOut(pc.green("✔ Database PGlite siap & migrasi skema selesai.\n"));
    } catch (err) {
      writeErr(pc.yellow(`Perhatian: Migrasi PGlite: ${err instanceof Error ? err.message : String(err)}\n`));
    }
  }

  // -------------------------------------------------------------------------
  // 7. Penulisan ke .env via env-writer & settings.json
  // -------------------------------------------------------------------------
  writeOut("Menyimpan konfigurasi...\n");

  const envUpdates: Record<string, string> = {
    LLM_API_URL: apiUrl,
    LLM_API_KEY: apiKey,
    DB_DRIVER: dbDriver,
    RESEARCH_ENABLED: "true",
  };

  if (dbDriver === "pglite") {
    envUpdates.PGLITE_DATA_DIR = "apps/engine/.data/pglite";
  } else if (databaseUrl) {
    envUpdates.DATABASE_URL = databaseUrl;
  }

  if (arbitrumRpcUrl) {
    envUpdates.ARBITRUM_RPC_URL = arbitrumRpcUrl;
  }
  if (fredApiKey) {
    envUpdates.FRED_API_KEY = fredApiKey;
  }
  if (telegramToken) {
    envUpdates.TELEGRAM_BOT_TOKEN = telegramToken;
  }

  await writeEnvUpdates({
    envPath: targetEnvPath,
    updates: envUpdates,
    commentedDefaults: [
      "# TELEGRAM_ALLOWED_CHAT_IDS=",
      "# GATEWAY_ALERT_POLL_SEC=60",
    ],
  });

  // Terapkan ke proses saat ini agar doctor langsung mendeteksi perubahan
  env.LLM_API_URL = apiUrl;
  env.LLM_API_KEY = apiKey;
  env.DB_DRIVER = dbDriver;
  env.RESEARCH_ENABLED = "true";
  if (dbDriver === "pglite") env.PGLITE_DATA_DIR = "apps/engine/.data/pglite";
  else if (databaseUrl) env.DATABASE_URL = databaseUrl;
  if (arbitrumRpcUrl) env.ARBITRUM_RPC_URL = arbitrumRpcUrl;
  if (fredApiKey) env.FRED_API_KEY = fredApiKey;
  if (telegramToken) env.TELEGRAM_BOT_TOKEN = telegramToken;

  // Update settings.json
  try {
    const { settings } = loadSettingsSync(targetSettingsPath);
    const updatedSettings = {
      ...settings,
      roles: {
        analyst: [selectedModel, "deepseek-v4-flash"],
        debate: [selectedModel, "deepseek-v4-flash"],
        assessor: [selectedModel, "deepseek-v4-flash"],
        reflector: [selectedModel, "deepseek-v4-flash"],
        chat: [selectedModel, "deepseek-v4-flash"],
      },
    };
    await writeSettings(updatedSettings, targetSettingsPath);
  } catch (err) {
    writeErr(pc.yellow(`Peringatan menyimpan settings: ${err instanceof Error ? err.message : String(err)}\n`));
  }

  writeOut(pc.green(`✔ Konfigurasi tersimpan di .env dan settings.json.\n\n`));

  // -------------------------------------------------------------------------
  // 8. Menjalankan Doctor & Menampilkan Langkah Berikutnya
  // -------------------------------------------------------------------------
  writeOut(pc.bold("Pemeriksaan Kesehatan Konfigurasi (Doctor):\n"));
  try {
    const runDoc = deps.runDoctorImpl ?? runDoctor;
    const doctorResults = await runDoc({
      env,
      fetchImpl,
    });
    writeOut(formatDoctor(theme, doctorResults) + "\n\n");
  } catch (err) {
    writeErr(`Gagal menjalankan doctor: ${err instanceof Error ? err.message : String(err)}\n\n`);
  }

  writeOut(pc.bold("Setup selesai! Langkah selanjutnya:\n"));
  writeOut("  tahansoe start                 — jalankan agent mandiri penuh (riset + fusi + gateway Telegram)\n");
  writeOut("  tahansoe                       — buka mode interaktif REPL & tanya-jawab\n");
  writeOut("  tahansoe analyze               — jalankan satu putaran riset & kartu laporan\n");
  writeOut("  tahansoe schedule run --with-price — jalankan worker riset berkala di background\n\n");

  return EXIT_OK;
}

/**
 * `tahansoe gateway pair` & `tahansoe gateway status` (spec m3-channel-gateway-telegram §7).
 *
 * `gateway pair`:
 *  - Membuat kode pairing via createPairingCode;
 *  - Memulai temporary gateway via startGateway({ telegramToken }) jika belum ada agent yang berjalan;
 *  - Jika terdeteksi conflict (agent lain sudah polling), cetak info dan cukup polling status;
 *  - Menampilkan "Send /start CODE to @username within 10 minutes" dengan spinner 3s;
 *  - Ctrl+C membatalkan secara bersih tanpa efek samping.
 *
 * `gateway status`:
 *  - Menampilkan bot username (@username via getMe);
 *  - Jumlah chat yang diizinkan dengan masked IDs;
 *  - Status apakah agent tampak sedang melakukan polling.
 */

import { readFileSync } from "node:fs";
import * as readline from "node:readline";
import { parseArgs } from "node:util";
import pc from "picocolors";

import { EXIT_OK, EXIT_CONFIG, EXIT_ERROR } from "./args.ts";
import { maskChatId, defaultTelegramGetMe } from "./setup.ts";
import { loadSettingsSync, settingsPath as defaultSettingsPath } from "../../settings/settings.ts";

export const GATEWAY_PAIR_HELP = `tahansoe gateway pair — hubungkan chat Telegram via kode pairing 10 menit

Usage:
  tahansoe gateway pair [options]

Options:
  --delete-webhook  Hapus webhook Telegram yang aktif sebelum memulai pairing (butuh konfirmasi)
  --no-color        Nonaktifkan ANSI colors
  --help            Tampilkan bantuan ini`;

export const GATEWAY_STATUS_HELP = `tahansoe gateway status — tampilkan status bot Telegram dan chat yang terdaftar

Usage:
  tahansoe gateway status [options]

Options:
  --no-color   Nonaktifkan ANSI colors
  --help       Tampilkan bantuan ini`;

export interface GatewayPairDeps {
  env?: NodeJS.ProcessEnv;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
  outputStream?: NodeJS.WritableStream;
  inputStream?: NodeJS.ReadableStream;
  replRl?: readline.Interface;
  createPairingCode?: (channel: string, statePath?: string) => { code: string; expiresAt: Date | number };
  pairingStatus?: (code: string, statePath?: string) => { status: "pending" | "paired" | "expired"; chatId?: string | number };
  startGateway?: (opts?: unknown) => Promise<{
    stop: () => Promise<void>;
    status?: string | { telegram?: string; webhookHost?: string };
    webhookHost?: string;
    pairing?: {
      createPairingCode: (channel: string) => { code: string; expiresAt: Date | number };
      pairingStatus: (code: string) => { status: "pending" | "paired" | "expired"; chatId?: string | number };
    };
  }>;
  telegramGetMe?: (token: string) => Promise<{ ok: boolean; username?: string; error?: string }>;
  telegramGetWebhookInfo?: (token: string) => Promise<{ ok: boolean; url?: string; host?: string; error?: string }>;
  telegramDeleteWebhook?: (token: string) => Promise<{ ok: boolean; result?: boolean; error?: string }>;
  confirmDeleteWebhook?: (host: string) => Promise<boolean>;
  gatewayListening?: (gw?: unknown) => Promise<boolean> | boolean;
  sleepImpl?: (ms: number) => Promise<void>;
  settingsPath?: string;
  statePath?: string;
}

export interface GatewayStatusDeps {
  env?: NodeJS.ProcessEnv;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
  telegramGetMe?: (token: string) => Promise<{ ok: boolean; username?: string; error?: string }>;
  telegramGetWebhookInfo?: (token: string) => Promise<{ ok: boolean; url?: string; host?: string; error?: string }>;
  gatewayListening?: (gw?: unknown) => Promise<boolean> | boolean;
  settingsPath?: string;
  statePath?: string;
}

export async function defaultTelegramGetWebhookInfo(
  token: string,
): Promise<{ ok: boolean; url?: string; host?: string; error?: string }> {
  try {
    // @ts-ignore - concurrently built by Antigravity #1
    const { telegramGetWebhookInfo } = await import("../../gateway/telegram/api.ts");
    if (typeof telegramGetWebhookInfo === "function") {
      return await telegramGetWebhookInfo(token);
    }
  } catch {
    /* fallback */
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
    const data = (await res.json()) as any;
    if (data?.ok && data?.result) {
      const rawUrl = data.result.url ?? "";
      let host: string | undefined;
      if (rawUrl) {
        try {
          host = new URL(rawUrl).host;
        } catch {
          host = rawUrl;
        }
      }
      return { ok: true, url: rawUrl, host };
    }
    return { ok: false, error: data?.description || `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function defaultTelegramDeleteWebhook(
  token: string,
): Promise<{ ok: boolean; result?: boolean; error?: string }> {
  try {
    // @ts-ignore - concurrently built by Antigravity #1
    const { telegramDeleteWebhook } = await import("../../gateway/telegram/api.ts");
    if (typeof telegramDeleteWebhook === "function") {
      return await telegramDeleteWebhook(token, { dropPendingUpdates: true });
    }
  } catch {
    /* fallback */
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ drop_pending_updates: true }),
    });
    const data = (await res.json()) as any;
    if (data?.ok) {
      return { ok: true, result: data.result ?? true };
    }
    return { ok: false, error: data?.description || `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function askConfirmation(
  promptText: string,
  deps: {
    input?: NodeJS.ReadableStream;
    output?: NodeJS.WritableStream;
    replRl?: readline.Interface;
  },
): Promise<boolean> {
  const input = deps.input ?? process.stdin;
  const output = deps.output ?? process.stdout;
  const replRl = deps.replRl;

  let restoreRepl: (() => void) | undefined;
  if (replRl && typeof replRl.pause === "function") {
    try {
      replRl.pause();
      restoreRepl = () => {
        try {
          replRl.resume();
        } catch {
          /* abaikan */
        }
      };
    } catch {
      /* abaikan */
    }
  }

  try {
    return await new Promise<boolean>((resolve) => {
      const rl = readline.createInterface({
        input,
        output,
        terminal: Boolean((input as any).isTTY),
      });

      rl.question(promptText, (ans) => {
        rl.close();
        const trimmed = ans.trim().toLowerCase();
        resolve(trimmed === "y" || trimmed === "yes");
      });
    });
  } finally {
    if (restoreRepl) {
      restoreRepl();
    }
  }
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

async function resolvePairingHelpers(deps: GatewayPairDeps) {
  let createCodeFn = deps.createPairingCode;
  let statusFn = deps.pairingStatus;

  if (!createCodeFn || !statusFn) {
    try {
      // @ts-ignore - concurrently built by Antigravity #1
      const pairingMod = await import("../../gateway/pairing.ts");
      if (typeof pairingMod.createPairingCode === "function") {
        createCodeFn = createCodeFn ?? pairingMod.createPairingCode;
      }
      if (typeof pairingMod.pairingStatus === "function") {
        statusFn = statusFn ?? pairingMod.pairingStatus;
      }
    } catch {
      /* fallback */
    }
  }

  return { createCodeFn, statusFn };
}

export async function gatewayPairCommand(argv: string[], deps: GatewayPairDeps = {}): Promise<number> {
  const writeOut = deps.stdout ?? ((s: string) => void process.stdout.write(s));
  const writeErr = deps.stderr ?? ((s: string) => void process.stderr.write(s));
  const env = deps.env ?? process.env;

  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        help: { type: "boolean" },
        "no-color": { type: "boolean" },
        "delete-webhook": { type: "boolean" },
      },
      allowPositionals: false,
    });
  } catch (err) {
    writeErr(`argumen tidak valid: ${err instanceof Error ? err.message : String(err)}\n`);
    return EXIT_ERROR;
  }

  if (parsed.values.help) {
    writeOut(GATEWAY_PAIR_HELP + "\n");
    return EXIT_OK;
  }

  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    writeErr(
      pc.yellow("TELEGRAM_BOT_TOKEN tidak ditemukan di env. Jalankan 'tahansoe setup' terlebih dahulu.\n"),
    );
    return EXIT_CONFIG;
  }

  // 1. Dapatkan info bot via getMe
  const getMe = deps.telegramGetMe ?? defaultTelegramGetMe;
  const meRes = await getMe(token);
  const botUsername = meRes.ok && meRes.username ? meRes.username : "bot";

  // 2. Cek apakah flag --delete-webhook diberikan
  const deleteWebhookRequested = Boolean(parsed.values["delete-webhook"]);
  const getWebhookInfo = deps.telegramGetWebhookInfo ?? defaultTelegramGetWebhookInfo;

  // Cek webhook DI AWAL (sebelum membuat kode): bila bot memakai webhook, pesan
  // /start tidak akan pernah sampai ke Tahansoe, jadi jangan tampilkan kode.
  let activeWebhookHost = "";
  try {
    const info = await getWebhookInfo(token);
    if (info?.ok && info.host) {
      activeWebhookHost = info.host;
    }
  } catch {
    /* abaikan: polling nanti tetap mendeteksi 409 */
  }

  if (activeWebhookHost && !deleteWebhookRequested) {
    writeOut(
      pc.yellow(
        `This bot uses a webhook to ${activeWebhookHost}. Messages go there, not to Tahansoe, so pairing cannot work yet.
`,
      ),
    );
    const interactive = Boolean(deps.confirmDeleteWebhook || deps.inputStream || (process.stdin.isTTY && process.stdout.isTTY));
    if (!interactive) {
      writeOut("Use a dedicated bot, or run: tahansoe gateway pair --delete-webhook\n");
      return EXIT_ERROR;
    }
  }

  if (deleteWebhookRequested || activeWebhookHost) {
    const host = activeWebhookHost;
    if (!host) {
      writeOut("No active webhook on this bot; nothing to delete.\n");
    }
  }

  if (activeWebhookHost) {
    const targetHost = activeWebhookHost;
    let confirmed = false;
    if (deps.confirmDeleteWebhook) {
      confirmed = await deps.confirmDeleteWebhook(targetHost);
    } else {
      const prompt = `This bot currently sends updates to webhook: ${targetHost}\nDelete active webhook to ${targetHost} and switch bot to Tahansoe polling? [y/N]: `;
      confirmed = await askConfirmation(prompt, {
        input: deps.inputStream,
        output: deps.outputStream,
        replRl: deps.replRl,
      });
    }

    if (!confirmed) {
      writeOut("Dibatalkan: webhook tidak dihapus.\n");
      return EXIT_OK;
    }

    const deleteWebhookFn = deps.telegramDeleteWebhook ?? defaultTelegramDeleteWebhook;
    const delRes = await deleteWebhookFn(token);
    if (!delRes.ok) {
      writeErr(pc.red(`Gagal menghapus webhook: ${delRes.error || "unknown error"}\n`));
      return EXIT_ERROR;
    }
    writeOut(pc.green(`✔ Webhook ke ${targetHost} berhasil dihapus.\n`));
  }

  // 3. Siapkan pairing code helper
  let { createCodeFn, statusFn } = await resolvePairingHelpers(deps);

  // 4. Mulai temporary gateway jika diperlukan
  let gw: any = null;
  let alreadyRunning = false;

  const startGw =
    deps.startGateway ??
    (async (opts?: unknown) => {
      // @ts-ignore - concurrently built by Antigravity #1
      const { startGateway } = await import("../../gateway/index.ts");
      return startGateway(opts);
    });

  try {
    gw = await startGw({
      telegramToken: token,
      deleteWebhook: deleteWebhookRequested,
      env,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      settingsPath: deps.settingsPath,
      statePath: deps.statePath,
    });

    const isListening = deps.gatewayListening ?? (async (instance?: unknown) => {
      try {
        // @ts-ignore
        const { gatewayListening } = await import("../../gateway/index.ts");
        return typeof gatewayListening === "function" ? gatewayListening(instance) : false;
      } catch {
        return false;
      }
    });

    const gwStatusStr = typeof gw?.status === "string" ? gw.status : gw?.status?.telegram;
    if (gwStatusStr === "webhook_active") {
      let host = gw?.webhookHost ?? gw?.status?.webhookHost;
      if (!host) {
        const info = await getWebhookInfo(token).catch(() => ({ ok: false }));
        if (info && (info as any).host) {
          host = (info as any).host;
        }
      }
      const targetHost = host || "external host";
      writeOut(
        pc.yellow(
          `This bot uses a webhook to ${targetHost}. Messages go there, not to Tahansoe. Use a dedicated bot, or run: tahansoe gateway pair --delete-webhook\n`,
        ),
      );
      if (gw) {
        await gw.stop().catch(() => {});
      }
      return EXIT_ERROR;
    }

    if (gw?.status === "conflict" || gwStatusStr === "conflict" || (await isListening(gw))) {
      writeOut("Agent is already running; it will handle the pairing\n");
      alreadyRunning = true;
    } else if (gw?.pairing) {
      if (!deps.createPairingCode) {
        createCodeFn = (ch: string) => gw.pairing.createPairingCode(ch);
      }
      if (!deps.pairingStatus) {
        statusFn = (cd: string) => gw.pairing.pairingStatus(cd);
      }
    }
  } catch (err: any) {
    const msg = String(err?.message || "");
    if (
      err?.status === "webhook_active" ||
      msg.includes("webhook is active") ||
      msg.includes("webhook_active") ||
      msg.includes("webhook")
    ) {
      let host = err?.webhookHost ?? err?.host;
      if (!host) {
        const info = await getWebhookInfo(token).catch(() => ({ ok: false }));
        if (info && (info as any).host) {
          host = (info as any).host;
        }
      }
      const targetHost = host || "external host";
      writeOut(
        pc.yellow(
          `This bot uses a webhook to ${targetHost}. Messages go there, not to Tahansoe. Use a dedicated bot, or run: tahansoe gateway pair --delete-webhook\n`,
        ),
      );
      return EXIT_ERROR;
    }

    if (msg.includes("conflict") || err?.code === "CONFLICT") {
      writeOut("Agent is already running; it will handle the pairing\n");
      alreadyRunning = true;
    } else {
      writeErr(pc.yellow(`Perhatian: temporary gateway: ${err instanceof Error ? err.message : String(err)}\n`));
    }
  }

  if (!createCodeFn || !statusFn) {
    writeErr(pc.red("Error: Pairing API tidak tersedia.\n"));
    if (gw && !alreadyRunning) {
      await gw.stop().catch(() => {});
    }
    return EXIT_ERROR;
  }

  const { code } = createCodeFn("telegram", deps.statePath);
  writeOut(`Send ${pc.bold(`/start ${code}`)} to @${botUsername} within 10 minutes\n`);

  // 4. Polling loop dengan spinner (Ctrl+C membatalkan bersih)
  let aborted = false;
  const onSigInt = () => {
    aborted = true;
  };
  process.once("SIGINT", onSigInt);

  const sleep = deps.sleepImpl ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const isTTY = Boolean(process.stdout.isTTY && !process.env.CI);
  let pollCount = 0;

  try {
    while (!aborted) {
      if (isTTY) {
        const spin = SPINNER_FRAMES[pollCount % SPINNER_FRAMES.length];
        process.stdout.write(`\r  ${spin} Menunggu /start ${code}...`);
      }
      await sleep(3000);
      if (aborted) break;
      pollCount++;

      const pStatus = statusFn(code, deps.statePath);
      if (pStatus.status === "paired") {
        if (isTTY) process.stdout.write("\r\x1b[K");
        writeOut(pc.green(`✔ Berhasil terhubung dengan chat ${maskChatId(pStatus.chatId ?? "")}\n`));
        break;
      }
      if (pStatus.status === "expired") {
        if (isTTY) process.stdout.write("\r\x1b[K");
        writeOut(pc.yellow("Kode pairing telah kedaluwarsa.\n"));
        break;
      }
    }
  } finally {
    process.removeListener("SIGINT", onSigInt);
    if (aborted) {
      if (isTTY) process.stdout.write("\r\x1b[K");
      writeOut("\nPairing dibatalkan.\n");
    }
    if (gw && !alreadyRunning) {
      try {
        await gw.stop();
      } catch {
        /* abaikan */
      }
    }
  }

  return EXIT_OK;
}

export async function gatewayStatusCommand(
  argv: string[],
  deps: GatewayStatusDeps = {},
): Promise<number> {
  const writeOut = deps.stdout ?? ((s: string) => void process.stdout.write(s));
  const writeErr = deps.stderr ?? ((s: string) => void process.stderr.write(s));
  const env = deps.env ?? process.env;

  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        help: { type: "boolean" },
        "no-color": { type: "boolean" },
      },
      allowPositionals: false,
    });
  } catch (err) {
    writeErr(`argumen tidak valid: ${err instanceof Error ? err.message : String(err)}\n`);
    return EXIT_ERROR;
  }

  if (parsed.values.help) {
    writeOut(GATEWAY_STATUS_HELP + "\n");
    return EXIT_OK;
  }

  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    writeOut(
      pc.yellow("Telegram bot token belum dikonfigurasi (set TELEGRAM_BOT_TOKEN atau jalankan 'tahansoe setup').\n"),
    );
    return EXIT_OK;
  }

  writeOut(pc.bold("\n=== Gateway Status ===\n"));

  // 1. Bot username via getMe
  const getMe = deps.telegramGetMe ?? defaultTelegramGetMe;
  const meRes = await getMe(token);
  if (meRes.ok && meRes.username) {
    writeOut(`Bot: @${meRes.username}\n`);
  } else {
    writeOut(`Bot: (gagal verifikasi: ${meRes.error ?? "HTTP error"})\n`);
  }

  // 2. Mode (polling / webhook to host)
  const getWebhookInfo = deps.telegramGetWebhookInfo ?? defaultTelegramGetWebhookInfo;
  let isWebhookActive = false;
  let webhookHost = "";
  try {
    const whInfo = await getWebhookInfo(token);
    if (whInfo?.ok && whInfo.host) {
      isWebhookActive = true;
      webhookHost = whInfo.host;
    }
  } catch {
    /* abaikan */
  }

  if (isWebhookActive) {
    writeOut(`Mode: webhook to ${webhookHost}\n`);
  } else {
    writeOut("Mode: polling\n");
  }

  // 3. Allowed chats dari settings
  const sPath = deps.settingsPath ?? defaultSettingsPath(env);
  let allowedChats: Array<string | number> = [];
  try {
    const { settings } = loadSettingsSync(sPath);
    const raw = settings.gateway?.channels?.telegram?.allowedChats;
    if (Array.isArray(raw)) {
      allowedChats = raw.map((c: any) => (typeof c === "object" && c !== null && "id" in c ? c.id : String(c)));
    }
  } catch {
    try {
      const rawJson = JSON.parse(readFileSync(sPath, "utf-8"));
      const rawList = rawJson.gateway?.channels?.telegram?.allowedChats;
      if (Array.isArray(rawList)) {
        allowedChats = rawList.map((c: any) => (typeof c === "object" && c !== null && "id" in c ? c.id : String(c)));
      }
    } catch {
      /* abaikan */
    }
  }

  writeOut(`Allowed chats: ${allowedChats.length}`);
  if (allowedChats.length > 0) {
    const masked = allowedChats.map(maskChatId).join(", ");
    writeOut(` (${masked})\n`);
  } else {
    writeOut(" (belum ada chat yang terhubung. Jalankan 'tahansoe gateway pair')\n");
  }

  // 4. Status polling atau pesan webhook_active
  if (isWebhookActive) {
    writeOut(
      pc.yellow(
        `This bot uses a webhook to ${webhookHost}. Messages go there, not to Tahansoe. Use a dedicated bot, or run: tahansoe gateway pair --delete-webhook\n`,
      ),
    );
  } else {
    let isPolling = false;
    if (deps.gatewayListening) {
      isPolling = await deps.gatewayListening();
    } else {
      try {
        // @ts-ignore - concurrently built by Antigravity #1
        const { gatewayListening } = await import("../../gateway/index.ts");
        if (typeof gatewayListening === "function") {
          isPolling = (gatewayListening as any)();
        }
      } catch {
        /* abaikan */
      }
    }
    writeOut(`Agent polling: ${isPolling ? pc.green("active") : pc.dim("inactive")}\n`);
  }

  writeOut("\n");
  return EXIT_OK;
}

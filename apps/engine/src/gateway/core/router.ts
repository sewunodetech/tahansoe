/**
 * Router Perintah & Penangan Tanya-Jawab Gateway Kanal (spec §3.1, §3.5, §7).
 *
 * Menerjemahkan pesan masuk:
 *  - Cek allowlist chat (hanya chat terdaftar atau TELEGRAM_ALLOWED_CHAT_IDS)
 *  - Slash commands (/start, /help, /status, /fuse, /carry, /report, /history, /subscribe, /unsubscribe, /alerts)
 *    -> dieksekusi dengan menangkap teks output
 *  - Teks biasa -> jalur tanya jawab (Q&A) yang grounded via executeChatQuestion
 *  - Batasan Q&A per chat harian (GATEWAY_QA_PER_DAY, default 20)
 *  - Riwayat percakapan per chat tersimpan di memori (maks 10 giliran)
 *  - Format pesan aman untuk Telegram
 */

import type { InboundMessage, ChannelAdapter } from "./adapter.ts";
import type { GatewayRuntimeState } from "./state.ts";
import {
  getDailyQaCount,
  incrementDailyQaCount,
  saveGatewayState,
} from "./state.ts";
import {
  loadSettings,
  isChatAllowed,
  isChatSubscribed,
  getChatAlertPreferences,
  updateChatSubscription,
  updateChatAlertPreference,
  muteChatAlert,
  addAllowedChat,
  type Settings,
  type AlertType,
} from "../../settings/settings.ts";
import { quickActionKeyboard } from "../telegram/adapter.ts";
import type { PairingManager } from "../pairing.ts";
import {
  buildReplContext,
  formatStatusLine,
  type ReplContextLoaders,
  type ReplContext,
} from "../../cli/repl/context.ts";
import {
  executeChatQuestion,
  capHistory,
  type ChatTurn,
  type ChatOptions,
  CHAT_FOOTER,
} from "../../cli/repl/chat.ts";
import { formatSafePlainText } from "./formatter.ts";

export interface CommandRouterOptions {
  adapter: ChannelAdapter;
  pairing: PairingManager;
  state: GatewayRuntimeState;
  statePath?: string;
  settingsPath?: string;
  env?: NodeJS.ProcessEnv;
  chatOptions?: ChatOptions;
  loaders?: ReplContextLoaders;
  logger?: (msg: string) => void;
}

export const PRIVATE_BOT_REPLY = "This bot is private.";
export const DEFAULT_QA_PER_DAY = 20;

// Riwayat per-chat di memori: chatId -> ChatTurn[] (maks 10)
const chatHistories = new Map<string, ChatTurn[]>();

// Mutex sederhana agar penangkapan process.stdout antar perintah tidak tumpang tindih
let commandExecutionLock = Promise.resolve();

async function runWithLock<T>(fn: () => Promise<T>): Promise<T> {
  const currentLock = commandExecutionLock;
  let release: () => void;
  commandExecutionLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  await currentLock;
  try {
    return await fn();
  } finally {
    release!();
  }
}

/**
 * Tangkap output command CLI menjadi string teks tanpa escape warna ANSI.
 */
export async function captureCommandOutput(fn: (deps: { stdout: (s: string) => void; stderr: (s: string) => void }) => Promise<number | void>): Promise<string> {
  return await runWithLock(async () => {
    let captured = "";
    const origStdout = process.stdout.write;
    const origStderr = process.stderr.write;

    const append = (s: string) => {
      captured += s;
    };

    process.stdout.write = ((chunk: unknown) => {
      captured += String(chunk);
      return true;
    }) as typeof process.stdout.write;

    process.stderr.write = ((chunk: unknown) => {
      captured += String(chunk);
      return true;
    }) as typeof process.stderr.write;

    try {
      await fn({ stdout: append, stderr: append });
    } catch (err) {
      captured += `\nError: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      process.stdout.write = origStdout;
      process.stderr.write = origStderr;
    }

    return formatSafePlainText(captured);
  });
}

export class CommandRouter {
  private readonly adapter: ChannelAdapter;
  private readonly pairing: PairingManager;
  private readonly state: GatewayRuntimeState;
  private readonly statePath?: string;
  private readonly settingsPath?: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly chatOptions: ChatOptions;
  private readonly loaders?: ReplContextLoaders;
  private readonly logger: (msg: string) => void;

  constructor(options: CommandRouterOptions) {
    this.adapter = options.adapter;
    this.pairing = options.pairing;
    this.state = options.state;
    this.statePath = options.statePath;
    this.settingsPath = options.settingsPath;
    this.env = options.env ?? process.env;
    this.chatOptions = options.chatOptions ?? {};
    this.loaders = options.loaders;
    this.logger = options.logger ?? (() => {});
  }

  public async handleMessage(msg: InboundMessage): Promise<void> {
    const chatId = String(msg.chatId).trim();
    const rawText = msg.text.trim();
    if (!rawText) return;

    // Muat settings saat ini
    const { settings } = await loadSettings(this.settingsPath);

    // 1. Tangani pairing (/start <code>) terlebih dahulu agar chat baru bisa masuk allowlist
    if (rawText.toLowerCase().startsWith("/start")) {
      const parts = rawText.split(/\s+/);
      const codeArg = parts[1]?.trim();

      if (codeArg) {
        // Upaya pairing
        const result = await this.pairing.handlePairingAttempt(
          codeArg,
          chatId,
          this.state,
          async (id) => {
            await addAllowedChat(
              id,
              msg.from?.username ? `@${msg.from.username}` : undefined,
              { subscribed: true },
              this.settingsPath,
            );
          },
        );

        if (this.statePath) {
          await saveGatewayState(this.state, this.statePath).catch(() => {});
        }

        if (result.ok) {
          await this.adapter.send(
            chatId,
            "Pairing successful! This chat is now connected to Tahansoe risk engine alerts.",
          );
        } else {
          await this.adapter.send(chatId, result.error ?? "Pairing failed.");
        }
        return;
      }
    }

    // 2. Jika pesan adalah callback query dari tombol inline
    if (msg.callbackQueryId) {
      await this.handleCallbackQuery(msg, settings);
      return;
    }

    // 3. Cek allowlist
    const allowed = isChatAllowed(chatId, settings, this.env.TELEGRAM_ALLOWED_CHAT_IDS);
    if (!allowed) {
      await this.adapter.send(chatId, PRIVATE_BOT_REPLY);
      return;
    }

    // 4. Jika pesan adalah slash command
    if (rawText.startsWith("/")) {
      await this.handleSlashCommand(chatId, rawText, settings);
      return;
    }

    // 5. Jika pesan adalah teks biasa (Q&A grounded)
    await this.handlePlainQuestion(chatId, rawText, settings);
  }

  private async handleCallbackQuery(msg: InboundMessage, settings: Settings): Promise<void> {
    const chatId = String(msg.chatId).trim();
    const queryId = msg.callbackQueryId!;
    const allowed = isChatAllowed(chatId, settings, this.env.TELEGRAM_ALLOWED_CHAT_IDS);

    if (!allowed) {
      await this.adapter.answerCallback?.(queryId, "This bot is private.");
      await this.adapter.send(chatId, PRIVATE_BOT_REPLY);
      return;
    }

    const data = (msg.callbackData || msg.text || "").trim();

    if (data.startsWith("cmd:")) {
      const cmd = data.slice(4).trim().toLowerCase();
      const validCmds = ["status", "fuse", "carry", "alerts", "help"];
      if (validCmds.includes(cmd)) {
        await this.adapter.answerCallback?.(queryId);
        await this.handleSlashCommand(chatId, `/${cmd}`, settings);
        return;
      }
    } else if (data.startsWith("detail:")) {
      const alertType = data.slice(7).trim();
      await this.adapter.answerCallback?.(queryId, "Memuat detail...");
      const ctx = await buildReplContext({ loaders: this.loaders });
      const line = formatStatusLine(ctx, { color: false, width: 80 });
      const detailMsg =
        `Detail Alert [${alertType.toUpperCase()}]:\n` +
        `${line.trim()}\n\n` +
        (ctx.latestReport
          ? `Laporan terbaru: proposed regime ${ctx.latestReport.report.proposedRegime}, arah ${ctx.latestReport.report.direction}, confidence ${ctx.latestReport.report.confidence.toFixed(2)}.\n\n`
          : "") +
        CHAT_FOOTER;
      await this.adapter.send(chatId, detailMsg);
      return;
    } else if (data.startsWith("mute:")) {
      const alertType = data.slice(5).trim() as AlertType;
      const validTypes: AlertType[] = ["regime", "sequencer", "depeg", "pool", "oracle", "daily"];
      if (validTypes.includes(alertType)) {
        await muteChatAlert(chatId, alertType, 6, this.settingsPath);
        await this.adapter.answerCallback?.(queryId, `Alert '${alertType}' dibisukan 6 jam.`);
        await this.adapter.send(chatId, `Notifikasi alert '${alertType}' dibisukan untuk chat ini selama 6 jam.`);
        return;
      }
    }

    // Default response bila callback_data tidak cocok
    await this.adapter.answerCallback?.(queryId);
  }

  private async handleSlashCommand(chatId: string, text: string, settings: Settings): Promise<void> {
    const parts = text.split(/\s+/);
    const cmd = parts[0]!.slice(1).toLowerCase();
    const args = parts.slice(1);

    switch (cmd) {
      case "start": {
        const welcome =
          "Welcome to Tahansoe Risk Agent!\n\n" +
          "Tahansoe is a non-custodial AI risk engine protecting on-chain borrow positions on Aave V3.\n\n" +
          "Commands available:\n" +
          "/status - Current market regime & active signals\n" +
          "/fuse - Run Risk Fusion pass\n" +
          "/carry - Check Aave V3 carry rates\n" +
          "/report - Show latest research report\n" +
          "/history - View recent report cards\n" +
          "/subscribe - Enable risk alerts\n" +
          "/unsubscribe - Disable risk alerts\n" +
          "/alerts - Manage alert preferences\n" +
          "/help - Show command manual\n\n" +
          "You can also ask any questions about on-chain risk directly.";
        await this.adapter.send(chatId, welcome, { replyMarkup: quickActionKeyboard() });
        break;
      }

      case "help": {
        const helpText =
          "Tahansoe Risk Agent Commands:\n\n" +
          "/status — Market regimes per asset & active risk signals\n" +
          "/fuse — Run one deterministic Risk Fusion pass\n" +
          "/carry — Aave V3 interest rate & carry risk monitor\n" +
          "/report [latest|id] — View full research report\n" +
          "/history — Table of recent research reports\n" +
          "/subscribe — Subscribe to proactive risk notifications\n" +
          "/unsubscribe — Mute proactive notifications\n" +
          "/alerts — View or configure alert types (regime, sequencer, depeg, pool, oracle, daily)\n" +
          "  Example: /alerts sequencer off\n\n" +
          "Plain text: ask any question about lending risk, borrow rates, or recent developments.\n\n" +
          CHAT_FOOTER;
        await this.adapter.send(chatId, helpText, { replyMarkup: quickActionKeyboard() });
        break;
      }

      case "status": {
        const ctx = await buildReplContext({ loaders: this.loaders });
        const line = formatStatusLine(ctx, { color: false, width: 80 });
        const out = `Tahansoe Status:\n${line.trim()}\n\n${CHAT_FOOTER}`;
        await this.adapter.send(chatId, out);
        break;
      }

      case "fuse": {
        const { fuseCommand } = await import("../../cli/commands/fuse.ts");
        const out = await captureCommandOutput(async (deps) => {
          await fuseCommand(["--dry", "--no-color"], deps);
        });
        await this.adapter.send(chatId, out || "Fusion pass completed.");
        break;
      }

      case "carry": {
        const { carryCommand } = await import("../../cli/commands/carry.ts");
        const out = await captureCommandOutput(async (deps) => {
          await carryCommand(["--no-color"], deps);
        });
        await this.adapter.send(chatId, out || "No carry data available.");
        break;
      }

      case "report": {
        const target = args[0] || "latest";
        const { reportCommand } = await import("../../cli/commands/report.ts");
        const out = await captureCommandOutput(async () => {
          await reportCommand([target, "--no-color"]);
        });
        await this.adapter.send(chatId, out || `Report ${target} not found.`);
        break;
      }

      case "history": {
        const { historyCommand } = await import("../../cli/commands/history.ts");
        const out = await captureCommandOutput(async (deps) => {
          await historyCommand(["--no-color"], deps);
        });
        await this.adapter.send(chatId, out || "No history available.");
        break;
      }

      case "subscribe": {
        await updateChatSubscription(chatId, true, this.settingsPath);
        await this.adapter.send(chatId, "Subscribed to risk alerts.");
        break;
      }

      case "unsubscribe": {
        await updateChatSubscription(chatId, false, this.settingsPath);
        await this.adapter.send(chatId, "Unsubscribed from risk alerts.");
        break;
      }

      case "alerts": {
        const alertType = args[0]?.toLowerCase() as AlertType | undefined;
        const toggle = args[1]?.toLowerCase();

        const validTypes: AlertType[] = ["regime", "sequencer", "depeg", "pool", "oracle", "daily"];

        if (!alertType) {
          const prefs = getChatAlertPreferences(chatId, settings);
          const lines = validTypes.map((t) => `  • ${t}: ${prefs[t] ? "ON" : "OFF"}`);
          const msg =
            `Alert preferences for this chat:\n${lines.join("\n")}\n\n` +
            `Change a setting with: /alerts <type> <on|off>\n` +
            `Example: /alerts daily on`;
          await this.adapter.send(chatId, msg);
          return;
        }

        if (!validTypes.includes(alertType)) {
          await this.adapter.send(
            chatId,
            `Unknown alert type '${alertType}'. Available: ${validTypes.join(", ")}`,
          );
          return;
        }

        if (toggle !== "on" && toggle !== "off") {
          await this.adapter.send(chatId, `Usage: /alerts ${alertType} on|off`);
          return;
        }

        const enabled = toggle === "on";
        await updateChatAlertPreference(chatId, alertType, enabled, this.settingsPath);
        await this.adapter.send(chatId, `Alert '${alertType}' set to ${toggle.toUpperCase()}.`);
        break;
      }

      default: {
        await this.adapter.send(
          chatId,
          `Unknown command '/${cmd}'. Type /help for available commands.`,
        );
        break;
      }
    }
  }

  private async handlePlainQuestion(
    chatId: string,
    question: string,
    settings: Settings,
  ): Promise<void> {
    // 1. Cek batas Q&A harian
    const qaLimit = Number(
      this.env.GATEWAY_QA_PER_DAY || settings.gateway?.qaPerDay || DEFAULT_QA_PER_DAY,
    );
    const currentQa = getDailyQaCount(this.state, chatId);

    if (currentQa >= qaLimit) {
      await this.adapter.send(
        chatId,
        `Daily Q&A limit reached (${qaLimit}/${qaLimit}). Slash commands remain available.`,
      );
      return;
    }

    // 2. Bangun konteks repl
    const ctx: ReplContext = await buildReplContext({ loaders: this.loaders });

    // 3. Ambil riwayat percakapan chat (maks 10 giliran)
    const history = chatHistories.get(chatId) ?? [];

    try {
      const res = await executeChatQuestion(question, ctx, history, this.chatOptions);

      // Tambah riwayat di memori
      history.push({ role: "user", content: question });
      history.push({ role: "assistant", content: res.answer });
      chatHistories.set(chatId, capHistory(history));

      // Tambah hitungan Q&A dan simpan state
      incrementDailyQaCount(this.state, chatId);
      if (this.statePath) {
        await saveGatewayState(this.state, this.statePath).catch(() => {});
      }

      const reply = `${res.answer}\n\n${res.costLine}\n${res.footer}`;
      await this.adapter.send(chatId, reply);
    } catch (err) {
      this.logger(`[Router] Error executing chat question: ${err instanceof Error ? err.message : String(err)}`);
      await this.adapter.send(
        chatId,
        `Sorry, failed to process question: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

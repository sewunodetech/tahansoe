/**
 * Router Perintah & Penangan Tanya-Jawab Gateway Kanal (spec §3.1, §3.5, §7).
 *
 * Menerjemahkan pesan masuk:
 *  - Cek allowlist chat (hanya chat terdaftar atau TELEGRAM_ALLOWED_CHAT_IDS)
 *  - Slash commands (/start, /help, /status, /fuse, /carry, /report, /history, /subscribe, /unsubscribe, /alerts)
 *    -> data diambil langsung lalu dirender oleh gateway/views.ts (HTML ramah HP + penjelasan)
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
  settingsPath,
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
  type ReplContextLoaders,
  type ReplContext,
} from "../../chat/context.ts";
import {
  executeChatQuestion,
  capHistory,
  type ChatTurn,
  type ChatOptions,
} from "../../chat/chat.ts";
import {
  chatLang,
  escapeHtml,
  welcomeView,
  helpView,
  statusView,
  fuseView,
  carryView,
  carryFromContextView,
  reportView,
  historyView,
  chatAnswerView,
  type Lang,
} from "../views.ts";

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

/** Pilih teks sesuai bahasa chat. */
const T = (lang: Lang, id: string, en: string): string => (lang === "id" ? id : en);

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
  private readonly privateNoticeSentTimes: Map<string, number> = new Map();

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

  /** Kirim pesan HTML (semua teks dinamis sudah di-escape oleh views/escapeHtml). */
  private async reply(chatId: string, html: string, replyMarkup?: unknown): Promise<void> {
    await this.adapter.send(chatId, html, { parseMode: "HTML", replyMarkup });
  }

  public async handleMessage(msg: InboundMessage): Promise<void> {
    const chatId = String(msg.chatId).trim();
    const rawText = msg.text.trim();
    if (!rawText) return;

    // Muat settings saat ini
    const { settings } = await loadSettings(this.settingsPath);
    const lang = chatLang(settings);

    // 1. Tangani pairing (/start <code>) terlebih dahulu agar chat baru bisa masuk allowlist
    if (rawText.toLowerCase().startsWith("/start")) {
      const parts = rawText.split(/\s+/);
      const codeArg = parts[1]?.trim();

      if (codeArg) {
        // Upaya pairing
        const targetSettingsPath = this.settingsPath ?? settingsPath(this.env);
        const result = await this.pairing.handlePairingAttempt(
          codeArg,
          chatId,
          this.state,
          async (id) => {
            await addAllowedChat(
              id,
              msg.from?.username ? `@${msg.from.username}` : undefined,
              { subscribed: true },
              targetSettingsPath,
            );
            this.logger(`[Gateway] Pairing successful for chat ${id}. Updated settings written to: ${targetSettingsPath}`);
          },
        );

        if (this.statePath) {
          await saveGatewayState(this.state, this.statePath).catch(() => {});
        }

        if (result.ok) {
          await this.reply(
            chatId,
            T(
              lang,
              "✅ <b>Pairing berhasil!</b> Chat ini sekarang terhubung ke Tahansoe dan akan menerima peringatan risiko.\n\nKetik /help untuk panduan.",
              "✅ <b>Pairing successful!</b> This chat is now connected to Tahansoe risk engine alerts.\n\nType /help for the guide.",
            ),
          );
        } else {
          const tooMany = /too many/i.test(result.error ?? "");
          await this.reply(
            chatId,
            tooMany
              ? T(lang, "⛔ Terlalu banyak percobaan gagal. Coba lagi nanti.", "⛔ Too many failed pairing attempts. Please try again later.")
              : T(
                  lang,
                  "❌ Kode pairing tidak valid atau sudah kedaluwarsa (berlaku 10 menit). Jalankan <code>tahansoe gateway pair</code> lagi untuk kode baru.",
                  "❌ Pairing code is invalid or has expired (valid for 10 minutes). Run <code>tahansoe gateway pair</code> again for a new code.",
                ),
          );
        }
        return;
      }
    }

    // 2. Jika pesan adalah callback query dari tombol inline
    if (msg.callbackQueryId) {
      await this.handleCallbackQuery(msg, settings, lang);
      return;
    }

    // 3. Cek allowlist (notifikasi "This bot is private." dibatasi maksimal 1 kali per jam per chat)
    const allowed = isChatAllowed(chatId, settings, this.env.TELEGRAM_ALLOWED_CHAT_IDS);
    if (!allowed) {
      const now = Date.now();
      const lastSent = this.privateNoticeSentTimes.get(chatId) ?? 0;
      if (now - lastSent >= 3600_000) {
        this.privateNoticeSentTimes.set(chatId, now);
        await this.adapter.send(chatId, PRIVATE_BOT_REPLY);
      } else {
        this.logger(`[Router] Ignored unauthorized message from chat ${chatId} ("${PRIVATE_BOT_REPLY}" throttled to 1/hour)`);
      }
      return;
    }

    // 4. Jika pesan adalah slash command
    if (rawText.startsWith("/")) {
      await this.handleSlashCommand(chatId, rawText, settings, lang);
      return;
    }

    // 5. Jika pesan adalah teks biasa (Q&A grounded)
    await this.handlePlainQuestion(chatId, rawText, settings, lang);
  }

  private async handleCallbackQuery(msg: InboundMessage, settings: Settings, lang: Lang): Promise<void> {
    const chatId = String(msg.chatId).trim();
    const queryId = msg.callbackQueryId!;
    const allowed = isChatAllowed(chatId, settings, this.env.TELEGRAM_ALLOWED_CHAT_IDS);

    if (!allowed) {
      await this.adapter.answerCallback?.(queryId, "This bot is private.");
      const now = Date.now();
      const lastSent = this.privateNoticeSentTimes.get(chatId) ?? 0;
      if (now - lastSent >= 3600_000) {
        this.privateNoticeSentTimes.set(chatId, now);
        await this.adapter.send(chatId, PRIVATE_BOT_REPLY);
      }
      return;
    }

    const data = (msg.callbackData || msg.text || "").trim();

    if (data.startsWith("cmd:")) {
      const cmd = data.slice(4).trim().toLowerCase();
      const validCmds = ["status", "fuse", "carry", "alerts", "help"];
      if (validCmds.includes(cmd)) {
        await this.adapter.answerCallback?.(queryId);
        await this.handleSlashCommand(chatId, `/${cmd}`, settings, lang);
        return;
      }
    } else if (data.startsWith("detail:")) {
      await this.adapter.answerCallback?.(queryId, T(lang, "Memuat detail...", "Loading details..."));
      const ctx = await buildReplContext({ loaders: this.loaders });
      await this.reply(chatId, statusView(ctx, lang));
      return;
    } else if (data.startsWith("mute:")) {
      const alertType = data.slice(5).trim() as AlertType;
      const validTypes: AlertType[] = ["regime", "sequencer", "depeg", "pool", "oracle", "daily"];
      if (validTypes.includes(alertType)) {
        await muteChatAlert(chatId, alertType, 6, this.settingsPath);
        await this.adapter.answerCallback?.(queryId, `Alert '${alertType}' dibisukan 6 jam.`);
        await this.reply(
          chatId,
          T(
            lang,
            `🔕 Notifikasi alert '${escapeHtml(alertType)}' dibisukan untuk chat ini selama 6 jam.`,
            `🔕 Alert '${escapeHtml(alertType)}' notifications muted for this chat for 6 hours (dibisukan untuk chat ini selama 6 jam).`,
          ),
        );
        return;
      }
    }

    // Default response bila callback_data tidak cocok
    await this.adapter.answerCallback?.(queryId);
  }

  private async handleSlashCommand(chatId: string, text: string, settings: Settings, lang: Lang): Promise<void> {
    const parts = text.split(/\s+/);
    const cmd = parts[0]!.slice(1).toLowerCase().replace(/@.*$/, ""); // /status@botname
    const args = parts.slice(1);

    switch (cmd) {
      case "start":
        await this.reply(chatId, welcomeView(lang), quickActionKeyboard());
        break;

      case "help":
        await this.reply(chatId, helpView(lang), quickActionKeyboard());
        break;

      case "status": {
        const ctx = await buildReplContext({ loaders: this.loaders });
        await this.reply(chatId, statusView(ctx, lang));
        break;
      }

      case "fuse": {
        if (!this.env.DATABASE_URL) {
          await this.reply(chatId, T(lang, "Database belum dikonfigurasi di agent (DATABASE_URL).", "The agent has no database configured (DATABASE_URL)."));
          break;
        }
        try {
          const { runFusion } = await import("../../fusion/run.ts");
          const result = await runFusion({ dry: true });
          await this.reply(chatId, fuseView(result, lang));
        } catch (err) {
          this.logger(`[Router] /fuse gagal: ${err instanceof Error ? err.message : String(err)}`);
          await this.reply(chatId, T(lang, "⚠️ Penilaian risiko gagal dihitung saat ini. Coba lagi sebentar lagi.", "⚠️ Could not compute the risk assessment right now. Please try again shortly."));
        }
        break;
      }

      case "carry": {
        try {
          const { fetchAaveRates } = await import("../../sources/aave-rates.ts");
          const { computeCarryData } = await import("../../cli/commands/carry.ts");
          const rates = await fetchAaveRates();
          await this.reply(chatId, carryView(computeCarryData(rates), lang));
        } catch (err) {
          this.logger(`[Router] /carry RPC gagal: ${err instanceof Error ? err.message : String(err)}`);
          const ctx = await buildReplContext({ loaders: this.loaders });
          if (ctx.carryPairs.length > 0) {
            await this.reply(chatId, carryFromContextView(ctx.carryPairs, lang));
          } else {
            await this.reply(chatId, T(lang, "⚠️ Data bunga Aave belum tersedia. Coba lagi sebentar lagi.", "⚠️ Aave rate data is not available yet. Please try again shortly."));
          }
        }
        break;
      }

      case "report": {
        const target = args[0] || "latest";
        if (!this.env.DATABASE_URL) {
          await this.reply(chatId, T(lang, "Database belum dikonfigurasi di agent.", "The agent has no database configured."));
          break;
        }
        const { fetchReport } = await import("../../cli/commands/report.ts");
        const found = await fetchReport(target).catch(() => null);
        await this.reply(
          chatId,
          found
            ? reportView(found, lang)
            : T(lang, `Belum ada laporan riset${target === "latest" ? "" : ` dengan id ${escapeHtml(target)}`}.`, `No research report${target === "latest" ? "" : ` with id ${escapeHtml(target)}`} yet.`),
        );
        break;
      }

      case "history": {
        if (!this.env.DATABASE_URL) {
          await this.reply(chatId, T(lang, "Database belum dikonfigurasi di agent.", "The agent has no database configured."));
          break;
        }
        const { recentReports } = await import("../../db/history.ts");
        const rows = await recentReports(8).catch(() => []);
        await this.reply(chatId, historyView(rows, lang));
        break;
      }

      case "subscribe": {
        await updateChatSubscription(chatId, true, this.settingsPath);
        await this.reply(
          chatId,
          T(lang, "🔔 Notifikasi risiko aktif. Atur jenisnya dengan /alerts.", "🔔 Subscribed to risk alerts. Choose types with /alerts."),
        );
        break;
      }

      case "unsubscribe": {
        await updateChatSubscription(chatId, false, this.settingsPath);
        await this.reply(
          chatId,
          T(lang, "🔕 Notifikasi risiko dimatikan. Aktifkan lagi dengan /subscribe.", "🔕 Unsubscribed from risk alerts. Re-enable with /subscribe."),
        );
        break;
      }

      case "alerts": {
        const alertType = args[0]?.toLowerCase() as AlertType | undefined;
        const toggle = args[1]?.toLowerCase();

        const validTypes: AlertType[] = ["regime", "sequencer", "depeg", "pool", "oracle", "daily"];
        const describe: Record<AlertType, [string, string]> = {
          regime: ["tingkat risiko aset naik/turun", "asset risk level changes"],
          sequencer: ["jaringan Arbitrum berhenti", "Arbitrum sequencer down"],
          depeg: ["stablecoin lepas dari $1", "stablecoin depeg"],
          pool: ["pool hampir habis dipinjam", "pool almost fully borrowed"],
          oracle: ["harga oracle tertinggal/menyimpang", "oracle lag/deviation"],
          daily: ["ringkasan harian", "daily summary"],
        };

        if (!alertType) {
          const prefs = getChatAlertPreferences(chatId, settings);
          const lines = validTypes.map(
            (t) => `${prefs[t] ? "✅" : "⬜"} <b>${t}</b> — ${lang === "id" ? describe[t][0] : describe[t][1]}`,
          );
          const msg =
            `<b>${T(lang, "Pengaturan notifikasi chat ini", "Alert preferences for this chat")}</b>\n${lines.join("\n")}\n\n` +
            T(lang, "Ubah dengan: <code>/alerts &lt;jenis&gt; on|off</code>\nContoh: <code>/alerts daily on</code>", "Change with: <code>/alerts &lt;type&gt; on|off</code>\nExample: <code>/alerts daily on</code>");
          await this.reply(chatId, msg);
          return;
        }

        if (!validTypes.includes(alertType)) {
          await this.reply(
            chatId,
            T(lang, `Jenis alert '${escapeHtml(alertType)}' tidak dikenal. Pilihan: ${validTypes.join(", ")}`, `Unknown alert type '${escapeHtml(alertType)}'. Available: ${validTypes.join(", ")}`),
          );
          return;
        }

        if (toggle !== "on" && toggle !== "off") {
          await this.reply(chatId, `${T(lang, "Cara pakai", "Usage")}: <code>/alerts ${escapeHtml(alertType)} on|off</code>`);
          return;
        }

        const enabled = toggle === "on";
        await updateChatAlertPreference(chatId, alertType, enabled, this.settingsPath);
        await this.reply(
          chatId,
          T(lang, `Alert '${alertType}' sekarang ${toggle.toUpperCase()}.`, `Alert '${alertType}' set to ${toggle.toUpperCase()}.`),
        );
        break;
      }

      default: {
        await this.reply(
          chatId,
          T(lang, `Perintah '/${escapeHtml(cmd)}' tidak dikenal. Ketik /help untuk daftar perintah.`, `Unknown command '/${escapeHtml(cmd)}'. Type /help for available commands.`),
        );
        break;
      }
    }
  }

  private async handlePlainQuestion(
    chatId: string,
    question: string,
    settings: Settings,
    lang: Lang,
  ): Promise<void> {
    // 1. Cek batas Q&A harian
    const qaLimit = Number(
      this.env.GATEWAY_QA_PER_DAY || settings.gateway?.qaPerDay || DEFAULT_QA_PER_DAY,
    );
    const currentQa = getDailyQaCount(this.state, chatId);

    if (currentQa >= qaLimit) {
      await this.reply(
        chatId,
        T(
          lang,
          `Batas tanya-jawab harian tercapai (${qaLimit}/${qaLimit}) — Daily Q&A limit reached (${qaLimit}/${qaLimit}). Perintah seperti /status tetap bisa dipakai.`,
          `Daily Q&A limit reached (${qaLimit}/${qaLimit}). Slash commands like /status remain available.`,
        ),
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

      await this.reply(chatId, chatAnswerView(res.answer, res.costLine, lang));
    } catch (err) {
      this.logger(`[Router] Error executing chat question: ${err instanceof Error ? err.message : String(err)}`);
      await this.reply(
        chatId,
        T(lang, "⚠️ Maaf, pertanyaan belum bisa dijawab sekarang. Coba lagi sebentar lagi.", "⚠️ Sorry, I couldn't answer that right now. Please try again shortly."),
      );
    }
  }
}

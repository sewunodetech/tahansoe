/**
 * Mode Interaktif REPL CLI Tahansoe (spec m3-cli §3.5 & §3.6).
 *
 * Menggunakan node:readline, picocolors, dan kit UI Tahansoe:
 *  - Banner TAHANSOE gradien kiri-ke-kanan (#4ab5e0 -> #34d399)
 *  - Status panel (mode, network, protocol, active account, buffer, HF)
 *  - 3 saran perintah (/analyze, /carry, /help)
 *  - Bantuan /help terkelompok dalam 5 bagian
 *  - Pemilihan bahasa /lang (id/en) dengan persistensi ke settings.json
 *  - Prompt "› "
 *  - Autocomplete Tab untuk slash commands
 *  - Riwayat input di memori
 *  - Panggilan Q&A yang grounded untuk input non-slash
 */

import * as readline from "node:readline";
import pc from "picocolors";
import type { LlmProvider } from "../../llm/provider.ts";
import { maskHost, fmtTime, type Theme } from "../render.ts";
import {
  type CliTheme,
  detectCliTheme,
  ensureCliTheme,
  renderBanner,
  panel,
} from "../ui/index.ts";
import {
  t,
  getLanguage,
  setLanguage,
  initLanguage,
  type SupportedLanguage,
} from "../i18n/index.ts";
import { gatewayConfig, resolveRole } from "../../llm/registry.ts";
import { bootstrapBudgetPricing } from "../../llm/pricing-bootstrap.ts";
import { gatewayStatus } from "../../gateway/index.ts";
import { loadSettingsSync, type Settings } from "../../settings/settings.ts";
import {
  buildReplContext,
  formatStatusLine,
  type ReplContext,
  type ReplContextLoaders,
} from "./context.ts";
import { executeChatQuestion, capHistory, type ChatTurn } from "./chat.ts";

export const SLASH_COMMANDS: Array<[string, string]> = [
  ["/analyze", "Run one risk-research pass + report card (e.g. /analyze --dry)"],
  ["/fuse", "Run one Risk Fusion v1 pass (deterministic)"],
  ["/carry", "Aave V3 carry & interest-rate risk monitor"],
  ["/history", "Recent research reports table + sparkline"],
  ["/report", "Show full report by id or latest (e.g. /report latest)"],
  ["/settle", "Settle due research reports (ADR 0005)"],
  ["/scorecard", "Research-agent accuracy scorecard"],
  ["/simulate", "Simulate liquidation risk and protection scenarios"],
  ["/models", "List gateway models + prices"],
  ["/settings", "Show or manage settings.json"],
  ["/lang", "Switch UI language (/lang id or /lang en)"],
  ["/doctor", "Check environment & connectivity"],
  ["/setup", "Run initial setup wizard (gateway, models, DB)"],
  ["/gateway", "Channel gateway operations (/gateway pair, /gateway status)"],
  ["/pair", "Connect gateway pairing (alias /gateway pair)"],
  ["/status", "Show current market regime status line"],
  ["/start", "Hint: run 'tahansoe start' in a separate terminal"],
  ["/help", "Show available slash commands and tips"],
  ["/clear", "Clear terminal screen"],
  ["/exit", "Exit the interactive session"],
];

export const SCHEDULE_HINT =
  "schedule run tidak tersedia di REPL (proses background jangka panjang; jalankan terpisah di terminal lain: tahansoe schedule run)";

export const START_HINT =
  "start tidak tersedia di REPL (proses agent mandiri jangka panjang; jalankan terpisah di terminal lain: tahansoe start)";

export const REPL_HINT = "Type /help for commands, or ask a question about the latest analysis.\n";

export interface HelpSection {
  title: string;
  commands: Array<[string, string]>;
}

/** Dapatkan 5 grup perintah /help dengan teks terjemahan */
export function getHelpSections(lang?: SupportedLanguage): HelpSection[] {
  return [
    {
      title: t("help.sectionAnalysis", undefined, lang),
      commands: [
        ["/analyze", t("help.descAnalyze", undefined, lang)],
        ["/fuse", t("help.descFuse", undefined, lang)],
        ["/history", t("help.descHistory", undefined, lang)],
        ["/report", t("help.descReport", undefined, lang)],
        ["/settle", t("help.descSettle", undefined, lang)],
        ["/scorecard", t("help.descScorecard", undefined, lang)],
      ],
    },
    {
      title: t("help.sectionRisk", undefined, lang),
      commands: [
        ["/carry", t("help.descCarry", undefined, lang)],
        ["/simulate", t("help.descSimulate", undefined, lang)],
      ],
    },
    {
      title: t("help.sectionGateway", undefined, lang),
      commands: [
        ["/gateway", t("help.descGateway", undefined, lang)],
        ["/pair", t("help.descPair", undefined, lang)],
        ["/status", t("help.descStatus", undefined, lang)],
      ],
    },
    {
      title: t("help.sectionConfig", undefined, lang),
      commands: [
        ["/settings", t("help.descSettings", undefined, lang)],
        ["/lang", t("help.descLang", undefined, lang)],
        ["/setup", t("help.descSetup", undefined, lang)],
      ],
    },
    {
      title: t("help.sectionSystem", undefined, lang),
      commands: [
        ["/doctor", t("help.descDoctor", undefined, lang)],
        ["/models", t("help.descModels", undefined, lang)],
        ["/clear", t("help.descClear", undefined, lang)],
        ["/exit", t("help.descExit", undefined, lang)],
        ["/help", t("help.descHelp", undefined, lang)],
        ["/start", t("help.descStart", undefined, lang)],
      ],
    },
  ];
}

export interface RenderWelcomeOptions {
  gatewayUrl?: string;
  modelLabel?: string;
  lang?: SupportedLanguage;
  settings?: Settings;
  dbDriver?: string;
}

/** Render welcome screen terformat rapi untuk REPL */
export function renderWelcomeScreen(
  theme: CliTheme,
  context: ReplContext,
  options: RenderWelcomeOptions = {},
): string {
  const lang = options.lang ?? getLanguage();
  const chunks: string[] = [];

  // 1. Banner
  chunks.push(renderBanner(theme, { force: true, lang }));
  chunks.push("");

  // Muat settings bila belum diberikan di opsi
  const settings =
    options.settings ??
    (() => {
      try {
        return loadSettingsSync().settings;
      } catch {
        return undefined;
      }
    })();

  // 2. Status Panel (Pasar/Market, Sinyal/Signals, Kesegaran Data/Freshness, Gateway, Model, Database)
  // Pasar / Market
  let marketVal: string;
  if (context.assessments.length > 0) {
    const assetRegimes = context.assessments
      .map((a) => `${a.asset} ${theme.regime(a.regime, a.regime)}`)
      .join(", ");
    let timePart = "";
    if (context.latestReport) {
      timePart = ` · ${fmtTime(context.latestReport.createdAt)} UTC`;
    } else if (context.assessments[0]) {
      timePart = ` · ${fmtTime(context.assessments[0].createdAt)} UTC`;
    }
    marketVal = `${assetRegimes}${timePart}`;
  } else if (context.latestReport) {
    const regimeStr = theme.regime(
      context.latestReport.report.proposedRegime,
      context.latestReport.report.proposedRegime,
    );
    const assetsStr =
      context.latestReport.report.assets.length > 0
        ? ` (${context.latestReport.report.assets.join(", ")})`
        : "";
    const timePart = ` · ${fmtTime(context.latestReport.createdAt)} UTC`;
    marketVal = `${regimeStr}${assetsStr}${timePart}`;
  } else {
    marketVal = theme.dim(t("repl.noAnalysis", undefined, lang));
  }

  // Sinyal / Signals
  let signalsVal: string;
  if (context.activeSignals.length > 0) {
    signalsVal = theme.bold(
      t("repl.activeSignals", { count: context.activeSignals.length }, lang),
    );
  } else if (!context.hasData && context.assessments.length === 0 && !context.latestReport) {
    signalsVal = theme.dim(t("repl.noAnalysis", undefined, lang));
  } else {
    signalsVal = theme.dim(t("repl.noSignals", undefined, lang));
  }

  // Kesegaran Data / Data Freshness
  let freshnessVal: string;
  if (!context.hasData && context.assessments.length === 0 && !context.latestReport) {
    freshnessVal = theme.dim(t("repl.noData", undefined, lang));
  } else if (context.staleSources && context.staleSources.length > 0) {
    const staleSummary = context.staleSources
      .map((s) => `${s.label.toLowerCase()} (${s.ageHours !== null ? `${Math.round(s.ageHours)}h` : "stale"})`)
      .join(", ");
    freshnessVal = theme.warning(t("repl.staleSummary", { sources: staleSummary }, lang));
  } else {
    freshnessVal = theme.safe(t("repl.freshAll", undefined, lang));
  }

  // Gateway
  const gw = gatewayStatus(process.env, settings);
  let gatewayVal: string;
  if (gw.channels.includes("telegram")) {
    if (gw.botUsername) {
      gatewayVal = theme.safe(
        t("repl.gatewayTelegramActive", { bot: gw.botUsername, chats: gw.allowedChatsCount ?? 0 }, lang),
      );
    } else {
      gatewayVal = theme.safe(
        lang === "id"
          ? `Telegram aktif · ${gw.allowedChatsCount ?? 0} chat`
          : `Telegram on · ${gw.allowedChatsCount ?? 0} chats`,
      );
    }
  } else {
    if ((gw.allowedChatsCount ?? 0) > 0) {
      gatewayVal = theme.dim(
        t("repl.gatewayTelegramOff", { chats: gw.allowedChatsCount ?? 0 }, lang),
      );
    } else {
      gatewayVal = theme.dim(
        lang === "id" ? "Telegram nonaktif (0 chat terhubung)" : "Telegram off (0 chats connected)",
      );
    }
  }

  // Model
  let modelVal = options.modelLabel;
  if (!modelVal && settings?.roles) {
    const roles = settings.roles;
    modelVal = roles.analyst?.[0] ?? roles.chat?.[0] ?? roles.assessor?.[0];
  }
  if (!modelVal) {
    try {
      const chatEntries = resolveRole("chat");
      if (chatEntries.length > 0) {
        modelVal = chatEntries[0]!.model;
      }
    } catch {
      /* fallback */
    }
  }
  if (!modelVal) {
    modelVal = t("common.notConfigured", undefined, lang);
  }

  // Database
  let rawDriver = options.dbDriver ?? (process.env.DB_DRIVER ?? "").toLowerCase().trim();
  if (!rawDriver) {
    rawDriver = process.env.DATABASE_URL ? "neon" : "pglite";
  }
  const dbVal =
    rawDriver === "neon"
      ? theme.safe(t("repl.dbNeon", undefined, lang))
      : theme.safe(t("repl.dbPglite", undefined, lang));

  const padLabel = (lbl: string, val: string) => `${lbl.padEnd(16)}: ${val}`;
  const lines = [
    padLabel(t("repl.market", undefined, lang), marketVal),
    padLabel(t("repl.signals", undefined, lang), signalsVal),
    padLabel(t("repl.freshness", undefined, lang), freshnessVal),
    padLabel(t("repl.gateway", undefined, lang), gatewayVal),
    padLabel(t("repl.model", undefined, lang), theme.safe(modelVal)),
    padLabel(t("repl.database", undefined, lang), dbVal),
  ];

  const panelOutput = panel(theme, lines, {
    title: t("repl.welcomeTitle", undefined, lang),
  });
  chunks.push(panelOutput);
  chunks.push("");

  // 3. 3 Saran Perintah
  chunks.push(theme.bold(t("repl.suggested", undefined, lang)));
  chunks.push(`  ${theme.brand("/analyze")}  ${t("help.descAnalyze", undefined, lang)}`);
  chunks.push(`  ${theme.brand("/carry")}    ${t("help.descCarry", undefined, lang)}`);
  chunks.push(`  ${theme.brand("/help")}     ${t("help.descHelp", undefined, lang)}`);

  return chunks.join("\n");
}

/**
 * Pisahkan string slash command menjadi nama command dan array argumen.
 */
export function parseSlashCommand(input: string): { command: string; args: string[] } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;
  const match = trimmed.slice(1).match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g);
  if (!match || match.length === 0) return { command: "", args: [] };
  const command = match[0]!.toLowerCase();
  const args = match.slice(1).map((a) => {
    if ((a.startsWith('"') && a.endsWith('"')) || (a.startsWith("'") && a.endsWith("'"))) {
      return a.slice(1, -1);
    }
    return a;
  });
  return { command, args };
}

/**
 * Fungsi pelengkap (completer) untuk readline Tab-completion.
 */
export function slashCompleter(line: string): [string[], string] {
  const names = SLASH_COMMANDS.map(([cmd]) => cmd);
  const trimmed = line.trim();
  if (!trimmed.startsWith("/")) {
    return [[], line];
  }
  const hits = names.filter((c) => c.startsWith(trimmed));
  return [hits.length ? hits : names, line];
}

export interface ReplOptions {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  terminal?: boolean;
  theme?: CliTheme | Theme;
  loaders?: ReplContextLoaders;
  provider?: LlmProvider;
  context?: ReplContext;
  now?: Date;
}

/**
 * Dispatch satu slash command ke modul CLI yang sesuai.
 * Error di command diisolasi dan TIDAK mematikan REPL.
 */
export async function dispatchSlashCommand(
  cmd: string,
  args: string[],
  context: ReplContext,
  theme: CliTheme | Theme,
  replRl?: readline.Interface,
): Promise<void> {
  const cliTheme = ensureCliTheme(theme);

  switch (cmd) {
    case "exit":
    case "quit":
      return;

    case "clear":
      if (process.stdout.isTTY) {
        process.stdout.write("\x1bc");
      } else {
        process.stdout.write(t("repl.screenCleared"));
      }
      return;

    case "help": {
      process.stdout.write(cliTheme.bold(`\n${t("help.title")}\n\n`));
      const sections = getHelpSections(getLanguage());
      for (const sec of sections) {
        process.stdout.write(`${cliTheme.brand(cliTheme.bold(sec.title))}\n`);
        for (const [name, desc] of sec.commands) {
          process.stdout.write(`  ${cliTheme.bold(name.padEnd(12))} ${desc}\n`);
        }
        process.stdout.write("\n");
      }
      process.stdout.write(cliTheme.dim(`${t("help.footerText")}\n`));
      process.stdout.write(cliTheme.dim(`${t("help.footerTip")}\n\n`));
      return;
    }

    case "lang": {
      const target = args[0]?.toLowerCase().trim();
      if (!target) {
        process.stdout.write(`${t("repl.langCurrent", { lang: getLanguage() })}\n`);
        return;
      }
      if (target !== "id" && target !== "en") {
        process.stdout.write(cliTheme.danger(`${t("repl.langInvalid", { lang: target })}\n`));
        return;
      }
      setLanguage(target as SupportedLanguage);
      try {
        const { loadSettings, writeSettings } = await import("../../settings/settings.ts");
        const { settings } = await loadSettings();
        settings.ui = { ...settings.ui, language: target as SupportedLanguage };
        await writeSettings(settings);
      } catch {
        /* ignore write failure in tests or readonly environments */
      }
      process.stdout.write(cliTheme.safe(`${t("repl.langSwitched", { lang: target })}\n`));
      return;
    }

    case "pair": {
      const { gatewayPairCommand } = await import("../commands/gateway-pair.ts");
      await gatewayPairCommand(args, { replRl });
      return;
    }

    case "simulate": {
      process.stdout.write(cliTheme.dim("Simulasi parameter proteksi: skenario risiko likuidasi dievaluasi dari sinyal pasar.\n"));
      return;
    }

    case "status": {
      process.stdout.write(formatStatusLine(context, theme as Theme) + "\n");
      return;
    }

    case "schedule": {
      process.stdout.write(pc.yellow(`\n${SCHEDULE_HINT}\n\n`));
      return;
    }

    case "start": {
      process.stdout.write(pc.yellow(`\n${START_HINT}\n\n`));
      return;
    }

    case "analyze": {
      const { analyzeCommand } = await import("../commands/analyze.ts");
      await analyzeCommand(args);
      return;
    }

    case "fuse": {
      const { fuseCommand } = await import("../commands/fuse.ts");
      await fuseCommand(args);
      return;
    }

    case "carry": {
      const { carryCommand } = await import("../commands/carry.ts");
      await carryCommand(args);
      return;
    }

    case "history": {
      const { historyCommand } = await import("../commands/history.ts");
      await historyCommand(args);
      return;
    }

    case "report": {
      const { reportCommand } = await import("../commands/report.ts");
      const reportArgs = args.length ? args : ["latest"];
      await reportCommand(reportArgs);
      return;
    }

    case "settle": {
      const { settleCommand } = await import("../commands/scorecard-settle.ts");
      await settleCommand(args);
      return;
    }

    case "scorecard": {
      const { scorecardCommand } = await import("../commands/scorecard-settle.ts");
      await scorecardCommand(args);
      return;
    }

    case "models": {
      const { modelsCommand } = await import("../commands/simple.ts");
      await modelsCommand(args);
      return;
    }

    case "settings": {
      const { settingsCommand } = await import("../commands/simple.ts");
      const settingsArgs = args.length ? args : ["show"];
      await settingsCommand(settingsArgs);
      return;
    }

    case "doctor": {
      const { doctorCommand } = await import("../commands/doctor.ts");
      await doctorCommand(args);
      return;
    }

    case "gateway": {
      const sub = args[0];
      const subArgs = args.slice(1);
      if (sub === "pair") {
        const { gatewayPairCommand } = await import("../commands/gateway-pair.ts");
        await gatewayPairCommand(subArgs, { replRl });
        return;
      }
      if (sub === "status") {
        const { gatewayStatusCommand } = await import("../commands/gateway-pair.ts");
        await gatewayStatusCommand(subArgs);
        return;
      }
      process.stdout.write(
        `Perintah /gateway butuh subcommand: /gateway pair atau /gateway status\n`,
      );
      return;
    }

    case "setup": {
      const { setupCommand } = await import("../commands/setup.ts");
      await setupCommand(args, { replRl });
      return;
    }

    default:
      process.stdout.write(
        pc.red(`Perintah slash tidak dikenal: /${cmd}. Ketik /help untuk melihat daftar perintah.\n`),
      );
  }
}

/**
 * Jalankan sesi interaktif REPL.
 */
export async function startRepl(options: ReplOptions = {}): Promise<void> {
  const cliTheme = options.theme ? ensureCliTheme(options.theme) : detectCliTheme();
  const theme = cliTheme;
  const now = options.now ?? new Date();

  // Inisialisasi i18n dari settings.json & env
  let userSettings: Settings | undefined;
  try {
    const { loadSettings } = await import("../../settings/settings.ts");
    const { settings } = await loadSettings();
    userSettings = settings;
    initLanguage({
      settingsLang: settings.ui?.language,
      envLang: process.env.TAHANSOE_LANG,
    });
  } catch {
    initLanguage({ envLang: process.env.TAHANSOE_LANG });
  }

  // Bootstrap budget pricing
  await bootstrapBudgetPricing().catch(() => 0);

  // Muat konteks terkini dari DB
  let context: ReplContext = options.context ?? (await buildReplContext({ now, loaders: options.loaders }));

  // Gateway info
  let modelLabel = "chat";
  try {
    const chatEntries = resolveRole("chat");
    if (chatEntries.length > 0) {
      modelLabel = chatEntries[0]!.model;
    }
  } catch {
    /* fallback */
  }

  const gatewayUrl = gatewayConfig().baseURL;

  // 1. Cetak Layar Selamat Datang (Banner + Status Panel + 3 Saran Perintah)
  process.stdout.write(
    renderWelcomeScreen(cliTheme, context, {
      gatewayUrl,
      modelLabel,
      lang: getLanguage(),
      settings: userSettings,
    }) + "\n\n",
  );

  // 2. Baris status ringkas
  process.stdout.write(formatStatusLine(context, theme as Theme) + "\n\n");

  // 3. Peringatan gateway & petunjuk
  if (!gatewayUrl || !process.env.LLM_API_KEY) {
    process.stdout.write(cliTheme.warning(t("repl.gatewayWarning")) + "\n");
  }
  process.stdout.write(cliTheme.dim(t("repl.hint")) + "\n\n");

  let history: ChatTurn[] = [];

  const rl = readline.createInterface({
    input: options.input ?? process.stdin,
    output: options.output ?? process.stdout,
    completer: slashCompleter,
    prompt: "› ",
    terminal: options.terminal ?? Boolean(process.stdin.isTTY),
  });

  rl.prompt();

  for await (const rawLine of rl) {
    const line = rawLine.trim();

    if (!line) {
      rl.prompt();
      continue;
    }

    const slash = parseSlashCommand(line);

    if (slash) {
      if (slash.command === "exit" || slash.command === "quit") {
        break;
      }

      try {
        rl.pause();
        const origOutput = (rl as any).output;
        const origTerminal = (rl as any).terminal;
        (rl as any).output = null;
        (rl as any).terminal = false;
        try {
          await dispatchSlashCommand(slash.command, slash.args, context, theme, rl);
        } finally {
          (rl as any).output = origOutput;
          (rl as any).terminal = origTerminal;
          rl.resume();
        }
        // Refresh context jika user menjalankan analyze atau fuse
        if (slash.command === "analyze" || slash.command === "fuse") {
          context = await buildReplContext({ now: new Date(), loaders: options.loaders });
        }
      } catch (err) {
        process.stderr.write(
          pc.red(`[tahansoe] error dalam /${slash.command}: ${err instanceof Error ? err.message : String(err)}\n`),
        );
      }
    } else {
      // Tanya Jawab (Grounded Q&A)
      try {
        process.stdout.write(pc.dim(" thinking…\r"));
        const result = await executeChatQuestion(line, context, history, {
          provider: options.provider,
          now: new Date(),
        });

        // Hapus teks thinking
        process.stdout.write("           \r");

        // Cetak jawaban plain text
        process.stdout.write(`${result.answer}\n\n`);

        // Cetak baris biaya & footer
        process.stdout.write(pc.dim(` ${result.costLine} · ${result.footer}\n\n`));

        // Tambah ke riwayat (maksimal 10 giliran)
        history.push({ role: "user", content: line });
        history.push({ role: "assistant", content: result.answer });
        history = capHistory(history);
      } catch (err) {
        process.stdout.write("           \r");
        process.stderr.write(
          pc.red(`[tahansoe] gagal menjawab: ${err instanceof Error ? err.message : String(err)}\n`),
        );
      }
    }

    rl.prompt();
  }

  rl.close();
}

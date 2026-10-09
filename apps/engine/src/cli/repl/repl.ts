/**
 * Mode Interaktif REPL CLI Tahansoe (spec m3-cli §3.5).
 *
 * Menggunakan node:readline dan picocolors (tanpa dependensi baru).
 *  - Banner + satu baris status ringkas (regime per aset, waktu UTC, sinyal aktif)
 *  - Prompt "› "
 *  - Autocomplete Tab untuk slash commands
 *  - Riwayat input (↑/↓) di memori
 *  - Dispatch in-process untuk slash command (error tidak membunuh REPL)
 *  - Panggilan Q&A yang grounded untuk input non-slash
 *  - Menolak schedule run di REPL (menampilkan hint agar dijalankan di proses terpisah)
 */

import * as readline from "node:readline";
import pc from "picocolors";
import type { LlmProvider } from "../../llm/provider.ts";
import { banner, maskHost, detectTheme, type Theme } from "../render.ts";
import { gatewayConfig, resolveRole } from "../../llm/registry.ts";
import { bootstrapBudgetPricing } from "../../llm/pricing-bootstrap.ts";
import { buildReplContext, formatStatusLine, type ReplContext, type ReplContextLoaders } from "./context.ts";
import { executeChatQuestion, capHistory, type ChatTurn } from "./chat.ts";

export const SLASH_COMMANDS: Array<[string, string]> = [
  ["/analyze", "Run one risk-research pass + report card (e.g. /analyze --dry)"],
  ["/fuse", "Run one Risk Fusion v1 pass (deterministic)"],
  ["/carry", "Aave V3 carry & interest-rate risk monitor"],
  ["/history", "Recent research reports table + sparkline"],
  ["/report", "Show full report by id or latest (e.g. /report latest)"],
  ["/settle", "Settle due research reports (ADR 0005)"],
  ["/scorecard", "Research-agent accuracy scorecard"],
  ["/models", "List gateway models + prices"],
  ["/settings", "Show or manage settings.json"],
  ["/doctor", "Check environment & connectivity"],
  ["/setup", "Run initial setup wizard (gateway, models, DB)"],
  ["/gateway", "Channel gateway operations (/gateway pair, /gateway status)"],
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
  theme?: Theme;
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
  theme: Theme,
  replRl?: readline.Interface,
): Promise<void> {
  switch (cmd) {
    case "exit":
    case "quit":
      return;

    case "clear":
      if (process.stdout.isTTY) {
        process.stdout.write("\x1bc");
      } else {
        process.stdout.write("\n--- screen cleared ---\n");
      }
      return;

    case "help": {
      process.stdout.write(pc.bold("\nAvailable slash commands:\n"));
      for (const [name, desc] of SLASH_COMMANDS) {
        process.stdout.write(`  ${name.padEnd(12)} ${desc}\n`);
      }
      process.stdout.write(
        pc.dim("\nAny other text is answered by the grounded risk research agent.\n"),
      );
      process.stdout.write(
        pc.dim("Tip: Jalankan 'tahansoe start' di terminal terpisah untuk menjalankan agent mandiri penuh.\n"),
      );
      return;
    }

    case "status": {
      process.stdout.write(formatStatusLine(context, theme) + "\n");
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
  const theme = options.theme ?? detectTheme(process.argv.slice(2), process.env, process.stdout);
  const now = options.now ?? new Date();

  // Bootstrap budget pricing
  await bootstrapBudgetPricing().catch(() => 0);

  // Muat konteks terkini dari DB
  let context: ReplContext = options.context ?? (await buildReplContext({ now, loaders: options.loaders }));

  // Gateway info untuk banner
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
  const hostLabel = gatewayUrl ? maskHost(gatewayUrl) : "(no gateway)";

  // 1. Cetak Banner
  process.stdout.write(banner(theme, `risk research · Arbitrum One · ${hostLabel} · ${modelLabel}`) + "\n");

  // 2. Cetak baris status
  process.stdout.write(formatStatusLine(context, theme) + "\n");

  // 3. Cetak petunjuk
  if (!gatewayUrl || !process.env.LLM_API_KEY) {
    process.stdout.write(pc.yellow("Tip: LLM Gateway belum dikonfigurasi. Ketik /setup untuk konfigurasi awal.\n"));
  }
  process.stdout.write(pc.dim(REPL_HINT) + "\n");

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

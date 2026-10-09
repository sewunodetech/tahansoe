/**
 * `tahansoe ask "<question>"` — Tanya-jawab grounded non-interaktif (spec m3-cli §3.5).
 *
 * Menggunakan pipeline yang sama persis dengan mode REPL untuk menjawab pertanyaan
 * berdasarkan konteks tersimpan (laporan riset, assessment, carry, sinyal, harga, makro).
 * Berguna untuk otomasi scripting, verifikasi offline, dan live test.
 */

import { parseArgs } from "node:util";
import pc from "picocolors";
import type { LlmProvider } from "../../llm/provider.ts";
import { EXIT_OK, EXIT_ERROR } from "./args.ts";
import { detectTheme } from "../render.ts";
import { bootstrapBudgetPricing } from "../../llm/pricing-bootstrap.ts";
import { buildReplContext, type ReplContextLoaders } from "../repl/context.ts";
import { executeChatQuestion, type ChatExecutionResult } from "../repl/chat.ts";

export const ASK_HELP = `tahansoe ask "<question>" — grounded risk Q&A based on stored context

Usage: tahansoe ask "<question>" [options]
  --json       Emit machine-readable JSON on stdout
  --no-color   Disable ANSI colors
  --help       Show this help`;

export interface AskDeps {
  loaders?: ReplContextLoaders;
  provider?: LlmProvider;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
}

export async function askCommand(argv: string[], deps: AskDeps = {}): Promise<number> {
  const writeOut = deps.stdout ?? ((s: string) => void process.stdout.write(s));
  const writeErr = deps.stderr ?? ((s: string) => void process.stderr.write(s));

  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        json: { type: "boolean" },
        "no-color": { type: "boolean" },
        help: { type: "boolean" },
      },
      allowPositionals: true,
    });
  } catch (err) {
    writeErr(`argumen tidak valid: ${err instanceof Error ? err.message : String(err)}\n`);
    return EXIT_ERROR;
  }

  if (parsed.values.help) {
    writeOut(ASK_HELP + "\n");
    return EXIT_OK;
  }

  const question = parsed.positionals.join(" ").trim();
  if (!question) {
    writeErr("Harap masukkan pertanyaan: tahansoe ask \"<pertanyaan>\"\n");
    return EXIT_ERROR;
  }

  const theme = detectTheme(argv, process.env, process.stdout);

  try {
    await bootstrapBudgetPricing().catch(() => 0);
    const context = await buildReplContext({ loaders: deps.loaders, now: new Date() });
    const result: ChatExecutionResult = await executeChatQuestion(question, context, [], {
      provider: deps.provider,
      now: new Date(),
    });

    if (parsed.values.json) {
      writeOut(
        JSON.stringify({
          ok: true,
          question,
          answer: result.answer,
          tokens: result.tokens,
          costUsd: result.costUsd,
          costIdr: result.costIdr,
          modelUsed: result.modelUsed,
          refused: result.refused,
          isStale: context.isStale,
          staleReason: context.staleReason,
        }) + "\n",
      );
      return EXIT_OK;
    }

    // Output teks biasa
    writeOut(`${result.answer}\n\n`);

    const costLine = theme.color ? pc.dim(` ${result.costLine} · ${result.footer}\n`) : ` ${result.costLine} · ${result.footer}\n`;
    writeOut(costLine);

    return EXIT_OK;
  } catch (err) {
    writeErr(`[tahansoe ask] gagal: ${err instanceof Error ? err.message : String(err)}\n`);
    return EXIT_ERROR;
  }
}

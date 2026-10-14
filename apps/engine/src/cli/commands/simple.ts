/**
 * `tahansoe models` / `settings` / `eval` — delegasi tipis ke modul CLI yang ada.
 */

import { parseArgs } from "node:util";
import { EXIT_OK, EXIT_ERROR } from "./args.ts";

/** `tahansoe models [--filter x]` — daftar model gateway + harga + estimasi. */
export async function modelsCommand(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: { filter: { type: "string" }, help: { type: "boolean" } },
      allowPositionals: false,
    });
  } catch (err) {
    process.stderr.write(`argumen tidak valid: ${err instanceof Error ? err.message : String(err)}\n`);
    return EXIT_ERROR;
  }
  if (parsed.values.help) {
    process.stdout.write("tahansoe models [--filter <teks>]\n");
    return EXIT_OK;
  }
  const { runModelsCli } = await import("../models.ts");
  const { tokenProfileFromDb, DEFAULT_TOKEN_PROFILE } = await import("../../llm/estimate.ts");
  const profile = (await tokenProfileFromDb(5)) ?? DEFAULT_TOKEN_PROFILE;
  const { output, warnings } = await runModelsCli({ filter: parsed.values.filter, profile });
  for (const w of warnings) process.stderr.write(w + "\n");
  process.stdout.write(output + "\n");
  return EXIT_OK;
}

/** `tahansoe settings <show|init|set-role|set> …` — delegasi ke settings CLI. */
export async function settingsCommand(argv: string[]): Promise<number> {
  const { settingsMain } = await import("../settings.ts");
  await settingsMain(argv);
  return process.exitCode === 1 ? EXIT_ERROR : EXIT_OK;
}

/** `tahansoe eval [...]` — delegasi ke src/eval/runner.ts (spawn via tsx). */
export const EVAL_HELP = `tahansoe eval — run the LLM eval set (prompt injection + market scenarios)

Usage: tahansoe eval [options]
  --set <all|injection|scenarios>  Which cases to run (default: all = 16 injection + 8 scenarios)
  --limit <N>                      Run only the first N cases
  --runs <N>                       Repeat each case N times (default: 1)
  --concurrency <N>                Parallel cases (default: 1)
  --delay-ms <ms>                  Pause between cases
  --max-cost-idr <Rp>              Hard spend cap for this eval (default: 3000)
  --initial-spent-idr <Rp>         Count already-spent amount toward the cap
  --label <name>                   Label for the report folder
  --dry-plan                       Show the plan and cost estimate only (no LLM calls)
  --help                           Show this help

Note: without --dry-plan this CALLS THE LLM GATEWAY and spends budget.`;

/** Flag yang dikenal runner; flag lain ditolak agar salah ketik tidak menjalankan eval berbayar. */
const EVAL_VALUE_FLAGS = new Set([
  "--set",
  "--limit",
  "--runs",
  "--concurrency",
  "--delay-ms",
  "--max-cost-idr",
  "--initial-spent-idr",
  "--label",
]);
const EVAL_BOOL_FLAGS = new Set(["--dry-plan"]);

/** Validasi argumen eval. Mengembalikan pesan error, atau null bila valid. */
export function validateEvalArgs(argv: string[]): string | null {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (EVAL_BOOL_FLAGS.has(a)) continue;
    if (EVAL_VALUE_FLAGS.has(a)) {
      if (i + 1 >= argv.length || argv[i + 1]!.startsWith("--")) return `flag ${a} butuh nilai`;
      i++;
      continue;
    }
    return `argumen tidak dikenal: ${a}`;
  }
  return null;
}

export async function evalCommand(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(EVAL_HELP + "\n");
    return EXIT_OK;
  }
  const invalid = validateEvalArgs(argv);
  if (invalid) {
    process.stderr.write(`${invalid}\n\n${EVAL_HELP}\n`);
    return EXIT_ERROR;
  }
  const { spawn } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const here = dirname(fileURLToPath(import.meta.url)); // src/cli/commands
  const runner = join(here, "..", "..", "eval", "runner.ts"); // src/eval/runner.ts
  const tsxCli = join(here, "..", "..", "..", "..", "..", "node_modules", "tsx", "dist", "cli.mjs");
  return await new Promise<number>((resolve) => {
    const child = spawn(process.execPath, [tsxCli, "--env-file-if-exists=.env", runner, ...argv], {
      stdio: "inherit",
      cwd: join(here, "..", "..", ".."), // apps/engine
    });
    child.on("exit", (code) => resolve(code === 0 ? EXIT_OK : EXIT_ERROR));
    child.on("error", (err) => {
      process.stderr.write(`eval gagal dijalankan: ${err.message}\n`);
      resolve(EXIT_ERROR);
    });
  });
}

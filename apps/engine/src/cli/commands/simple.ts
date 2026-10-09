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
export async function evalCommand(argv: string[]): Promise<number> {
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

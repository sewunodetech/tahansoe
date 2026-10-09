#!/usr/bin/env node
/**
 * bin shim `tahansoe` (ADR 0009 / spec m3-cli). Menjalankan CLI via tsx dengan
 * memuat .env relatif ke paket engine (apps/engine/.env). Dipakai lewat
 * `npm link` lokal / `npm exec tahansoe`.
 *
 * Tidak mencetak secret; hanya meneruskan argv ke src/cli/tahansoe.ts.
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url)); // apps/engine/bin
const engineRoot = join(here, ".."); // apps/engine
const entry = join(engineRoot, "src", "cli", "tahansoe.ts");

// tsx CLI dari node_modules (resolusi dari root monorepo).
const tsxCli = join(engineRoot, "..", "..", "node_modules", "tsx", "dist", "cli.mjs");

const child = spawn(
  process.execPath,
  [tsxCli, "--env-file-if-exists=.env", entry, ...process.argv.slice(2)],
  { stdio: "inherit", cwd: engineRoot },
);
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
child.on("error", (err) => {
  process.stderr.write(`[tahansoe] gagal menjalankan tsx: ${err.message}\n`);
  process.exit(1);
});

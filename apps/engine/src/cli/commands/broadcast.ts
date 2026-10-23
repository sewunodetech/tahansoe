/**
 * CLI command `tahansoe broadcast digest|once [--dry]` (spec m3-research-broadcast §3 T4).
 */

import { parseArgs } from "node:util";
import { EXIT_OK, EXIT_ERROR } from "./args.ts";
import { BroadcastWorker } from "../../broadcast/worker.ts";
import { defaultEnvPath } from "../env-writer.ts";
import { existsSync, readFileSync } from "node:fs";

export const BROADCAST_HELP = `tahansoe broadcast — broadcast risk digest and proactive alerts

Usage:
  tahansoe broadcast digest [--dry] [--force]
  tahansoe broadcast once [--dry]

Options:
  --dry     Preview message and recipient count without sending
  --force   Ignore deduplication and force sending
  --help    Show this help message`;

/**
 * Muat file .env dari apps/engine/.env jika DATABASE_URL atau TELEGRAM_BOT_TOKEN belum diset di process.env.
 */
export function ensureEngineEnv(): void {
  const envPath = defaultEnvPath();
  if (existsSync(envPath)) {
    try {
      const content = readFileSync(envPath, "utf8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if (
            (val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))
          ) {
            val = val.slice(1, -1);
          }
          if (!(key in process.env)) {
            process.env[key] = val;
          }
        }
      }
    } catch {
      // abaikan error baca file
    }
  }
}

export async function broadcastCommand(
  argv: string[],
  deps: {
    worker?: BroadcastWorker;
    stdout?: (m: string) => void;
    stderr?: (m: string) => void;
  } = {},
): Promise<number> {
  const writeOut = deps.stdout ?? ((s: string) => void process.stdout.write(s));
  const writeErr = deps.stderr ?? ((s: string) => void process.stderr.write(s));

  ensureEngineEnv();

  const sub = argv[0];
  const rest = argv.slice(1);

  if (!sub || sub === "--help" || sub === "-h") {
    writeOut(BROADCAST_HELP + "\n");
    return EXIT_OK;
  }

  let parsed;
  try {
    parsed = parseArgs({
      args: rest,
      options: {
        dry: { type: "boolean" },
        force: { type: "boolean" },
        help: { type: "boolean" },
      },
      allowPositionals: false,
    });
  } catch (err) {
    writeErr(`argumen tidak valid: ${err instanceof Error ? err.message : String(err)}\n`);
    return EXIT_ERROR;
  }

  if (parsed.values.help) {
    writeOut(BROADCAST_HELP + "\n");
    return EXIT_OK;
  }

  const isDry = Boolean(parsed.values.dry || process.env.npm_config_dry === "true");
  const isForce = Boolean(parsed.values.force);

  const worker = deps.worker ?? new BroadcastWorker();

  if (sub === "digest") {
    try {
      const res = await worker.sendDigest({ dryRun: isDry, force: isForce });
      writeOut(`[broadcast] Jumlah penerima aktif: ${res.recipientsCount}\n`);
      writeOut(`----------------------------------------\n`);
      writeOut(`${res.message}\n`);
      writeOut(`----------------------------------------\n`);

      if (isDry) {
        writeOut(`[broadcast] Mode --dry aktif: pesan tidak dikirim ke Telegram.\n`);
      } else {
        writeOut(`[broadcast] Selesai: ${res.sentCount} terkirim, ${res.failedCount} gagal.\n`);
      }
      return EXIT_OK;
    } catch (err) {
      writeErr(`[broadcast] gagal membuat/mengirim digest: ${err instanceof Error ? err.message : String(err)}\n`);
      return EXIT_ERROR;
    }
  }

  if (sub === "once") {
    try {
      const recipients = await worker.fetchRecipients();
      writeOut(`[broadcast] Jumlah penerima aktif: ${recipients.length}\n`);
      if (isDry) {
        writeOut(`[broadcast] Evaluasi satu siklus broadcast (--dry):\n`);
        const res = await worker.sendDigest({ dryRun: true });
        writeOut(`Pesan digest contoh:\n${res.message}\n`);
        return EXIT_OK;
      }

      const sent = await worker.pollOnce();
      writeOut(`[broadcast] Siklus selesai: ${sent} alert/digest dikirim.\n`);
      return EXIT_OK;
    } catch (err) {
      writeErr(`[broadcast] gagal eksekusi broadcast once: ${err instanceof Error ? err.message : String(err)}\n`);
      return EXIT_ERROR;
    }
  }

  writeErr(`subcommand broadcast tidak dikenal: ${sub} (gunakan: digest | once)\n`);
  return EXIT_ERROR;
}

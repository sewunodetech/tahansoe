/**
 * CLI command `tahansoe gateway run` (spec m3-channel-gateway §2, §7).
 *
 * Menjalankan channel gateway secara mandiri (stand-alone process).
 * Antigravity #2 menghubungkannya ke tahansoe.ts.
 */

import { parseArgs } from "node:util";
import { startGateway, gatewayStatus } from "./index.ts";
import { loadSettings } from "../settings/settings.ts";

export const GATEWAY_HELP = `tahansoe gateway run — run channel gateway standalone

Usage:
  tahansoe gateway run [--poll-sec <sec>]

Environment:
  TELEGRAM_BOT_TOKEN            Telegram bot token from @BotFather
  TELEGRAM_ALLOWED_CHAT_IDS     Allowed chat IDs (comma-separated, optional)
  GATEWAY_ALERT_POLL_SEC        Alert check interval in seconds (default: 60)
  GATEWAY_QA_PER_DAY            Daily grounded Q&A question limit per chat (default: 20)`;

export async function gatewayRunCommand(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        help: { type: "boolean" },
        "poll-sec": { type: "string" },
      },
      allowPositionals: true,
    });
  } catch (err) {
    process.stderr.write(`argumen tidak valid: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }

  if (parsed.values.help) {
    process.stdout.write(GATEWAY_HELP + "\n");
    return 0;
  }

  const { settings } = await loadSettings();
  const status = gatewayStatus(process.env, settings);

  if (!status.configured) {
    process.stderr.write(
      "TELEGRAM_BOT_TOKEN belum diset di .env — jalankan 'tahansoe setup' atau tambahkan token di apps/engine/.env.\n",
    );
    return 1;
  }

  const pollIntervalSec = parsed.values["poll-sec"]
    ? Number(parsed.values["poll-sec"])
    : undefined;

  process.stdout.write(
    `[Gateway] Starting channel gateway (${status.channels.join(", ")} active)...\n`,
  );

  const instance = await startGateway({
    logger: (msg: string) => process.stdout.write(`${msg}\n`),
    pollIntervalSec,
  });

  process.stdout.write("[Gateway] Running. Press Ctrl+C to stop.\n");

  await new Promise<void>((resolve) => {
    const onSignal = () => {
      process.stdout.write("\n[Gateway] Received shutdown signal...\n");
      void instance.stop().then(() => {
        resolve();
      });
    };

    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
  });

  return 0;
}

/**
 * Entry CLI `tahansoe` (spec m3-cli). Satu pintu untuk analyze/schedule/history/
 * report/models/settings/eval/doctor. Dispatch dengan node:util (tanpa framework).
 *
 * Exit code: 0 ok · 1 error · 2 config salah (mis. LLM_API_URL/KEY hilang).
 * Tanpa aksi on-chain; tidak pernah mencetak secret.
 */

import { pathToFileURL } from "node:url";
import { detectTheme, banner, dim, bold, maskHost, regimeColor } from "./render.ts";
import { EXIT_OK, EXIT_ERROR, EXIT_CONFIG } from "./commands/args.ts";

const COMMANDS = [
  ["analyze", "Run one risk-research pass + report card"],
  ["schedule", "Run the scheduler (foreground) or show status"],
  ["history", "Recent research reports (table + sparkline)"],
  ["report", "Show a full report by <id|latest>"],
  ["models", "List gateway models + prices + cost estimate"],
  ["settings", "Manage non-secret settings.json"],
  ["eval", "Run the eval set"],
  ["fuse", "Run one Risk Fusion v1 pass (per-asset regime)"],
  ["settle", "Settle due research reports (ADR 0005)"],
  ["scorecard", "Research-agent accuracy scorecard"],
  ["doctor", "Check env & connectivity"],
] as const;

const TOP_HELP = `Usage: tahansoe <command> [options]

Commands:
${COMMANDS.map(([c, d]) => `  ${c.padEnd(10)} ${d}`).join("\n")}

Run "tahansoe <command> --help" for command options.
Flags: --json (machine output), --no-color (disable ANSI).`;

/** Banner + status singkat (regime terakhir dari DB bila ada, model aktif, lock?). */
async function quickStatus(): Promise<void> {
  const theme = detectTheme(process.argv.slice(2), process.env, process.stdout);

  // Gateway host (disamarkan) dari settings/env.
  let gatewayHost = "(not configured)";
  try {
    const { gatewayConfig } = await import("./../llm/registry.ts");
    const url = gatewayConfig().baseURL;
    gatewayHost = url ? maskHost(url) : "(not configured)";
  } catch {
    /* abaikan */
  }
  process.stdout.write(banner(theme, `risk research · Arbitrum One · gateway ${gatewayHost}`) + "\n");

  // Model aktif dari settings.json.
  try {
    const { loadSettings } = await import("./../settings/settings.ts");
    const { settings } = await loadSettings();
    const roles = settings.roles;
    const show = (xs?: string[]) => (xs && xs.length ? xs.join(", ") : "(default)");
    process.stdout.write(dim(theme, ` models   analyst ${show(roles.analyst)} · assessor ${show(roles.assessor)}\n`));
  } catch {
    /* abaikan */
  }

  // Regime terakhir dari DB (bila DATABASE_URL diset).
  if (process.env.DATABASE_URL) {
    try {
      const { recentReports } = await import("./../db/history.ts");
      const rows = await recentReports(1);
      if (rows.length > 0) {
        const r = rows[0]!;
        const when = r.createdAt.toISOString().slice(0, 16).replace("T", " ");
        process.stdout.write(` last run ${when} UTC · ${regimeColor(theme, r.regime, r.regime)} ${r.direction}\n`);
      } else {
        process.stdout.write(dim(theme, " last run (none yet)\n"));
      }
    } catch {
      process.stdout.write(dim(theme, " last run (db unavailable)\n"));
    }
  } else {
    process.stdout.write(dim(theme, " last run (set DATABASE_URL to show)\n"));
  }

  process.stdout.write("\n" + bold(theme, "Commands") + "\n");
  for (const [c, d] of COMMANDS) process.stdout.write(`  ${c.padEnd(10)} ${d}\n`);
  process.stdout.write(dim(theme, '\nRun "tahansoe <command> --help" for options.\n'));
}

export async function main(argv: string[]): Promise<number> {
  const cmd = argv[0];
  const rest = argv.slice(1);

  if (!cmd) {
    await quickStatus();
    return EXIT_OK;
  }
  if (cmd === "--help" || cmd === "-h" || cmd === "help") {
    process.stdout.write(TOP_HELP + "\n");
    return EXIT_OK;
  }

  switch (cmd) {
    case "analyze": {
      const { analyzeCommand } = await import("./commands/analyze.ts");
      return analyzeCommand(rest);
    }
    case "schedule": {
      const { scheduleCommand } = await import("./commands/schedule.ts");
      return scheduleCommand(rest);
    }
    case "history": {
      const { historyCommand } = await import("./commands/history.ts");
      return historyCommand(rest);
    }
    case "report": {
      const { reportCommand } = await import("./commands/report.ts");
      return reportCommand(rest);
    }
    case "models": {
      const { modelsCommand } = await import("./commands/simple.ts");
      return modelsCommand(rest);
    }
    case "settings": {
      const { settingsCommand } = await import("./commands/simple.ts");
      return settingsCommand(rest);
    }
    case "eval": {
      const { evalCommand } = await import("./commands/simple.ts");
      return evalCommand(rest);
    }
    case "settle": {
      const { settleCommand } = await import("./commands/scorecard-settle.ts");
      return settleCommand(rest);
    }
    case "scorecard": {
      const { scorecardCommand } = await import("./commands/scorecard-settle.ts");
      return scorecardCommand(rest);
    }
    case "fuse": {
      const { fuseCommand } = await import("./commands/fuse.ts");
      return fuseCommand(rest);
    }
    case "doctor": {
      const { doctorCommand } = await import("./commands/doctor.ts");
      return doctorCommand(rest);
    }
    default:
      process.stderr.write(`perintah tidak dikenal: ${cmd}\n\n${TOP_HELP}\n`);
      return EXIT_ERROR;
  }
}

const invoked = process.argv[1];
if (invoked && import.meta.url === pathToFileURL(invoked).href) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      process.stderr.write(`[tahansoe] gagal: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = EXIT_ERROR;
    });
}

void EXIT_CONFIG;

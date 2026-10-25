/**
 * `tahansoe agent` — CLI subcommand untuk Protection Strategy Agent (spec §3.2-3.3, Phase A).
 * Subcommands:
 *   tahansoe agent plans [--position <key>] [--limit 20] [--json] [--no-color]
 */

import { parseArgs } from "node:util";
import { desc, eq } from "drizzle-orm";
import { getDb, isDbConfigured, protectionPlans, type Db } from "@tahansoe/db";
import { detectTheme, table, dim, bold, type TableColumn } from "../render.ts";
import { EXIT_OK, EXIT_ERROR, EXIT_CONFIG } from "./args.ts";

export const AGENT_PLANS_HELP = `tahansoe agent — Protection Strategy Agent inspection

Usage:
  tahansoe agent plans [--position <key>] [--limit 20] [--json] [--no-color]

Options:
  --position <key>  Filter plans by canonical positionKey
  --limit <n>       Maximum number of recent plans to show (default: 20)
  --json            Output machine-readable JSON
  --no-color        Disable ANSI color escapes
  --help            Show this help text`;

export interface AgentPlansDeps {
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
  db?: Db;
}

export async function agentPlansCommand(
  argv: string[],
  deps: AgentPlansDeps = {},
): Promise<number> {
  const writeOut = deps.stdout ?? ((s: string) => void process.stdout.write(s));
  const writeErr = deps.stderr ?? ((s: string) => void process.stderr.write(s));

  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        position: { type: "string" },
        limit: { type: "string" },
        json: { type: "boolean" },
        "no-color": { type: "boolean" },
        help: { type: "boolean" },
      },
      allowPositionals: false,
    });
  } catch (err) {
    writeErr(`argumen tidak valid: ${err instanceof Error ? err.message : String(err)}\n`);
    return EXIT_ERROR;
  }

  if (parsed.values.help) {
    writeOut(AGENT_PLANS_HELP + "\n");
    return EXIT_OK;
  }

  const json = Boolean(parsed.values.json);
  const positionFilter = parsed.values.position?.trim();
  const limit = Math.max(1, Math.min(200, Number(parsed.values.limit ?? "20") || 20));

  const dbAvailable = deps.db != null || isDbConfigured() || Boolean(process.env.DATABASE_URL);
  if (!dbAvailable) {
    if (json) {
      writeOut(JSON.stringify({ ok: false, reason: "DATABASE_URL not set" }) + "\n");
    } else {
      writeErr("DATABASE_URL belum diset — daftar plan butuh koneksi DB.\n");
    }
    return EXIT_CONFIG;
  }

  try {
    const database = deps.db ?? getDb();
    let query = database.select().from(protectionPlans);

    if (positionFilter) {
      query = query.where(eq(protectionPlans.positionKey, positionFilter)) as any;
    }

    const rows = await query.orderBy(desc(protectionPlans.createdAt)).limit(limit);

    if (json) {
      writeOut(
        JSON.stringify(
          rows.map((r) => ({
            id: r.id,
            positionKey: r.positionKey,
            strategyVersion: r.strategyVersion,
            action: r.action,
            amount: r.amount,
            triggerHf: r.triggerHf,
            healthFactor: r.healthFactor,
            expectedHfAfter: r.expectedHfAfter,
            urgency: r.urgency,
            regime: r.regime,
            drivers: r.drivers,
            playbookIds: r.playbookIds,
            planHash: r.planHash,
            decision: r.decision,
            rejectReason: r.rejectReason,
            mode: r.mode,
            createdAt: r.createdAt.toISOString(),
          })),
          null,
          2,
        ) + "\n",
      );
      return EXIT_OK;
    }

    const theme = detectTheme(argv, process.env, process.stdout);
    if (rows.length === 0) {
      writeOut(dim(theme, "Belum ada protection plan yang tercatat.\n"));
      return EXIT_OK;
    }

    writeOut(bold(theme, `Protection Plans (${rows.length} terbaru)`) + "\n\n");

    const columns: TableColumn[] = [
      { key: "time", header: "Time (UTC)" },
      { key: "action", header: "Action" },
      { key: "amount", header: "Amount", align: "right" },
      { key: "hf", header: "HF → Exp" },
      { key: "decision", header: "Decision" },
      { key: "version", header: "Version" },
      { key: "hash", header: "Hash" },
    ];
    const tableRows = rows.map((r) => ({
      time: r.createdAt.toISOString().slice(0, 16).replace("T", " "),
      action: r.action,
      amount: r.amount ? r.amount : "-",
      hf: `${r.healthFactor} → ${r.expectedHfAfter}`,
      decision: r.decision === "ACCEPTED" ? "ACCEPTED" : `REJECTED (${r.rejectReason ?? "rules"})`,
      version: r.strategyVersion,
      hash: `${r.planHash.slice(0, 8)}…`,
    }));

    writeOut(table(theme, columns, tableRows) + "\n");
    return EXIT_OK;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (json) {
      writeOut(JSON.stringify({ ok: false, reason: msg }) + "\n");
    } else {
      writeErr(`gagal membaca protection plans: ${msg}\n`);
    }
    return EXIT_ERROR;
  }
}

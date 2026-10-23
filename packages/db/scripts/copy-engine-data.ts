/**
 * Salin data historis engine dari SOURCE_DATABASE_URL ke DATABASE_URL (DB web / custos).
 *
 * Sesuai plan §3 T1:
 * - Sumber: SOURCE_DATABASE_URL atau fallback ke E:/web3/tahansoe/apps/engine/.env
 * - Target: DATABASE_URL (apps/web/.env)
 * - Tabel riset yang disalin (insert-only, ON CONFLICT DO NOTHING, urutan FK):
 *     1. research_reports
 *     2. signals
 *     3. risk_assessments
 *     4. risk_settlements
 *     5. research_lessons
 *     6. price_samples
 *     7. rate_samples
 *     8. llm_usage_daily
 * - Tabel user-level hanya dihitung dan dilaporkan (tidak disalin):
 *     users, policies, positions, telegram_accounts, event_cursors, intents,
 *     siwe_nonces, link_nonces, guardian_modules, notification_logs
 * - Flag --dry-run: hanya menghitung dan menampilkan tanpa melakukan insert.
 */

import "./env";
import fs from "node:fs";
import { neon } from "@neondatabase/serverless";

interface TableSpec {
  name: string;
  conflictKey: string;
}

const RESEARCH_TABLES: TableSpec[] = [
  { name: "research_reports", conflictKey: "id" },
  { name: "signals", conflictKey: "id" },
  { name: "risk_assessments", conflictKey: "id" },
  { name: "risk_settlements", conflictKey: "id" },
  { name: "research_lessons", conflictKey: "id" },
  { name: "price_samples", conflictKey: "id" },
  { name: "rate_samples", conflictKey: "id" },
  { name: "llm_usage_daily", conflictKey: "day" },
];

const USER_LEVEL_TABLES: string[] = [
  "users",
  "policies",
  "positions",
  "telegram_accounts",
  "event_cursors",
  "intents",
  "siwe_nonces",
  "link_nonces",
  "guardian_modules",
  "notification_logs",
];

const BATCH_SIZE = 100;

export function maskHost(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.host;
    const dbName = parsed.pathname;
    if (host.length <= 12) {
      return `${host.slice(0, 4)}***${dbName}`;
    }
    const prefix = host.slice(0, 8);
    const suffix = host.slice(-10);
    return `${prefix}...${suffix}${dbName}`;
  } catch {
    return "***masked***";
  }
}

export function getSourceDatabaseUrl(): string {
  if (process.env.SOURCE_DATABASE_URL?.trim()) {
    return process.env.SOURCE_DATABASE_URL.trim();
  }

  const oldEngineEnv = "E:/web3/tahansoe/apps/engine/.env";
  if (fs.existsSync(oldEngineEnv)) {
    const lines = fs.readFileSync(oldEngineEnv, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("DATABASE_URL=")) {
        let val = trimmed.slice("DATABASE_URL=".length).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (val) return val;
      }
    }
  }

  throw new Error(
    "[@tahansoe/db] SOURCE_DATABASE_URL tidak diset dan tidak ditemukan di E:/web3/tahansoe/apps/engine/.env",
  );
}

export function getTargetDatabaseUrl(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error("[@tahansoe/db] DATABASE_URL target tidak diset di environment");
  }
  return url;
}

async function getRowCount(sql: any, table: string): Promise<number> {
  try {
    const rows: any = await sql.query(`SELECT COUNT(*)::int as c FROM "${table}"`);
    return Number(rows[0]?.c ?? 0);
  } catch {
    return 0;
  }
}

async function getColumns(sql: any, table: string): Promise<string[]> {
  const rows: any = await sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table}
    ORDER BY ordinal_position;
  `;
  return Array.isArray(rows) ? rows.map((r: any) => String(r.column_name)) : [];
}

function serializeValue(val: unknown): unknown {
  if (val === null || val === undefined) return null;
  if (val instanceof Date) return val.toISOString();
  if (typeof val === "object") return JSON.stringify(val);
  return val;
}

export async function copyEngineData(options: { dryRun?: boolean } = {}) {
  const isDryRun = Boolean(options.dryRun);
  const sourceUrl = getSourceDatabaseUrl();
  const targetUrl = getTargetDatabaseUrl();

  console.log("============================================================");
  console.log("   TAHANSOE DATABASE SYNC: ENGINE DATA -> WEB DATABASE     ");
  console.log("============================================================");
  console.log(`Mode        : ${isDryRun ? "DRY-RUN (tidak ada data diubah)" : "LIVE EXECUTION (insert-only)"}`);
  console.log(`Source DB   : ${maskHost(sourceUrl)}`);
  console.log(`Target DB   : ${maskHost(targetUrl)}`);
  console.log("------------------------------------------------------------\n");

  const sourceSql = neon(sourceUrl);
  const targetSql = neon(targetUrl);

  // 1. Hitung jumlah baris awal pada tabel riset dan user-level
  console.log(">>> [1/3] Menghitung baris sebelum migrasi data...");
  const beforeStats: Record<string, { source: number; target: number }> = {};

  for (const t of RESEARCH_TABLES) {
    const src = await getRowCount(sourceSql, t.name);
    const tgt = await getRowCount(targetSql, t.name);
    beforeStats[t.name] = { source: src, target: tgt };
  }

  const userStats: Record<string, { source: number; target: number }> = {};
  for (const t of USER_LEVEL_TABLES) {
    const src = await getRowCount(sourceSql, t);
    const tgt = await getRowCount(targetSql, t);
    userStats[t] = { source: src, target: tgt };
  }

  console.log("\n--- Tabel Riset (akan disalin) ---");
  console.log(`${"Tabel".padEnd(22)} | ${"Sumber".padStart(8)} | ${"Target (Awal)".padStart(14)}`);
  console.log("-".repeat(50));
  for (const t of RESEARCH_TABLES) {
    const s = beforeStats[t.name];
    console.log(`${t.name.padEnd(22)} | ${String(s.source).padStart(8)} | ${String(s.target).padStart(14)}`);
  }

  console.log("\n--- Tabel User-Level (HANYA DILAPORKAN, TIDAK DISALIN) ---");
  console.log(`${"Tabel".padEnd(22)} | ${"Sumber".padStart(8)} | ${"Target".padStart(14)}`);
  console.log("-".repeat(50));
  for (const name of USER_LEVEL_TABLES) {
    const s = userStats[name];
    console.log(`${name.padEnd(22)} | ${String(s.source).padStart(8)} | ${String(s.target).padStart(14)}`);
  }

  if (isDryRun) {
    console.log("\n>>> [DRY-RUN SELESAI] Tidak ada data yang disalin ke database target.");
    return { beforeStats, userStats, isDryRun: true };
  }

  // 2. Salin data per tabel riset secara batch
  console.log("\n>>> [2/3] Menyalin data riset ke target (insert-only, ON CONFLICT DO NOTHING)...");
  const copiedCounts: Record<string, number> = {};

  for (const tableSpec of RESEARCH_TABLES) {
    const tableName = tableSpec.name;
    const conflictKey = tableSpec.conflictKey;
    const srcCount = beforeStats[tableName].source;

    if (srcCount === 0) {
      console.log(`  - ${tableName}: 0 baris sumber, lewati.`);
      copiedCounts[tableName] = 0;
      continue;
    }

    const srcCols = await getColumns(sourceSql, tableName);
    const tgtCols = await getColumns(targetSql, tableName);
    const commonCols = srcCols.filter((c) => tgtCols.includes(c));

    if (commonCols.length === 0) {
      throw new Error(`Tidak ada kolom yang cocok untuk tabel ${tableName}`);
    }

    const quotedCols = commonCols.map((c) => `"${c}"`).join(", ");
    let offset = 0;
    let tableCopied = 0;

    while (offset < srcCount) {
      const selectQuery = `SELECT ${quotedCols} FROM "${tableName}" ORDER BY "${conflictKey}" ASC LIMIT ${BATCH_SIZE} OFFSET ${offset}`;
      const batchRows: any[] = await sourceSql.query(selectQuery);

      if (batchRows.length === 0) break;

      // Bentuk parameterized insert
      const valueTuples: string[] = [];
      const flatParams: any[] = [];
      let paramIdx = 1;

      for (const row of batchRows) {
        const placeholders: string[] = [];
        for (const col of commonCols) {
          placeholders.push(`$${paramIdx++}`);
          flatParams.push(serializeValue(row[col]));
        }
        valueTuples.push(`(${placeholders.join(", ")})`);
      }

      const insertQuery = `
        INSERT INTO "${tableName}" (${quotedCols})
        VALUES ${valueTuples.join(", ")}
        ON CONFLICT ("${conflictKey}") DO NOTHING;
      `;

      await targetSql.query(insertQuery, flatParams);
      tableCopied += batchRows.length;
      offset += batchRows.length;
    }

    copiedCounts[tableName] = tableCopied;
    console.log(`  - ${tableName}: diproses ${tableCopied} baris.`);
  }

  // 3. Verifikasi jumlah baris sesudah salin
  console.log("\n>>> [3/3] Menghitung baris sesudah migrasi data...");
  const afterStats: Record<string, { source: number; targetBefore: number; targetAfter: number }> = {};
  let allTargetGteSource = true;

  console.log("\n============================================================");
  console.log("                   HASIL VERIFIKASI AKHIR                   ");
  console.log("============================================================");
  console.log(
    `${"Tabel".padEnd(20)} | ${"Sumber".padStart(7)} | ${"Tgt Sblm".padStart(8)} | ${"Tgt Ssdh".padStart(8)} | ${"Status".padEnd(10)}`,
  );
  console.log("-".repeat(65));

  for (const t of RESEARCH_TABLES) {
    const src = beforeStats[t.name].source;
    const tgtBefore = beforeStats[t.name].target;
    const tgtAfter = await getRowCount(targetSql, t.name);
    afterStats[t.name] = { source: src, targetBefore: tgtBefore, targetAfter: tgtAfter };

    const ok = tgtAfter >= src;
    if (!ok) allTargetGteSource = false;
    const status = ok ? "OK" : "BELUM LENGKAP";

    console.log(
      `${t.name.padEnd(20)} | ${String(src).padStart(7)} | ${String(tgtBefore).padStart(8)} | ${String(tgtAfter).padStart(8)} | ${status.padEnd(10)}`,
    );
  }

  console.log("-".repeat(65));

  if (!allTargetGteSource) {
    throw new Error("Verifikasi gagal: terdapat tabel riset dengan target < sumber");
  }

  console.log("\n[SUKSES] Seluruh data riset berhasil disalin. Target >= Sumber untuk setiap tabel riset.");
  return { beforeStats, afterStats, userStats, isDryRun: false };
}

// Eksekusi CLI bila file dipanggil langsung
const isCli = import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`;
if (isCli) {
  const dryRun =
    process.argv.some((a) => a.includes("dry-run")) ||
    process.env.npm_config_dry_run === "true" ||
    Boolean(process.env.DRY_RUN);
  copyEngineData({ dryRun })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("\n[db:copy-engine] Gagal:", err);
      process.exit(1);
    });
}

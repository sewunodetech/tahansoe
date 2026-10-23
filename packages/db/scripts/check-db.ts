import "./env";
import fs from "node:fs";
import { neon } from "@neondatabase/serverless";
import { maskHost } from "./copy-engine-data";

function parseEnvKey(path: string, key: string): string | null {
  if (!fs.existsSync(path)) return null;
  const lines = fs.readFileSync(path, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith(`${key}=`)) {
      let val = trimmed.slice(`${key}=`.length).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      return val;
    }
  }
  return null;
}

async function check() {
  const webDbUrl = parseEnvKey("apps/web/.env", "DATABASE_URL");
  const engineDbUrl = parseEnvKey("apps/engine/.env", "DATABASE_URL");

  console.log("=== Host Verification ===");
  const webMasked = webDbUrl ? maskHost(webDbUrl) : "NOT_SET";
  const engineMasked = engineDbUrl ? maskHost(engineDbUrl) : "NOT_SET";
  const match = Boolean(webDbUrl && engineDbUrl && webDbUrl === engineDbUrl);

  console.log(`Web DB host    : ${webMasked}`);
  console.log(`Engine DB host : ${engineMasked}`);
  console.log(`Hosts match    : ${match ? "YES (Unified DB)" : "NO"}\n`);

  if (!match) {
    throw new Error("Web DB dan Engine DB tidak menunjuk ke host/database yang sama!");
  }

  const sql = neon(process.env.DATABASE_URL!);

  const usersCols = await sql`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name = 'users' ORDER BY ordinal_position;
  `;
  console.log("users:", usersCols.map((c: any) => `${c.column_name} (${c.data_type})`));

  const taCols = await sql`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name = 'telegram_accounts' ORDER BY ordinal_position;
  `;
  console.log("telegram_accounts:", taCols.map((c: any) => `${c.column_name} (${c.data_type})`));

  const researchTables = [
    "research_reports",
    "signals",
    "risk_assessments",
    "risk_settlements",
    "research_lessons",
    "price_samples",
    "rate_samples",
    "llm_usage_daily",
  ];
  console.log("\nResearch tables status:");
  for (const t of researchTables) {
    const r: any = await sql.query(`SELECT COUNT(*)::int as c FROM "${t}"`);
    console.log(`  ${t.padEnd(20)}: ${r[0]?.c ?? 0} rows`);
  }
}

check()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

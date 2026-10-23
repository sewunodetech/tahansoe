import "./env";
import { neon } from "@neondatabase/serverless";
import { runMigrations, type SqlExecutor } from "../src/migrate";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("[@tahansoe/db] DATABASE_URL belum diset di environment (ADR 0011: Postgres server saja).");
  }

  const sql = neon(url);
  const runner: SqlExecutor = {
    async query(statement: string, params: unknown[] = []) {
      const rows = await sql.query(statement, params as any[]);
      return { rows };
    },
    async exec(statement: string) {
      const commands = statement
        .split(";")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      for (const cmd of commands) {
        await sql.query(cmd);
      }
    },
  };

  await runMigrations(runner, { logger: (m) => console.log(m) });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[db:migrate] Migration failed:", err);
    process.exit(1);
  });

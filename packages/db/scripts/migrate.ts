import "./env";
import { runMigrationsOnNeon } from "../src/migrate";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("[@tahansoe/db] DATABASE_URL belum diset di environment (ADR 0011: Postgres server saja).");
  }
  await runMigrationsOnNeon(url, { logger: (m) => console.log(m) });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[db:migrate] Migration failed:", err);
    process.exit(1);
  });

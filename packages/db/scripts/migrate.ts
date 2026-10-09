import "./env";
import { getDbDriver, resolvePgliteDir } from "../src/client";
import { runMigrationsOnNeon, runMigrationsOnPglite } from "../src/migrate";
import { PGlite } from "@electric-sql/pglite";

async function main() {
  const driver = getDbDriver();
  console.log(`[db:migrate] Driver: ${driver}`);

  if (driver === "pglite") {
    const dir = resolvePgliteDir();
    console.log(`[db:migrate] PGlite directory: ${dir}\n`);
    const client = new PGlite(dir === "memory://" ? undefined : dir);
    await runMigrationsOnPglite(client, { logger: (m) => console.log(m) });
    await client.close();
  } else {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        "[@tahansoe/db] DATABASE_URL belum diset di environment untuk driver neon. " +
          "Set DATABASE_URL atau jalankan dengan DB_DRIVER=pglite untuk database lokal.",
      );
    }
    await runMigrationsOnNeon(url, { logger: (m) => console.log(m) });
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[db:migrate] Migration failed:", err);
    process.exit(1);
  });
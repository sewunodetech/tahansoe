import "./env";
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

async function fix() {
  console.log("Checking telegram_accounts table...");

  const cols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'telegram_accounts'
    ORDER BY ordinal_position;
  `;

  console.log("Existing columns:", cols.map((c: any) => c.column_name));

  if (cols.length === 0) {
    console.log("Table doesn't exist, creating...");
  } else {
    console.log("Dropping and recreating...");
    await sql`DROP TABLE IF EXISTS telegram_accounts CASCADE`;
  }

  await sql`
    CREATE TABLE telegram_accounts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      telegram_user_id BIGINT NOT NULL,
      telegram_username TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      linked_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS telegram_accounts_tguser_unique ON telegram_accounts (telegram_user_id);
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS telegram_accounts_user_idx ON telegram_accounts (user_id);
  `;

  console.log("telegram_accounts table fixed.");
}

fix()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fix failed:", err);
    process.exit(1);
  });
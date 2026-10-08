import "./env";
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

async function check() {
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
}

check()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
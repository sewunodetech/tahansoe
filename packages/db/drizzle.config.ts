// drizzle-kit dijalankan dari packages/db (npm run generate -w @tahansoe/db).
// Memakai .env yang sama dengan web app.
import { config } from "dotenv";
config({ path: "../../apps/web/.env.local", quiet: true });
config({ path: "../../apps/web/.env", quiet: true });
import type { Config } from "drizzle-kit";

export default {
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
} satisfies Config;
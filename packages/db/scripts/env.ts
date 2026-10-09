/**
 * Muat env untuk script DB dari file yang sama dengan web app (apps/web/.env),
 * lalu .env di root sebagai cadangan. Path relatif terhadap file ini, jadi
 * script bisa dijalankan dari direktori mana pun.
 */
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");

for (const file of [
  "apps/web/.env.local",
  "apps/web/.env",
  "apps/engine/.env",
  ".env",
]) {
  config({ path: resolve(repoRoot, file), quiet: true });
}

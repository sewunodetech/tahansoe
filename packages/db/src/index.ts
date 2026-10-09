/**
 * @tahansoe/db — satu-satunya sumber skema & koneksi Postgres (ADR 0007).
 * Hanya untuk kode server (route handler, engine, script); jangan di-import
 * dari komponen client.
 */
export {
  db,
  getDb,
  getDbDriver,
  resolvePgliteDir,
  ensureDb,
  resetDbClient,
  type Db,
  type DbDriver,
} from "./client";
export * from "./schema";
export * from "./research";
export * from "./migrate";

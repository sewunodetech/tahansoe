import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import type { PgDatabase } from "drizzle-orm/pg-core";

/**
 * Koneksi database Tahansoe: Postgres server (Neon) saja (ADR 0011, men-supersede
 * ADR 0010). `DATABASE_URL` wajib; tidak ada driver embedded/lokal lagi karena
 * engine berjalan multi-proses (`tahansoe start` + perintah CLI lain).
 */

/**
 * Tipe database kanonik yang diekspos ke pemanggil. Antarmuka umum Drizzle
 * Postgres agar route handler apps/web dan modul apps/engine memakai tipe sama.
 */
export type Db = PgDatabase<any, Record<string, never>, any>;

/** Instance nyata, dibuat sekali saat pertama dipakai (cache modul). */
let cached: Db | null = null;

/** True bila DATABASE_URL terisi (tanpa membuka koneksi). */
export function isDbConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.DATABASE_URL?.trim());
}

/**
 * Mengembalikan instance drizzle, membuatnya pada panggilan pertama (lazy init).
 * Melempar error jelas bila DATABASE_URL belum diset.
 */
export function getDb(): Db {
  if (cached) return cached;
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      "[@tahansoe/db] DATABASE_URL belum di-set. Engine memakai Postgres server (ADR 0011); " +
        "jalankan 'tahansoe setup' atau isi DATABASE_URL di apps/engine/.env.",
    );
  }
  cached = drizzleNeon({ client: neon(url) }) as unknown as Db;
  return cached;
}

/** Memastikan instance DB siap (kompatibilitas pemanggil lama). */
export async function ensureDb(): Promise<Db> {
  return getDb();
}

/** Mereset instance koneksi (khusus testing). */
export async function resetDbClient(): Promise<void> {
  cached = null;
}

/**
 * Proxy ber-API sama dengan instance drizzle. Setiap akses properti/metode
 * diteruskan ke `getDb()`, sehingga koneksi baru terbentuk saat pemakaian
 * pertama. Mempertahankan `import { db } from "@tahansoe/db"` dan tipe `Db`.
 */
export const db: Db = new Proxy({} as Db, {
  get(_target, prop, receiver) {
    const real = getDb() as unknown as Record<PropertyKey, unknown>;
    const value = Reflect.get(real, prop, receiver);
    return typeof value === "function" ? value.bind(real) : value;
  },
  has(_target, prop) {
    return prop in (getDb() as unknown as object);
  },
}) as Db;

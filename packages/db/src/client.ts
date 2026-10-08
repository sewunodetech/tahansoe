import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";

/**
 * Koneksi DB dibuat secara LAZY (ADR 0007 + diagnosa build).
 *
 * Sebelumnya `neon(process.env.DATABASE_URL!)` dieksekusi saat modul di-import,
 * sehingga `next build` gagal pada page-data collection ketika `DATABASE_URL`
 * tidak di-set. Sekarang klien Neon + drizzle baru dibuat saat `db` pertama kali
 * DIPAKAI (akses properti/metode), bukan saat modul di-import.
 *
 * API publik tidak berubah: `import { db } from "@tahansoe/db"` tetap bekerja dan
 * bertipe `NeonHttpDatabase` yang sama, sehingga route handler apps/web & engine
 * tidak perlu diubah. Error yang jelas hanya dilempar saat benar-benar dipakai
 * tanpa `DATABASE_URL`.
 */

/** Tipe database kanonik yang diekspos ke pemanggil. */
export type Db = NeonHttpDatabase<Record<string, never>>;

/** Instance nyata, dibuat sekali saat pertama dipakai (cache modul). */
let cached: Db | null = null;

/**
 * Mengembalikan instance drizzle, membuatnya pada panggilan pertama.
 * Melempar error yang jelas jika `DATABASE_URL` belum di-set — hanya saat
 * benar-benar dipakai, bukan saat modul di-import.
 */
export function getDb(): Db {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "[@tahansoe/db] DATABASE_URL belum di-set. Koneksi DB dibuat lazy; " +
        "set DATABASE_URL di environment server sebelum memakai `db`.",
    );
  }
  const sql = neon(url);
  cached = drizzle({ client: sql });
  return cached;
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

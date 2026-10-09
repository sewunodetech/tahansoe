import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { PGlite } from "@electric-sql/pglite";
import path from "node:path";
import fs from "node:fs";
import { runMigrationsOnPglite } from "./migrate";

/**
 * Pilihan driver database Tahansoe (ADR 0010):
 * - "neon": Postgres cloud via serverless HTTP driver (@neondatabase/serverless).
 *           Dipakai oleh apps/web, produksi, dan server.
 * - "pglite": Embedded Postgres (WASM) via @electric-sql/pglite.
 *             Dipakai untuk CLI lokal/offline tanpa perlu akun atau koneksi server.
 *
 * Pemilihan default:
 * Jika DB_DRIVER diset eksplisit ("neon" | "pglite"), pakai nilai itu.
 * Jika tidak diset: jika DATABASE_URL ada -> "neon", selain itu -> "pglite".
 */
export type DbDriver = "neon" | "pglite";

export function getDbDriver(): DbDriver {
  const envDriver = (process.env.DB_DRIVER ?? "").toLowerCase().trim();
  if (envDriver === "pglite") return "pglite";
  if (envDriver === "neon") return "neon";
  return process.env.DATABASE_URL ? "neon" : "pglite";
}

/**
 * Menyelesaikan lokasi direktori data PGlite secara cermat:
 * - Jika PGLITE_DATA_DIR diset, resolve terhadap process.cwd(). Nilai ":memory:"
 *   atau "memory://" mengaktifkan mode in-memory (berguna untuk test).
 * - Default: folder `apps/engine/.data/pglite` di dalam repositori.
 *   Fungsi mencari direktori root dengan memeriksa keberadaan `apps/engine`
 *   ke arah direktori induk (hingga 5 tingkat).
 */
export function resolvePgliteDir(env: NodeJS.ProcessEnv = process.env): string {
  const envDir = env.PGLITE_DATA_DIR?.trim();
  if (envDir) {
    if (envDir === ":memory:" || envDir.startsWith("memory://")) {
      return "memory://";
    }
    if (path.isAbsolute(envDir)) {
      return envDir;
    }
  }

  let repoRoot = process.cwd();
  let curr = process.cwd();
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(curr, "apps", "engine"))) {
      repoRoot = curr;
      break;
    }
    const parent = path.dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }

  if (envDir) {
    return path.resolve(repoRoot, envDir);
  }

  return path.resolve(repoRoot, "apps/engine/.data/pglite");
}

/**
 * Tipe database kanonik yang diekspos ke pemanggil (ADR 0010).
 * Menggunakan antarmuka umum Drizzle Postgres (PgDatabase) yang kompatibel
 * baik dengan NeonHttpDatabase maupun PgliteDatabase, sehingga route handler
 * apps/web dan modul apps/engine dapat melakukan select/insert/update/delete
 * secara identik tanpa perubahan tipe.
 */
export type Db = PgDatabase<any, Record<string, never>, any>;

/** Instance nyata, dibuat sekali saat pertama dipakai (cache modul). */
let cached: Db | null = null;
let pgliteInstance: PGlite | null = null;
let migrationPromise: Promise<void> | null = null;

/** Mengembalikan instance PGlite yang sedang aktif (jika driver pglite). */
export function getActivePglite(): PGlite | null {
  return pgliteInstance;
}

/**
 * Mengembalikan instance drizzle, membuatnya pada panggilan pertama (lazy init).
 * - Pada driver "neon": membaca DATABASE_URL, melempar error jika belum diset.
 * - Pada driver "pglite": membuat instance PGlite pada PGLITE_DATA_DIR dan
 *   menjalankan migrasi skema secara otomatis dan idempoten pada pemakaian pertama.
 */
export function getDb(): Db {
  if (cached) return cached;
  const driver = getDbDriver();

  if (driver === "pglite") {
    const dir = resolvePgliteDir();
    if (dir !== "memory://") {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch {
        /* abaikan */
      }
    }
    const client = new PGlite(dir === "memory://" ? undefined : dir);
    pgliteInstance = client;

    // Migrasi otomatis untuk PGlite pada pemakaian pertama (idempoten)
    migrationPromise = runMigrationsOnPglite(client, { quiet: true }).catch((err) => {
      console.error("[@tahansoe/db] PGlite auto-migration error:", err);
    });

    // Semua query lewat drizzle menunggu migrasi selesai dulu. Tanpa gerbang ini,
    // pemanggil getDb() (bukan ensureDb()) bisa query sebelum tabel dibuat pada
    // database PGlite yang masih baru. Migrasi sendiri memakai `client` mentah.
    const gate = migrationPromise;
    const gated = new Proxy(client, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value !== "function") return value;
        if (prop === "query" || prop === "exec" || prop === "transaction" || prop === "sql") {
          return async (...args: unknown[]) => {
            await gate;
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        }
        return value.bind(target);
      },
    });

    cached = drizzlePglite({ client: gated }) as unknown as Db;
    return cached;
  }

  // Driver "neon"
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "[@tahansoe/db] DATABASE_URL belum di-set untuk driver neon. " +
        "Set DATABASE_URL di environment atau set DB_DRIVER=pglite untuk database lokal.",
    );
  }
  const sql = neon(url);
  cached = drizzleNeon({ client: sql }) as unknown as Db;
  return cached;
}

/**
 * Memastikan koneksi DB dan migrasi (khusus pglite) selesai.
 * Berguna saat startup script atau test integrasi.
 */
export async function ensureDb(): Promise<Db> {
  const instance = getDb();
  if (migrationPromise) {
    await migrationPromise;
  }
  return instance;
}

/**
 * Mereset instance koneksi (khusus testing atau perpindahan driver di memori).
 */
export async function resetDbClient(): Promise<void> {
  if (migrationPromise) {
    try {
      await migrationPromise;
    } catch {
      // abaikan
    }
    migrationPromise = null;
  }
  if (pgliteInstance) {
    try {
      await pgliteInstance.close();
    } catch {
      // abaikan
    }
    pgliteInstance = null;
  }
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

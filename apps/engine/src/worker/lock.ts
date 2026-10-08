/**
 * Postgres advisory lock untuk memastikan single-instance research worker
 * (spec m2-engine-skeleton.md §3.2).
 *
 * Menggunakan pg_try_advisory_lock dengan key integer bernama.
 * Menghubungkan langsung ke Postgres session (menghindari -pooler transaction pooling)
 * agar lock tetap dipertahankan selama koneksi worker hidup.
 */

import { Client } from "@neondatabase/serverless";

/** Key advisory lock unik untuk research worker (Arbitrum One + research prefix). */
export const RESEARCH_WORKER_ADVISORY_LOCK_KEY = 42161001;

export interface AdvisoryLockClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
  end?(): Promise<void>;
}

/**
 * Konversi URL koneksi Neon pooler menjadi koneksi direct session mode
 * (menghilangkan "-pooler" dari hostname) agar session-level advisory lock bekerja.
 */
export function getDirectPostgresUrl(databaseUrl: string): string {
  try {
    const parsed = new URL(databaseUrl);
    if (parsed.host.includes("-pooler")) {
      parsed.host = parsed.host.replace("-pooler", "");
      return parsed.toString();
    }
    return databaseUrl;
  } catch {
    return databaseUrl;
  }
}

/**
 * Mencoba mengambil Postgres advisory lock (non-blocking).
 * Mengembalikan true jika lock berhasil didapatkan, false jika sudah dipegang instance lain.
 */
export async function acquireAdvisoryLock(
  client: AdvisoryLockClient,
  key: number = RESEARCH_WORKER_ADVISORY_LOCK_KEY,
): Promise<boolean> {
  const res = await client.query(
    `SELECT pg_try_advisory_lock(${key}) as locked;`,
  );
  const first = res.rows[0] as { locked?: boolean } | undefined;
  return Boolean(first?.locked);
}

/**
 * Melepaskan Postgres advisory lock.
 */
export async function releaseAdvisoryLock(
  client: AdvisoryLockClient,
  key: number = RESEARCH_WORKER_ADVISORY_LOCK_KEY,
): Promise<boolean> {
  try {
    const res = await client.query(
      `SELECT pg_advisory_unlock(${key}) as unlocked;`,
    );
    const first = res.rows[0] as { unlocked?: boolean } | undefined;
    return Boolean(first?.unlocked);
  } catch {
    return false;
  }
}

/**
 * Buat klien Neon WebSocket session-level yang terhubung ke direct host.
 */
export async function createNeonLockClient(
  databaseUrl: string,
): Promise<AdvisoryLockClient> {
  const directUrl = getDirectPostgresUrl(databaseUrl);
  const client = new Client(directUrl);
  await client.connect();
  return client;
}

/**
 * Postgres advisory lock untuk single-instance worker/scheduler (spec
 * m2-engine-skeleton.md §3.2) + ketahanan koneksi Neon (bug live scheduler).
 *
 * Memakai `pg_try_advisory_lock` session-level lewat koneksi DIRECT (bukan pooler)
 * agar lock bertahan selama koneksi hidup.
 *
 * KETAHANAN (cli-fix scheduler):
 *  - Buka koneksi dengan retry + backoff (WebSocket open ke host Neon direct bisa
 *    gagal sesaat, mis. compute suspended).
 *  - Unwrap ErrorEvent untuk logging (JANGAN pernah "[object ErrorEvent]" / connstring).
 *  - Pasang handler `error` pada setiap Client agar terminasi sisi server (mis.
 *    57P01 admin_shutdown) TIDAK menjadi unhandled exception; ditandai LOCK LOST.
 */

import { Client, neonConfig } from "@neondatabase/serverless";
import fs from "node:fs";
import path from "node:path";
import { getDbDriver, resolvePgliteDir } from "@tahansoe/db";

// Nonaktifkan coalesceWrites pada koneksi WebSocket agar write tidak dijadwalkan
// via setTimeout(..., 0) yang dapat melempar "Sent before connected" sebagai
// uncaughtException bila socket belum siap/menutup saat timer terpanggil.
neonConfig.coalesceWrites = false;

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
 * Ekstrak pesan error yang bersih dari apa pun — khususnya `ErrorEvent` dari
 * WebSocket (yang `String(...)`-nya "[object ErrorEvent]"). TIDAK pernah memuat
 * connection string. Mengembalikan string pendek + kode bila ada (mis. 57P01).
 */
export function unwrapError(err: unknown): string {
  if (err == null) return "unknown error";
  if (typeof err === "string") return err;
  const e = err as {
    message?: unknown;
    code?: unknown;
    error?: { message?: unknown; code?: unknown } | null;
    type?: unknown;
    reason?: unknown;
  };
  const parts: string[] = [];
  const msg =
    (typeof e.message === "string" && e.message) ||
    (e.error && typeof e.error.message === "string" && e.error.message) ||
    (typeof e.reason === "string" && e.reason) ||
    (typeof e.type === "string" && `event:${e.type}`) ||
    "";
  if (msg) parts.push(msg);
  const code =
    (typeof e.code === "string" && e.code) ||
    (e.error && typeof e.error.code === "string" && e.error.code) ||
    "";
  if (code) parts.push(`code=${code}`);
  if (parts.length === 0) {
    // Hindari "[object ErrorEvent]"; pakai nama konstruktor sebagai fallback.
    const name = (err as { constructor?: { name?: string } })?.constructor?.name;
    return name && name !== "Object" ? `${name} (no message)` : "unknown error";
  }
  return parts.join(" ");
}

/** Mencoba mengambil Postgres advisory lock (non-blocking). */
export async function acquireAdvisoryLock(
  client: AdvisoryLockClient,
  key: number = RESEARCH_WORKER_ADVISORY_LOCK_KEY,
): Promise<boolean> {
  const res = await client.query(`SELECT pg_try_advisory_lock(${key}) as locked;`);
  const first = res.rows[0] as { locked?: boolean } | undefined;
  return Boolean(first?.locked);
}

/** Melepaskan Postgres advisory lock. */
export async function releaseAdvisoryLock(
  client: AdvisoryLockClient,
  key: number = RESEARCH_WORKER_ADVISORY_LOCK_KEY,
): Promise<boolean> {
  try {
    const res = await client.query(`SELECT pg_advisory_unlock(${key}) as unlocked;`);
    const first = res.rows[0] as { unlocked?: boolean } | undefined;
    return Boolean(first?.unlocked);
  } catch {
    return false;
  }
}

export interface OpenLockOptions {
  /** Jumlah percobaan koneksi (default 5). */
  attempts?: number;
  /** Backoff dasar (ms) — dilipatduakan tiap percobaan (default 1000 → 1,2,4,8,16s). */
  baseBackoffMs?: number;
  /** Logger (default: stderr). */
  logger?: { warn: (m: string) => void; info?: (m: string) => void; error?: (m: string) => void };
  /** Sleep injectable (test). */
  sleep?: (ms: number) => Promise<void>;
  /** Dipanggil saat Client meng-emit error setelah connect (LOCK LOST). */
  onError?: (message: string) => void;
  /**
   * Factory client injectable (test). Default: `new Client(directUrl)` dari
   * @neondatabase/serverless. Harus mengekspos connect/end/on/query.
   */
  makeClient?: (directUrl: string) => LockPgClient;
  /** Driver database ("neon" | "pglite"). Jika tidak dispesifikasikan, ditentukan via getDbDriver(). */
  driver?: "neon" | "pglite";
  /** Direktori penyimpanan file lock PGlite. Default: resolvePgliteDir(). */
  dataDir?: string;
  /** Batas waktu stale lock PGlite (ms). Default: 120_000 (2 menit). */
  staleTimeoutMs?: number;
  /** Interval update heartbeat PGlite (ms). Default: 15_000. */
  heartbeatIntervalMs?: number;
  /** PID proses yang memegang lock (injectable untuk test). Default: process.pid. */
  pid?: number;
}

/** Antarmuka minimal client pg/neon yang dipakai lock (memudahkan test). */
export interface LockPgClient extends AdvisoryLockClient {
  connect(): Promise<void>;
  on(event: "error", handler: (err: unknown) => void): void;
  end(): Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Buka koneksi dengan RETRY + BACKOFF memakai factory client injectable. Memasang
 * handler `error` SEBELUM connect agar error async tidak unhandled. Melempar error
 * TERAKHIR (unwrapped) bila semua percobaan gagal. Pure terhadap I/O (via factory).
 */
export async function connectWithRetry(
  directUrl: string,
  opts: OpenLockOptions = {},
): Promise<LockPgClient> {
  const attempts = Math.max(1, opts.attempts ?? 5);
  const baseBackoffMs = opts.baseBackoffMs ?? 1000;
  const sleep = opts.sleep ?? defaultSleep;
  const warn = opts.logger?.warn ?? ((m: string) => process.stderr.write(`[lock] ${m}\n`));
  const makeClient = opts.makeClient ?? ((url: string) => new Client(url) as unknown as LockPgClient);

  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    const client = makeClient(directUrl);
    client.on("error", (err: unknown) => {
      const message = unwrapError(err);
      if (opts.onError) opts.onError(message);
      else warn(`client error (abaikan, lock mungkin hilang): ${message}`);
    });
    try {
      await client.connect();
      return client;
    } catch (err) {
      lastErr = err;
      try {
        await client.end();
      } catch {
        /* abaikan */
      }
      const isLast = i === attempts - 1;
      const backoff = baseBackoffMs * 2 ** i;
      warn(
        `gagal membuka koneksi lock (percobaan ${i + 1}/${attempts}): ${unwrapError(err)}` +
          (isLast ? " — menyerah." : ` — coba lagi dalam ${Math.round(backoff / 1000)}s.`),
      );
      if (!isLast) await sleep(backoff);
    }
  }
  throw new Error(`gagal membuka koneksi lock setelah ${attempts} percobaan: ${unwrapError(lastErr)}`);
}

/**
 * Buat klien Neon session-level DIRECT dengan RETRY + BACKOFF dan handler error.
 * Melempar error TERAKHIR (sudah di-unwrap) bila semua percobaan gagal.
 *
 * `onError` dipanggil jika Client meng-emit `error` SETELAH connect (mis. 57P01) —
 * ini mencegah unhandled exception; pemanggil memperlakukannya sebagai lock lost.
 */
export async function createNeonLockClient(
  databaseUrl: string,
  opts: OpenLockOptions = {},
): Promise<AdvisoryLockClient> {
  const directUrl = getDirectPostgresUrl(databaseUrl);
  return connectWithRetry(directUrl, opts);
}

/** Wrapper lock dengan status hidup + reacquire (dipakai scheduler ticker). */
export interface AdvisoryLock {
  acquired: boolean;
  /** True bila koneksi hilang (error 57P01 dsb.) sejak lock diambil. */
  isLost: () => boolean;
  /** Lepas lock + tutup koneksi (no-throw). */
  release: () => Promise<void>;
}

export interface PgliteLockOptions {
  dataDir?: string;
  staleTimeoutMs?: number;
  heartbeatIntervalMs?: number;
  logger?: { warn: (m: string) => void; info?: (m: string) => void; error?: (m: string) => void };
  pid?: number;
}

export interface LockFileData {
  pid: number;
  acquiredAt: string;
  heartbeatAt: string;
  key: number;
}

function isProcessAlive(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    const e = err as { code?: string };
    return e?.code === "EPERM";
  }
}

/**
 * Buka file-based advisory lock untuk driver PGlite di PGLITE_DATA_DIR (ADR 0010 §3).
 * Menulis `lock-${key}.json` dengan PID dan heartbeat timestamp.
 * Stale jika heartbeat > 2 menit atau PID proses sudah mati.
 */
export async function openPgliteFileLock(
  key: number,
  opts: PgliteLockOptions = {},
): Promise<AdvisoryLock> {
  const dataDir = opts.dataDir ?? resolvePgliteDir();
  try {
    fs.mkdirSync(dataDir, { recursive: true });
  } catch {
    /* abaikan jika direktori sudah ada */
  }

  const lockPath = path.join(dataDir, `lock-${key}.json`);
  const myPid = opts.pid ?? process.pid;
  const staleTimeoutMs = opts.staleTimeoutMs ?? 120_000;
  const nowIso = new Date().toISOString();
  const payload: LockFileData = {
    pid: myPid,
    acquiredAt: nowIso,
    heartbeatAt: nowIso,
    key,
  };
  const payloadStr = JSON.stringify(payload, null, 2);

  let acquired = false;
  try {
    fs.writeFileSync(lockPath, payloadStr, { flag: "wx" });
    acquired = true;
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e?.code === "EEXIST") {
      let isStale = false;
      let existingData: LockFileData | null = null;
      try {
        const content = fs.readFileSync(lockPath, "utf-8");
        existingData = JSON.parse(content);
      } catch {
        isStale = true;
      }

      if (existingData) {
        const heartbeatTime = new Date(existingData.heartbeatAt).getTime();
        const ageMs = Date.now() - heartbeatTime;
        const dead = typeof existingData.pid === "number" && !isProcessAlive(existingData.pid);
        if (dead || ageMs > staleTimeoutMs) {
          isStale = true;
          opts.logger?.warn?.(
            `stale lock file ${lockPath} terdeteksi (pid=${existingData.pid}, dead=${dead}, age=${Math.round(ageMs / 1000)}s) — mengambil alih lock.`,
          );
        }
      }

      if (isStale) {
        try {
          fs.unlinkSync(lockPath);
        } catch {
          /* abaikan */
        }
        try {
          fs.writeFileSync(lockPath, payloadStr, { flag: "wx" });
          acquired = true;
        } catch {
          acquired = false;
        }
      }
    }
  }

  if (!acquired) {
    return {
      acquired: false,
      isLost: () => false,
      release: async () => {},
    };
  }

  const intervalMs = opts.heartbeatIntervalMs ?? 15_000;
  const heartbeatTimer = setInterval(() => {
    try {
      if (fs.existsSync(lockPath)) {
        const content = fs.readFileSync(lockPath, "utf-8");
        const current = JSON.parse(content);
        if (current.pid === myPid && current.key === key) {
          current.heartbeatAt = new Date().toISOString();
          fs.writeFileSync(lockPath, JSON.stringify(current, null, 2));
        }
      }
    } catch {
      /* abaikan error write heartbeat */
    }
  }, intervalMs);
  heartbeatTimer.unref();

  const onExit = () => {
    try {
      if (fs.existsSync(lockPath)) {
        const content = fs.readFileSync(lockPath, "utf-8");
        const current = JSON.parse(content);
        if (current.pid === myPid && current.key === key) {
          fs.unlinkSync(lockPath);
        }
      }
    } catch {
      /* abaikan */
    }
  };
  process.once("exit", onExit);

  return {
    acquired: true,
    isLost: () => false,
    release: async () => {
      clearInterval(heartbeatTimer);
      process.removeListener("exit", onExit);
      try {
        if (fs.existsSync(lockPath)) {
          const content = await fs.promises.readFile(lockPath, "utf-8");
          const current = JSON.parse(content);
          if (current.pid === myPid && current.key === key) {
            await fs.promises.unlink(lockPath);
          }
        }
      } catch {
        /* abaikan */
      }
    },
  };
}

/**
 * Buat client PGlite yang kompatibel dengan AdvisoryLockClient.
 * Mengintersep query `SELECT pg_try_advisory_lock(${key})` dan `SELECT pg_advisory_unlock(${key})`
 * menggunakan file-based lock di PGLITE_DATA_DIR.
 */
export function createPgliteLockClient(dataDir?: string): AdvisoryLockClient {
  const heldLocks = new Map<number, AdvisoryLock>();
  return {
    async query(sql: string, _params?: unknown[]): Promise<{ rows: any[] }> {
      const tryMatch = sql.match(/pg_try_advisory_lock\s*\(\s*(\d+)\s*\)/i);
      if (tryMatch) {
        const key = parseInt(tryMatch[1]!, 10);
        const lock = await openPgliteFileLock(key, { dataDir });
        if (lock.acquired) {
          heldLocks.set(key, lock);
          return { rows: [{ locked: true }] };
        }
        return { rows: [{ locked: false }] };
      }
      const unlockMatch = sql.match(/pg_advisory_unlock\s*\(\s*(\d+)\s*\)/i);
      if (unlockMatch) {
        const key = parseInt(unlockMatch[1]!, 10);
        const lock = heldLocks.get(key);
        if (lock) {
          await lock.release();
          heldLocks.delete(key);
          return { rows: [{ unlocked: true }] };
        }
        return { rows: [{ unlocked: false }] };
      }
      return { rows: [] };
    },
    async end(): Promise<void> {
      for (const [_key, lock] of heldLocks.entries()) {
        try {
          await lock.release();
        } catch {
          /* abaikan */
        }
      }
      heldLocks.clear();
    },
  };
}

/**
 * Buka koneksi (retry) lalu coba ambil advisory lock.
 * Jika driver PGlite, memakai file lock di PGLITE_DATA_DIR.
 * Error server-side setelah ini menandai `isLost()` true (bukan crash).
 */
export async function openAdvisoryLock(
  databaseUrl: string | undefined,
  key: number,
  opts: OpenLockOptions = {},
): Promise<AdvisoryLock> {
  const driver =
    opts.driver ??
    (databaseUrl && process.env.DB_DRIVER !== "pglite" ? "neon" : getDbDriver());
  if (driver === "pglite") {
    return openPgliteFileLock(key, {
      dataDir: opts.dataDir,
      staleTimeoutMs: opts.staleTimeoutMs,
      heartbeatIntervalMs: opts.heartbeatIntervalMs,
      logger: opts.logger,
      pid: opts.pid,
    });
  }

  if (!databaseUrl) {
    return {
      acquired: false,
      isLost: () => false,
      release: async () => {},
    };
  }

  let lost = false;
  const client = await createNeonLockClient(databaseUrl, {
    ...opts,
    onError: (message) => {
      lost = true;
      (opts.logger?.warn ?? ((m: string) => process.stderr.write(`[lock] ${m}\n`)))(
        `koneksi lock hilang: ${message} — akan dicoba ulang pada tick berikutnya.`,
      );
    },
  });
  let acquired = false;
  try {
    acquired = await acquireAdvisoryLock(client, key);
  } catch (err) {
    (opts.logger?.warn ?? ((m: string) => process.stderr.write(`[lock] ${m}\n`)))(
      `gagal pg_try_advisory_lock: ${unwrapError(err)}`,
    );
  }
  return {
    acquired,
    isLost: () => lost,
    release: async () => {
      try {
        if (acquired && !lost) await releaseAdvisoryLock(client, key);
        await client.end?.();
      } catch {
        /* abaikan */
      }
    },
  };
}

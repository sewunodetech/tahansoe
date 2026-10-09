/**
 * Lock Eksklusif Poller Telegram Bot (Single Poller Per Bot).
 *
 * Mencegah beberapa proses (mis. gateway pair ganda atau start bersamaan)
 * melakukan getUpdates secara simultan ke satu bot Telegram.
 *
 * File lock: gateway-<sha256(token) first 12 hex>.lock di direktori data.
 * Memuat: { pid, createdAt, updatedAt }
 * Heartbeat: diperbarui tiap 15 detik, dianggap usang (stale) setelah 60 detik
 * atau jika proses pemegang sudah mati.
 * Dilepas otomatis saat stop(), exit, SIGINT, SIGTERM, atau uncaughtException.
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { defaultDataDir } from "./state.ts";

export const LOCK_STALE_MS = 60_000; // 60 detik
export const LOCK_HEARTBEAT_MS = 15_000; // 15 detik

const activeLocksInProcess = new Set<string>();

/** Helper test untuk membersihkan lock internal proses. */
export function clearActiveLocksInProcessForTests(): void {
  activeLocksInProcess.clear();
}

export interface LockRecord {
  pid: number;
  createdAt: number;
  updatedAt: number;
}

export interface AcquireLockOptions {
  token: string;
  lockDir?: string;
  statePath?: string;
  logger?: (msg: string) => void;
  now?: () => number;
}

export interface AcquireLockResult {
  acquired: boolean;
  holderPid?: number;
  lockPath: string;
  release: () => void;
}

/**
 * Hasilkan nama file lock berdasarkan SHA-256 token bot (12 hex pertama).
 */
export function botLockFilename(token: string): string {
  const hash = createHash("sha256").update(token.trim()).digest("hex").slice(0, 12);
  return `gateway-${hash}.lock`;
}

/**
 * Periksa apakah sebuah PID proses sistem masih aktif.
 */
export function isPidAlive(pid: number): boolean {
  if (typeof pid !== "number" || isNaN(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err?.code === "EPERM";
  }
}

/**
 * Dapatkan direktori penyimpanan lock.
 */
export function resolveLockDir(options: { lockDir?: string; statePath?: string }): string {
  if (options.lockDir) return options.lockDir;
  if (options.statePath) return dirname(options.statePath);
  return defaultDataDir();
}

/**
 * Dapatkan atau perbarui lock eksklusif untuk bot tertentu.
 */
export function acquireBotLock(options: AcquireLockOptions): AcquireLockResult {
  const token = options.token.trim();
  const getNow = options.now ?? (() => Date.now());
  const now = getNow();
  const dir = resolveLockDir(options);
  mkdirSync(dir, { recursive: true });

  const lockFile = botLockFilename(token);
  const lockPath = join(dir, lockFile);
  const normPath = resolve(lockPath);

  // 0. Cek apakah lock sudah dipegang oleh instance lain di proses yang sama
  if (activeLocksInProcess.has(normPath)) {
    return {
      acquired: false,
      holderPid: process.pid,
      lockPath: normPath,
      release: () => {},
    };
  }

  // 1. Cek lock yang sudah ada
  let existing: LockRecord | null = null;
  try {
    const raw = readFileSync(lockPath, "utf8");
    existing = JSON.parse(raw) as LockRecord;
  } catch {
    existing = null;
  }

  if (existing && typeof existing.pid === "number") {
    const isCurrentProcess = existing.pid === process.pid;
    const isStaleTime = now - existing.updatedAt >= LOCK_STALE_MS;
    const isProcessDead = !isPidAlive(existing.pid);

    if (!isCurrentProcess && !isStaleTime && !isProcessDead) {
      // Lock dipegang oleh proses lain yang masih aktif
      return {
        acquired: false,
        holderPid: existing.pid,
        lockPath: normPath,
        release: () => {},
      };
    }
  }

  // 2. Tulis data lock untuk proses saat ini
  const record: LockRecord = {
    pid: process.pid,
    createdAt: now,
    updatedAt: now,
  };

  try {
    writeFileSync(lockPath, JSON.stringify(record, null, 2) + "\n", "utf8");
    activeLocksInProcess.add(normPath);
  } catch (err) {
    options.logger?.(`[Lock] Failed to write lock file ${lockPath}: ${String(err)}`);
    return {
      acquired: false,
      lockPath: normPath,
      release: () => {},
    };
  }

  // 3. Pasang heartbeat timer tiap 15 detik
  let released = false;
  const heartbeatTimer = setInterval(() => {
    if (released) return;
    try {
      record.updatedAt = getNow();
      writeFileSync(lockPath, JSON.stringify(record, null, 2) + "\n", "utf8");
    } catch {
      // Abaikan error saat menulis heartbeat
    }
  }, LOCK_HEARTBEAT_MS);

  if (typeof heartbeatTimer.unref === "function") {
    heartbeatTimer.unref();
  }

  // 4. Fungsi pelepasan lock
  const doRelease = () => {
    if (released) return;
    released = true;
    activeLocksInProcess.delete(normPath);
    clearInterval(heartbeatTimer);

    try {
      const cur = JSON.parse(readFileSync(lockPath, "utf8")) as LockRecord;
      if (cur.pid === process.pid) {
        unlinkSync(lockPath);
      }
    } catch {
      // Abaikan jika file sudah tidak ada
    }
  };

  // 5. Daftarkan handler shutdown bersih
  const onProcessExit = () => doRelease();
  process.once("exit", onProcessExit);
  process.once("SIGINT", onProcessExit);
  process.once("SIGTERM", onProcessExit);
  process.once("uncaughtExceptionMonitor", onProcessExit);

  const release = () => {
    process.removeListener("exit", onProcessExit);
    process.removeListener("SIGINT", onProcessExit);
    process.removeListener("SIGTERM", onProcessExit);
    process.removeListener("uncaughtExceptionMonitor", onProcessExit);
    doRelease();
  };

  return {
    acquired: true,
    holderPid: process.pid,
    lockPath,
    release,
  };
}

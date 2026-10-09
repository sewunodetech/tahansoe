/**
 * Test PGlite file-based advisory lock (ADR 0010 §3).
 * Menguji:
 * - Akuisisi lock berhasil dan membuat lock-${key}.json
 * - Kontensi lock: proses/instance kedua ditolak (acquired = false)
 * - Pelepasan lock: file dihapus dan lock bisa diambil kembali
 * - Stale takeover bila heartbeat kadaluarsa (> 2 menit)
 * - Stale takeover bila PID pemilik lock sudah mati
 * - createPgliteLockClient shim query SELECT pg_try_advisory_lock & pg_advisory_unlock
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  openPgliteFileLock,
  createPgliteLockClient,
  openAdvisoryLock,
} from "../../src/worker/lock.ts";

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tahansoe-lock-test-"));
}

test("PGlite file lock: acquire, contention, release, and reacquire", async () => {
  const dir = createTempDir();
  const key = 42161001;
  const lockFile = path.join(dir, `lock-${key}.json`);

  try {
    // 1. Akuisisi pertama sukses
    const lock1 = await openPgliteFileLock(key, { dataDir: dir });
    assert.equal(lock1.acquired, true);
    assert.equal(fs.existsSync(lockFile), true, "lock file harus terbuat");

    const content = JSON.parse(fs.readFileSync(lockFile, "utf-8"));
    assert.equal(content.key, key);
    assert.equal(content.pid, process.pid);
    assert.ok(content.acquiredAt);
    assert.ok(content.heartbeatAt);

    // 2. Kontensi: akuisisi kedua pada key yang sama harus ditolak
    const lock2 = await openPgliteFileLock(key, { dataDir: dir });
    assert.equal(lock2.acquired, false, "harus ditolak saat lock dipegang");

    // 3. Lepaskan lock pertama
    await lock1.release();
    assert.equal(fs.existsSync(lockFile), false, "lock file harus dihapus saat release");

    // 4. Re-acquire: setelah dilepas, lock bisa diambil lagi
    const lock3 = await openPgliteFileLock(key, { dataDir: dir });
    assert.equal(lock3.acquired, true, "bisa diambil kembali setelah release");
    await lock3.release();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("PGlite file lock: takeover stale lock jika heartbeat kadaluarsa (> staleTimeoutMs)", async () => {
  const dir = createTempDir();
  const key = 42161002;
  const lockFile = path.join(dir, `lock-${key}.json`);

  try {
    // Buat lock file usang (heartbeat 5 menit yang lalu)
    const stalePayload = {
      pid: process.pid,
      acquiredAt: new Date(Date.now() - 300_000).toISOString(),
      heartbeatAt: new Date(Date.now() - 300_000).toISOString(),
      key,
    };
    fs.writeFileSync(lockFile, JSON.stringify(stalePayload));

    let warned = false;
    const lock = await openPgliteFileLock(key, {
      dataDir: dir,
      staleTimeoutMs: 120_000,
      logger: { warn: () => { warned = true; } },
    });

    assert.equal(lock.acquired, true, "stale lock harus diambil alih");
    assert.equal(warned, true, "harus mencatat peringatan stale lock");

    const content = JSON.parse(fs.readFileSync(lockFile, "utf-8"));
    assert.ok(new Date(content.heartbeatAt).getTime() > Date.now() - 5000);

    await lock.release();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("PGlite file lock: takeover stale lock jika PID sudah mati", async () => {
  const dir = createTempDir();
  const key = 42161003;
  const lockFile = path.join(dir, `lock-${key}.json`);

  try {
    // PID tidak valid / mati dengan heartbeat yang masih baru
    const deadPid = 99999999;
    const payload = {
      pid: deadPid,
      acquiredAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
      key,
    };
    fs.writeFileSync(lockFile, JSON.stringify(payload));

    let warned = false;
    const lock = await openPgliteFileLock(key, {
      dataDir: dir,
      staleTimeoutMs: 120_000,
      logger: { warn: () => { warned = true; } },
    });

    assert.equal(lock.acquired, true, "dead PID lock harus diambil alih");
    assert.equal(warned, true, "harus mencatat peringatan takeover");

    await lock.release();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("createPgliteLockClient: query shimming untuk AdvisoryLockClient", async () => {
  const dir = createTempDir();
  const client1 = createPgliteLockClient(dir);
  const client2 = createPgliteLockClient(dir);
  const key = 42161004;

  try {
    // 1. Client 1 acquire
    const r1 = await client1.query(`SELECT pg_try_advisory_lock(${key}) as locked;`);
    assert.deepEqual(r1.rows, [{ locked: true }]);

    // 2. Client 2 mencoba acquire key yang sama -> gagal
    const r2 = await client2.query(`SELECT pg_try_advisory_lock(${key}) as locked;`);
    assert.deepEqual(r2.rows, [{ locked: false }]);

    // 3. Client 1 release
    const r3 = await client1.query(`SELECT pg_advisory_unlock(${key}) as unlocked;`);
    assert.deepEqual(r3.rows, [{ unlocked: true }]);

    // 4. Client 2 sekarang bisa acquire
    const r4 = await client2.query(`SELECT pg_try_advisory_lock(${key}) as locked;`);
    assert.deepEqual(r4.rows, [{ locked: true }]);

    // 5. Cleanup via end()
    await client2.end?.();
    const lockFile = path.join(dir, `lock-${key}.json`);
    assert.equal(fs.existsSync(lockFile), false, "end() harus melepas semua lock");
  } finally {
    await client1.end?.();
    await client2.end?.();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("openAdvisoryLock: driver pglite dispatches ke file lock", async () => {
  const dir = createTempDir();
  const key = 42161005;

  try {
    const lock = await openAdvisoryLock(undefined, key, {
      driver: "pglite",
      dataDir: dir,
    });
    assert.equal(lock.acquired, true);
    assert.equal(lock.isLost(), false);
    await lock.release();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

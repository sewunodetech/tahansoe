/**
 * Unit test gateway runtime state persistence & dedupe logic.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  loadGatewayState,
  saveGatewayState,
  saveGatewayStateSync,
  defaultStatePath,
  defaultRealStatePath,
  isTestEnvironment,
  isAlertDeduped,
  recordSentAlert,
  getDailyQaCount,
  incrementDailyQaCount,
  recordFailedPairingAttempt,
  getFailedPairingAttemptsCount,
  createEmptyGatewayState,
} from "../../src/gateway/core/state.ts";

test("state: loadGatewayState pada file tidak ada menghasilkan state kosong aman", async () => {
  const state = await loadGatewayState("/path/does/not/exist/gateway-state.json");
  assert.deepEqual(state.sentAlerts, {});
  assert.deepEqual(state.qaCounters, {});
  assert.equal(state.offset, undefined);
});

test("state: penulisan atomik & pembacaan ulang state ke disk", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "tahansoe-state-"));
  const statePath = join(tmp, "gateway-state.json");

  const state = createEmptyGatewayState();
  state.offset = 42;
  recordSentAlert(state, "alert:test:1", 0.8, 1000000);
  incrementDailyQaCount(state, "chat_123", "2026-10-09");

  await saveGatewayState(state, statePath);

  const reloaded = await loadGatewayState(statePath);
  assert.equal(reloaded.offset, 42);
  assert.equal(reloaded.sentAlerts["alert:test:1"]?.severity, 0.8);
  assert.equal(getDailyQaCount(reloaded, "chat_123", "2026-10-09"), 1);

  await rm(tmp, { recursive: true, force: true });
});

test("state: logika dedupe 6 jam dan penembusan severity naik", () => {
  const state = createEmptyGatewayState();
  const baseTime = 1000000;

  // Rekam alert pada baseTime dengan severity 0.5
  recordSentAlert(state, "sig:test", 0.5, baseTime);

  // 1 jam kemudian dengan severity sama -> deduped (true)
  assert.equal(isAlertDeduped(state, "sig:test", 0.5, baseTime + 3600000), true);

  // 1 jam kemudian dengan severity lebih rendah -> deduped (true)
  assert.equal(isAlertDeduped(state, "sig:test", 0.3, baseTime + 3600000), true);

  // 1 jam kemudian dengan severity NAIK -> NOT deduped (false, boleh dikirim)
  assert.equal(isAlertDeduped(state, "sig:test", 0.7, baseTime + 3600000), false);

  // 7 jam kemudian (melewati 6 jam) -> NOT deduped (false, jendela dedupe berakhir)
  assert.equal(isAlertDeduped(state, "sig:test", 0.5, baseTime + 7 * 3600000), false);
});

test("state: hitungan percobaan pairing gagal per jam", () => {
  const state = createEmptyGatewayState();
  const now = 5000000;

  assert.equal(getFailedPairingAttemptsCount(state, "chat_x", now), 0);
  recordFailedPairingAttempt(state, "chat_x", now);
  recordFailedPairingAttempt(state, "chat_x", now + 1000);
  assert.equal(getFailedPairingAttemptsCount(state, "chat_x", now + 2000), 2);

  // Percobaan 2 jam kemudian tidak dihitung lagi
  const twoHoursLater = now + 2 * 3600000;
  assert.equal(getFailedPairingAttemptsCount(state, "chat_x", twoHoursLater), 0);
});

test("state: proteksi isolasi test — defaultStatePath dan penulisan ke path produksi dicegah dalam test", async () => {
  assert.equal(isTestEnvironment(), true, "Lingkungan test harus terdeteksi");

  // 1. defaultStatePath() harus melempar error di lingkungan test
  assert.throws(
    () => defaultStatePath(),
    /Test pollution guard: defaultStatePath\(\) called in test environment/,
  );

  // 2. saveGatewayState ke path produksi asli harus melempar error di lingkungan test
  const realProdPath = defaultRealStatePath();
  const state = createEmptyGatewayState();
  await assert.rejects(
    async () => saveGatewayState(state, realProdPath),
    /Test pollution guard: Attempted to access\/write production state path/,
  );

  assert.throws(
    () => saveGatewayStateSync(state, realProdPath),
    /Test pollution guard: Attempted to access\/write production state path/,
  );

  // (Isi file produksi sengaja TIDAK diperiksa: file itu berisi state runtime nyata
  //  milik user, mis. kode pairing yang sedang menunggu. Guard di atas sudah menjamin
  //  test tidak bisa menulis ke sana.)
});

test("state: simpanan daemon (memori basi) TIDAK menghapus kode pairing yang dibuat CLI", async () => {
  const { createPairingCode, pairingStatus, PairingManager } = await import("../../src/gateway/pairing.ts");
  const dir = await mkdtemp(join(tmpdir(), "tahansoe-pair-race-"));
  const path = join(dir, "gateway-state.json");
  try {
    // Daemon start: memuat state (belum ada kode).
    const daemonState = await loadGatewayState(path);
    await saveGatewayState(daemonState, path);

    // CLI `gateway pair` (proses lain) menulis kode langsung ke disk.
    const { code } = createPairingCode("telegram", path);
    assert.equal(pairingStatus(code, path).status, "pending");

    // Update Telegram masuk → daemon menyimpan state memorinya (offset baru)
    // sebelum sempat memuat ulang kode (long-poll 50 detik).
    daemonState.offset = 123;
    await saveGatewayState(daemonState, path);

    assert.equal(pairingStatus(code, path).status, "pending", "kode CLI harus tetap ada di disk");
    assert.ok(Object.keys(daemonState.pendingPairings ?? {}).length === 1, "memori daemon ikut memuat kode");

    // `/start <kode>` dari user berhasil.
    const pm = new PairingManager(path, daemonState);
    const res = await pm.handlePairingAttempt(code, "42", daemonState);
    assert.equal(res.ok, true);
    assert.equal(pairingStatus(code, path).status, "paired");
    assert.equal((await loadGatewayState(path)).offset, 123);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("state: simpanan memori basi tidak menurunkan status paired / menghapus percobaan gagal di disk", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tahansoe-pair-merge-"));
  const path = join(dir, "gateway-state.json");
  try {
    const stale = createEmptyGatewayState();
    stale.pendingPairings = {
      h1: { codeHash: "h1", channel: "telegram", expiresAt: Date.now() + 60_000, attempts: 0, paired: false },
    };
    const disk = createEmptyGatewayState();
    disk.pendingPairings = {
      h1: { codeHash: "h1", channel: "telegram", expiresAt: Date.now() + 60_000, attempts: 0, paired: true, chatId: "7" },
    };
    disk.failedPairingAttempts = { "9": [1000] };
    saveGatewayStateSync(disk, path);

    stale.failedPairingAttempts = { "9": [2000] };
    saveGatewayStateSync(stale, path);
    const after = await loadGatewayState(path);
    assert.equal(after.pendingPairings?.h1?.paired, true);
    assert.deepEqual(after.failedPairingAttempts["9"], [1000, 2000]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

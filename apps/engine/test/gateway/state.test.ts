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

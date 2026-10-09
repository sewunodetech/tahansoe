/**
 * Unit test Pairing Manager (spec §3.5, §6, §7).
 *
 * Menguji:
 *  - Pembuatan kode pairing acak (>= 8 karakter, expires in 10 min)
 *  - Status pairing (pending -> paired -> expired)
 *  - Batasan maksimal 5 percobaan gagal per chat per jam
 *  - Keberhasilan pairing memicu callback penambahan chat ke allowlist
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { PairingManager, PAIRING_EXPIRY_MS } from "../../src/gateway/pairing.ts";
import { createEmptyGatewayState } from "../../src/gateway/core/state.ts";

test("pairing: createPairingCode menghasilkan kode >= 8 karakter dan expired dalam 10 menit", () => {
  const pm = new PairingManager();
  const { code, expiresAt } = pm.createPairingCode("telegram");

  assert.ok(code.length >= 8, `Code length ${code.length} should be >= 8`);
  const now = Date.now();
  const diff = expiresAt.getTime() - now;
  assert.ok(diff > 9 * 60 * 1000 && diff <= PAIRING_EXPIRY_MS + 1000);

  // Status awal harus pending
  const status = pm.pairingStatus(code);
  assert.equal(status.status, "pending");
});

test("pairing: handlePairingAttempt sukses menandai paired dan memanggil callback", async () => {
  const pm = new PairingManager();
  const state = createEmptyGatewayState();
  const { code } = pm.createPairingCode("telegram");

  const pairedChats: string[] = [];
  const res = await pm.handlePairingAttempt(code, "chat_12345", state, async (chatId) => {
    pairedChats.push(chatId);
  });

  assert.equal(res.ok, true);
  assert.deepEqual(pairedChats, ["chat_12345"]);

  const status = pm.pairingStatus(code);
  assert.equal(status.status, "paired");
  assert.equal(status.chatId, "chat_12345");
});

test("pairing: kode salah dicatat sebagai percobaan gagal dan ditolak", async () => {
  const pm = new PairingManager();
  const state = createEmptyGatewayState();
  pm.createPairingCode("telegram");

  const res = await pm.handlePairingAttempt("WRONG_CODE", "chat_attacker", state, async () => {});

  assert.equal(res.ok, false);
  assert.match(res.error!, /invalid or has expired/i);
  assert.equal(state.failedPairingAttempts["chat_attacker"]?.length, 1);
});

test("pairing: membatasi maksimal 5 percobaan gagal per chat per jam", async () => {
  const pm = new PairingManager();
  const state = createEmptyGatewayState();
  const { code } = pm.createPairingCode("telegram");

  // Lakukan 5 percobaan salah
  for (let i = 0; i < 5; i++) {
    const r = await pm.handlePairingAttempt("WRONG", "chat_spammer", state, async () => {});
    assert.equal(r.ok, false);
  }

  // Percobaan ke-6 bahkan dengan kode BENAR harus ditolak karena rate limit
  const res6 = await pm.handlePairingAttempt(code, "chat_spammer", state, async () => {});
  assert.equal(res6.ok, false);
  assert.match(res6.error!, /too many failed pairing attempts/i);
});

test("pairing: kode kedaluwarsa setelah 10 menit", async () => {
  const pm = new PairingManager();
  const state = createEmptyGatewayState();
  const { code } = pm.createPairingCode("telegram");

  // Simulasikan waktu 11 menit kemudian
  const elevenMinLater = Date.now() + 11 * 60 * 1000;

  const res = await pm.handlePairingAttempt(
    code,
    "chat_late",
    state,
    async () => {},
    elevenMinLater,
  );

  assert.equal(res.ok, false);
  assert.match(res.error!, /invalid or has expired/i);
});

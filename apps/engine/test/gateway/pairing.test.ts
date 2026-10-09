/**
 * Unit test Pairing Manager & Standalone Helpers (spec §3.5, §6, §7).
 *
 * Menguji:
 *  - Pembuatan kode pairing acak (>= 8 karakter, expires in 10 min)
 *  - Standalone helpers: createPairingCode & pairingStatus tanpa gateway running
 *  - Cross-process pairing: kode dibuat di proses A diterima di gateway B
 *  - Status pairing (pending -> paired -> expired)
 *  - Pemangkasan (pruning) kode kedaluwarsa dari state file
 *  - Batasan maksimal 5 percobaan gagal per chat per jam
 *  - Invarian: tidak memodifikasi file .data/gateway-state.json asli di repo
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  PairingManager,
  createPairingCode,
  pairingStatus,
  PAIRING_EXPIRY_MS,
} from "../../src/gateway/pairing.ts";
import {
  createEmptyGatewayState,
  loadGatewayStateSync,
  saveGatewayStateSync,
} from "../../src/gateway/core/state.ts";

test("pairing: createPairingCode menghasilkan kode >= 8 karakter dan expired dalam 10 menit", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "tahansoe-pairing-test-"));
  const statePath = join(tmp, "gateway-state.json");

  try {
    const pm = new PairingManager(statePath);
    const { code, expiresAt } = pm.createPairingCode("telegram");

    assert.ok(code.length >= 8, `Code length ${code.length} should be >= 8`);
    const now = Date.now();
    const diff = expiresAt.getTime() - now;
    assert.ok(diff > 9 * 60 * 1000 && diff <= PAIRING_EXPIRY_MS + 1000);

    // Status awal harus pending
    const status = pm.pairingStatus(code);
    assert.equal(status.status, "pending");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("pairing: standalone helpers createPairingCode dan pairingStatus bekerja tanpa gateway", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "tahansoe-pairing-standalone-"));
  const statePath = join(tmp, "gateway-state.json");

  try {
    const { code, expiresAt } = createPairingCode("telegram", statePath);
    assert.ok(code.length >= 8);
    assert.ok(expiresAt instanceof Date);

    const initial = pairingStatus(code, statePath);
    assert.equal(initial.status, "pending");

    // Kode acak tak dikenal harus expired
    const unknown = pairingStatus("UNKNOWN_CODE", statePath);
    assert.equal(unknown.status, "expired");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("pairing: cross-process pairing — kode dibuat proses A diterima oleh gateway B", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "tahansoe-pairing-cross-"));
  const statePath = join(tmp, "gateway-state.json");

  try {
    // 1. Proses A (mis. CLI setup/pair) membuat kode pairing ke state file
    const { code } = createPairingCode("telegram", statePath);

    // 2. Proses B (gateway yang sedang running) menerima /start CODE dari Telegram
    const pmB = new PairingManager(statePath);
    const pairedChats: string[] = [];
    const attemptRes = await pmB.handlePairingAttempt(code, "chat_telegram_777", undefined, async (chatId) => {
      pairedChats.push(chatId);
    });

    assert.equal(attemptRes.ok, true);
    assert.deepEqual(pairedChats, ["chat_telegram_777"]);

    // 3. Proses A memeriksa status pairing dari state file
    const finalStatus = pairingStatus(code, statePath);
    assert.equal(finalStatus.status, "paired");
    assert.equal(finalStatus.chatId, "chat_telegram_777");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("pairing: handlePairingAttempt sukses menandai paired dan memanggil callback", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "tahansoe-pairing-attempt-"));
  const statePath = join(tmp, "gateway-state.json");

  try {
    const pm = new PairingManager(statePath);
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
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("pairing: kode salah dicatat sebagai percobaan gagal dan ditolak", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "tahansoe-pairing-wrong-"));
  const statePath = join(tmp, "gateway-state.json");

  try {
    const pm = new PairingManager(statePath);
    const state = createEmptyGatewayState();
    pm.createPairingCode("telegram");

    const res = await pm.handlePairingAttempt("WRONG_CODE", "chat_attacker", state, async () => {});

    assert.equal(res.ok, false);
    assert.match(res.error!, /invalid or has expired/i);
    assert.equal(state.failedPairingAttempts["chat_attacker"]?.length, 1);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("pairing: membatasi maksimal 5 percobaan gagal per chat per jam", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "tahansoe-pairing-ratelimit-"));
  const statePath = join(tmp, "gateway-state.json");

  try {
    const pm = new PairingManager(statePath);
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
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("pairing: kode kedaluwarsa setelah 10 menit dan dipangkas (pruning)", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "tahansoe-pairing-expiry-"));
  const statePath = join(tmp, "gateway-state.json");

  try {
    const pm = new PairingManager(statePath);
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

    // Pastikan kode terkedaluwarsa dan dipangkas dari state
    const st = pm.pairingStatus(code);
    assert.equal(st.status, "expired");

    // Muat state langsung dari disk dan verifikasi pruning
    const rawState = loadGatewayStateSync(statePath);
    // Hash kode harus sudah tidak ada di pendingPairings setelah pruning
    const values = Object.values(rawState.pendingPairings ?? {});
    assert.equal(values.length, 0, "Record yang sudah expired harus dipangkas");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

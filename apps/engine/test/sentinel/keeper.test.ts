import test from "node:test";
import assert from "node:assert/strict";
import { Keeper } from "../../src/sentinel/keeper.ts";

test("keeper: evaluasi kebutuhan proteksi (decision logic)", async () => {
  const keeper = new Keeper();
  const user = "0x1111111111111111111111111111111111111111";
  const guardian = "0x1A5D249A8e711E2288AdD7c01e31Eb7FFB05D97E";

  // Kasus 1: HF di atas trigger -> tidak perlu proteksi
  const resSafe = await keeper.evaluateAndProtect({
    user,
    guardianAddress: guardian,
    hf: 1.45,
    triggerHf: 1.30,
    quoteAmount: 500n,
  });
  assert.equal(resSafe.status, "no_action_needed");

  // Kasus 2: HF sama dengan trigger -> tidak perlu proteksi
  const resEqual = await keeper.evaluateAndProtect({
    user,
    guardianAddress: guardian,
    hf: 1.30,
    triggerHf: 1.30,
    quoteAmount: 500n,
  });
  assert.equal(resEqual.status, "no_action_needed");

  // Kasus 3: HF di bawah trigger tapi quoteAmount 0 -> tidak perlu proteksi
  const resZeroQuote = await keeper.evaluateAndProtect({
    user,
    guardianAddress: guardian,
    hf: 1.25,
    triggerHf: 1.30,
    quoteAmount: 0n,
  });
  assert.equal(resZeroQuote.status, "no_action_needed");

  // Kasus 4: HF di bawah trigger dan quoteAmount > 0 -> dry run (tanpa key)
  const resDryRun = await keeper.evaluateAndProtect({
    user,
    guardianAddress: guardian,
    hf: 1.25,
    triggerHf: 1.30,
    quoteAmount: 500n,
  });
  assert.equal(resDryRun.status, "dry_run");
  assert.equal(resDryRun.quoteAmount, 500n);
});

test("keeper: eksekusi live vs dry-run", async () => {
  const user = "0x2222222222222222222222222222222222222222";
  const guardian = "0x1A5D249A8e711E2288AdD7c01e31Eb7FFB05D97E";

  // Dry run
  const dryKeeper = new Keeper();
  assert.equal(dryKeeper.isDryRun(), true);
  const dryRes = await dryKeeper.evaluateAndProtect({
    user,
    guardianAddress: guardian,
    hf: 1.15,
    triggerHf: 1.30,
    quoteAmount: 1000n,
  });
  assert.equal(dryRes.status, "dry_run");

  // Live execution via protectCaller
  let calledCount = 0;
  const liveKeeper = new Keeper({
    protectCaller: async (g, u) => {
      calledCount++;
      assert.equal(g, guardian.toLowerCase());
      assert.equal(u, user.toLowerCase());
      return "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
    },
  });

  assert.equal(liveKeeper.isDryRun(), false);
  const liveRes = await liveKeeper.evaluateAndProtect({
    user,
    guardianAddress: guardian,
    hf: 1.15,
    triggerHf: 1.30,
    quoteAmount: 1000n,
  });

  assert.equal(liveRes.status, "executed");
  assert.equal(liveRes.txHash, "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890");
  assert.equal(calledCount, 1);
});

test("keeper: in-flight lock mencegah lebih dari 1 transaksi simultan per user", async () => {
  const user = "0x3333333333333333333333333333333333333333";
  const guardian = "0x1A5D249A8e711E2288AdD7c01e31Eb7FFB05D97E";

  let resolveTx: (hash: `0x${string}`) => void;
  const txPromise = new Promise<`0x${string}`>((res) => {
    resolveTx = res;
  });

  const keeper = new Keeper({
    protectCaller: async () => txPromise,
  });

  // Mulai transaksi pertama (tertahan di txPromise)
  const tx1Promise = keeper.evaluateAndProtect({
    user,
    guardianAddress: guardian,
    hf: 1.10,
    triggerHf: 1.30,
    quoteAmount: 500n,
  });

  // Panggil kedua kalinya sebelum tx1 selesai -> harus diskip in-flight
  const tx2 = await keeper.evaluateAndProtect({
    user,
    guardianAddress: guardian,
    hf: 1.10,
    triggerHf: 1.30,
    quoteAmount: 500n,
  });

  assert.equal(tx2.status, "skipped_in_flight");

  // Selesaikan tx1
  resolveTx!("0x1111222233334444555566667777888899990000111122223333444455556666");
  const tx1 = await tx1Promise;
  assert.equal(tx1.status, "executed");
});

test("keeper: back off eksponensial saat revert dan reset saat berhasil", async () => {
  const user = "0x4444444444444444444444444444444444444444";
  const guardian = "0x1A5D249A8e711E2288AdD7c01e31Eb7FFB05D97E";

  let currentTime = 1_000_000;
  let shouldFail = true;

  const keeper = new Keeper({
    baseBackoffMs: 60_000, // 60s
    now: () => currentTime,
    protectCaller: async () => {
      if (shouldFail) {
        throw new Error("execution reverted: NotAtRisk");
      }
      return "0xsuccess";
    },
  });

  // Percobaan 1: Gagal revert -> tercatat backoff 60s
  const res1 = await keeper.evaluateAndProtect({
    user,
    guardianAddress: guardian,
    hf: 1.10,
    triggerHf: 1.30,
    quoteAmount: 500n,
  });
  assert.equal(res1.status, "failed");

  // Percobaan 2 segera (currentTime belum bertambah) -> skipped_backoff
  const res2 = await keeper.evaluateAndProtect({
    user,
    guardianAddress: guardian,
    hf: 1.10,
    triggerHf: 1.30,
    quoteAmount: 500n,
  });
  assert.equal(res2.status, "skipped_backoff");

  // Majukan waktu 30s (masih dalam jendela 60s) -> skipped_backoff
  currentTime += 30_000;
  const res3 = await keeper.evaluateAndProtect({
    user,
    guardianAddress: guardian,
    hf: 1.10,
    triggerHf: 1.30,
    quoteAmount: 500n,
  });
  assert.equal(res3.status, "skipped_backoff");

  // Majukan waktu 31s lagi (total +61s, backoff habis) dan berhasil
  currentTime += 31_000;
  shouldFail = false;
  const res4 = await keeper.evaluateAndProtect({
    user,
    guardianAddress: guardian,
    hf: 1.10,
    triggerHf: 1.30,
    quoteAmount: 500n,
  });
  assert.equal(res4.status, "executed");

  // Setelah sukses, panggil lagi (dengan failure) -> backoff harus direset ke tingkat 1 (60s, bukan 120s)
  shouldFail = true;
  currentTime += 1000;
  const res5 = await keeper.evaluateAndProtect({
    user,
    guardianAddress: guardian,
    hf: 1.10,
    triggerHf: 1.30,
    quoteAmount: 500n,
  });
  assert.equal(res5.status, "failed");
});

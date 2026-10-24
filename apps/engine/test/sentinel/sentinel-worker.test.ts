import test from "node:test";
import assert from "node:assert/strict";
import { hfToWad } from "@tahansoe/domain";
import { SentinelWorker } from "../../src/sentinel/sentinel-worker.ts";
import { InMemorySentinelDatabase } from "../../src/sentinel/db-adapter.ts";
import { Keeper } from "../../src/sentinel/keeper.ts";
import type { TelegramSender } from "../../src/telegram/index.ts";
import type { AdvisoryLockClient } from "../../src/worker/lock.ts";

class FakeChannelAdapter implements TelegramSender {
  readonly channelName = "telegram";
  public sentMessages: Array<{ chatId: string; message: string; options?: any }> = [];

  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  async send(chatId: string | number | bigint, message: string, options?: any): Promise<void> {
    this.sentMessages.push({ chatId: String(chatId), message, options });
  }
}

test("sentinel-worker: mendeteksi transisi zona risiko dan mengirim alert hanya saat transisi (dedupe)", async () => {
  const db = new InMemorySentinelDatabase();
  const adapter = new FakeChannelAdapter();

  const user = "0x1111111111111111111111111111111111111111";
  const guardian = "0x1A5D249A8e711E2288AdD7c01e31Eb7FFB05D97E";
  const debtAsset = "0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d";

  const userId = await db.upsertUser(user as any, 421614);
  db.linkedTelegram.set(userId, ["chat_999"]);

  await db.upsertPolicy({
    userId,
    chainId: 421614,
    guardianAddress: guardian as any,
    guardianVersion: 1,
    debtAsset: debtAsset as any,
    maxRepayPerAction: 500_000_000n,
    triggerThreshold: 1.30,
    targetHealthFactor: 1.60,
  });

  let currentHf = 2.0; // Awalnya Safe
  let quoteAmount = 0n;

  const worker = new SentinelWorker({
    chainId: 421614,
    db,
    channelAdapter: adapter,
    lockClient: null,
    multicallLoader: async () => [
      {
        accountData: {
          collateralBase: 2000_00000000n,
          debtBase: 1000_00000000n,
          liquidationThresholdBps: 8000n,
          healthFactor: hfToWad(currentHf),
        },
        allowance: 1000_000_000n,
        balance: 1000_000_000n,
        quoteAmount,
      },
    ],
  });

  // Tick 1: Status Safe (belum ada transisi karena baru inisialisasi)
  const res1 = await worker.tick();
  assert.equal(res1.checkedUsers, 1);
  assert.equal(res1.transitions.length, 0);
  assert.equal(adapter.sentMessages.length, 0);

  // Tick 2: HF turun ke 1.40 (Warning, karena 1.30 < 1.40 <= 1.45) -> Transisi Safe -> Warning!
  currentHf = 1.40;
  const res2 = await worker.tick();
  assert.equal(res2.transitions.length, 1);
  assert.equal(res2.transitions[0]!.from, "Safe");
  assert.equal(res2.transitions[0]!.to, "Warning");
  assert.equal(adapter.sentMessages.length, 1);
  assert.match(adapter.sentMessages[0]!.message, /PERINGATAN RISIKO HF|HEALTH FACTOR WARNING/);

  // Tick 3: HF tetap di 1.40 (masih Warning) -> Dedupe: tidak ada transisi baru, tidak ada pesan baru!
  const res3 = await worker.tick();
  assert.equal(res3.transitions.length, 0);
  assert.equal(adapter.sentMessages.length, 1); // tetap 1!

  // Tick 4: HF turun lagi ke 1.20 (Critical, karena 1.20 <= 1.30) -> Transisi Warning -> Critical!
  currentHf = 1.20;
  quoteAmount = 400_000_000n;
  const res4 = await worker.tick();
  assert.equal(res4.transitions.length, 1);
  assert.equal(res4.transitions[0]!.from, "Warning");
  assert.equal(res4.transitions[0]!.to, "Critical");
  assert.equal(adapter.sentMessages.length, 2);
  assert.match(adapter.sentMessages[1]!.message, /KRITIKAL|CRITICAL/);
  assert.equal(res4.keeperActions.length, 1);
  assert.equal(res4.keeperActions[0]!.status, "dry_run");
});

test("sentinel-worker: mendeteksi RESERVE_LOW saat saldo atau allowance kurang dari cap", async () => {
  const db = new InMemorySentinelDatabase();
  const adapter = new FakeChannelAdapter();

  const user = "0x1111111111111111111111111111111111111111";
  const guardian = "0x1A5D249A8e711E2288AdD7c01e31Eb7FFB05D97E";
  const debtAsset = "0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d";

  const userId = await db.upsertUser(user as any, 421614);
  db.linkedTelegram.set(userId, ["chat_999"]);

  await db.upsertPolicy({
    userId,
    chainId: 421614,
    guardianAddress: guardian as any,
    guardianVersion: 1,
    debtAsset: debtAsset as any,
    maxRepayPerAction: 500_000_000n, // Cap 500
    triggerThreshold: 1.30,
    targetHealthFactor: 1.60,
  });

  let allowance = 200_000_000n; // 200 (< 500) -> Reserve Low!
  let balance = 1000_000_000n;

  const worker = new SentinelWorker({
    chainId: 421614,
    db,
    channelAdapter: adapter,
    lockClient: null,
    multicallLoader: async () => [
      {
        accountData: {
          collateralBase: 2000_00000000n,
          debtBase: 1000_00000000n,
          liquidationThresholdBps: 8000n,
          healthFactor: hfToWad(2.0), // HF aman
        },
        allowance,
        balance,
        quoteAmount: 0n,
      },
    ],
  });

  // Tick 1: Terdeteksi RESERVE_LOW
  await worker.tick();
  assert.equal(adapter.sentMessages.length, 1);
  assert.match(adapter.sentMessages[0]!.message, /CADANGAN RESERVOIR RENDAH|RESERVE CAPACITY LOW/);

  // Tick 2: Masih low -> dideduplikasi (tidak kirim pesan kedua)
  await worker.tick();
  assert.equal(adapter.sentMessages.length, 1);

  // Tick 3: User menaikkan allowance -> kondisi pulih
  allowance = 1000_000_000n;
  await worker.tick();
  assert.equal(adapter.sentMessages.length, 1);

  // Tick 4: Sekarang balance jatuh menjadi 100 (< 500) -> terpicu kembali!
  balance = 100_000_000n;
  await worker.tick();
  assert.equal(adapter.sentMessages.length, 2);
  assert.match(adapter.sentMessages[1]!.message, /CADANGAN RESERVOIR RENDAH|RESERVE CAPACITY LOW/);
});

test("sentinel-worker: advisory lock guard mencegah dua instance berjalan bersamaan", async () => {
  let exitCode: number | null = null;
  const mockLockClient: AdvisoryLockClient = {
    query: async () => ({ rows: [{ locked: false }] }), // Lock gagal / sudah dipegang
  };

  const worker = new SentinelWorker({
    lockClient: mockLockClient,
    exitFn: (code) => {
      exitCode = code;
    },
  });

  await worker.start();
  assert.equal(exitCode, 0); // Keluar bersih tanpa melempar exception
});

test("sentinel-worker: deduplikasi zona risiko bekerja independen per positionKey untuk user yang sama", async () => {
  const db = new InMemorySentinelDatabase();
  const adapter = new FakeChannelAdapter();

  const user = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const guardian = "0x1A5D249A8e711E2288AdD7c01E31Eb7FFB05D97E";
  const usdc = "0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d";
  const weth = "0x1df462e2712496373a347f8ad10802a5e95f053d";

  const userId = await db.upsertUser(user as any, 421614);
  db.linkedTelegram.set(userId, ["chat_multi_pos"]);

  const posKeyUsdc = `aave-v3:421614:${guardian.toLowerCase()}:${usdc.toLowerCase()}`;
  const posKeyWeth = `aave-v3:421614:${guardian.toLowerCase()}:${weth.toLowerCase()}`;

  await db.upsertPolicy({
    userId,
    chainId: 421614,
    guardianAddress: guardian as any,
    guardianVersion: 4,
    debtAsset: usdc as any,
    positionKey: posKeyUsdc,
    protocol: "aave-v3",
    maxRepayPerAction: 500_000_000n,
    triggerThreshold: 1.30,
    targetHealthFactor: 1.60,
  });

  await db.upsertPolicy({
    userId,
    chainId: 421614,
    guardianAddress: guardian as any,
    guardianVersion: 4,
    debtAsset: weth as any,
    positionKey: posKeyWeth,
    protocol: "aave-v3",
    maxRepayPerAction: 100_000_000_000_000_000n,
    triggerThreshold: 1.30,
    targetHealthFactor: 1.60,
  });

  let hfUsdc = 2.0; // Safe
  let hfWeth = 2.0; // Safe

  const worker = new SentinelWorker({
    chainId: 421614,
    db,
    channelAdapter: adapter,
    lockClient: null,
    multicallLoader: async (policies) => {
      return policies.map((p) => {
        const isUsdc = p.debtAsset.toLowerCase() === usdc.toLowerCase();
        const hf = isUsdc ? hfUsdc : hfWeth;
        return {
          accountData: {
            collateralBase: 2000_00000000n,
            debtBase: 1000_00000000n,
            liquidationThresholdBps: 8000n,
            healthFactor: hfToWad(hf),
          },
          allowance: 1000_000_000_000_000_000n,
          balance: 1000_000_000_000_000_000n,
          quoteAmount: 0n,
        };
      });
    },
  });

  // Tick 1: Status awal (inisialisasi zona Safe untuk kedua posisi)
  const res1 = await worker.tick();
  assert.equal(res1.checkedUsers, 2);
  assert.equal(adapter.sentMessages.length, 0);

  // Tick 2: USDC turun ke Warning (1.40), WETH tetap Safe (2.0)
  hfUsdc = 1.40;
  const res2 = await worker.tick();
  assert.equal(res2.transitions.length, 1);
  assert.equal(res2.transitions[0]!.positionKey, posKeyUsdc);
  assert.equal(adapter.sentMessages.length, 1);

  // Tick 3: USDC tetap Warning, WETH sekarang turun ke Critical (1.20)
  // WETH harus mengirim alert baru meskipun user yang sama sudah punya alert aktif di USDC!
  hfWeth = 1.20;
  const res3 = await worker.tick();
  assert.equal(res3.transitions.length, 1);
  assert.equal(res3.transitions[0]!.positionKey, posKeyWeth);
  assert.equal(adapter.sentMessages.length, 2);
});

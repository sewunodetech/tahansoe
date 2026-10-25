/**
 * Test unit integrasi Shadow Protection Agent di Sentinel tick (spec §3.2-3.3, Phase A).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { hfToWad } from "@tahansoe/domain";
import { SentinelWorker } from "../../src/sentinel/sentinel-worker.ts";
import { InMemorySentinelDatabase } from "../../src/sentinel/db-adapter.ts";
import { Keeper } from "../../src/sentinel/keeper.ts";

test("shadow mode: mencatat plan proteksi ke protection_plans (fake DB) tanpa mengirim transaksi", async () => {
  const db = new InMemorySentinelDatabase();

  const user = "0x1111111111111111111111111111111111111111";
  const guardian = "0x1a5d249a8e711e2288add7c01e31eb7ffb05d97e";
  const debtAsset = "0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d";

  const userId = await db.upsertUser(user as any, 421614);

  // Setup active policy: static trigger 1.15, target 1.60
  await db.upsertPolicy({
    userId,
    chainId: 421614,
    guardianAddress: guardian as any,
    guardianVersion: 4,
    debtAsset: debtAsset as any,
    positionKey: `aave-v3:421614:${guardian}:${debtAsset}`,
    maxRepayPerAction: 500_000_000n, // 500 USDC
    triggerThreshold: 1.15,
    targetHealthFactor: 1.6,
  });

  // Setup risk assessment terbaru di DB: regime STRESSED
  db.latestRiskAssessment = {
    id: "assessment-test-1",
    regime: "STRESSED",
    validUntil: new Date(Date.now() + 3600 * 1000),
    drivers: [{ id: "sig-drawdown-1" }],
  };

  // Posisi saat ini: HF = 1.25 (di atas trigger statis 1.15, jadi keeper normal TIDAK protect)
  // Tetapi di bawah trigger STRESSED preemptif (1.45/1.60), jadi agent mengevaluasi proteksi
  const currentHf = 1.25;

  const worker = new SentinelWorker({
    chainId: 421614,
    db,
    lockClient: null,
    protectionAgentMode: "shadow",
    multicallLoader: async () => [
      {
        accountData: {
          collateralBase: 10_000_00000000n, // $10,000
          debtBase: 6_600_00000000n, // $6,600 -> HF = 10000 * 0.825 / 6600 = 1.25
          liquidationThresholdBps: 8250n,
          healthFactor: hfToWad(currentHf),
        },
        allowance: 1_000_000_000n,
        balance: 1_000_000_000n,
        quoteAmount: 0n,
      },
    ],
  });

  const tickResult = await worker.tick();

  // 1. Keeper tidak mengeksekusi aksi on-chain apapun
  assert.equal(tickResult.keeperActions.length, 0);

  // 2. Baris plan tercatat di tabel protection_plans (fake DB)
  assert.ok(db.shadowPlans.length >= 1, "Harus mencatat setidaknya 1 shadow protection plan");

  const planRow = db.shadowPlans[0]!;
  assert.equal(planRow.mode, "SHADOW");
  assert.ok(planRow.planHash.startsWith("0x"));
  assert.ok(planRow.decision === "ACCEPTED" || planRow.decision === "REJECTED");
  assert.equal(planRow.positionKey, `aave-v3:421614:${guardian}:${debtAsset}`);
  assert.equal(planRow.healthFactor, "1.2500");
  assert.equal(planRow.regime, "STRESSED");
});

test("protectionAgentMode = 'off': tidak mencatat plan ke protection_plans", async () => {
  const db = new InMemorySentinelDatabase();

  const user = "0x1111111111111111111111111111111111111111";
  const guardian = "0x1a5d249a8e711e2288add7c01e31eb7ffb05d97e";
  const debtAsset = "0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d";

  const userId = await db.upsertUser(user as any, 421614);
  await db.upsertPolicy({
    userId,
    chainId: 421614,
    guardianAddress: guardian as any,
    guardianVersion: 1,
    debtAsset: debtAsset as any,
    maxRepayPerAction: 500_000_000n,
    triggerThreshold: 1.15,
    targetHealthFactor: 1.6,
  });

  const worker = new SentinelWorker({
    chainId: 421614,
    db,
    lockClient: null,
    protectionAgentMode: "off",
    multicallLoader: async () => [
      {
        accountData: {
          collateralBase: 10_000_00000000n,
          debtBase: 6_600_00000000n,
          liquidationThresholdBps: 8250n,
          healthFactor: hfToWad(1.25),
        },
        allowance: 1_000_000_000n,
        balance: 1_000_000_000n,
        quoteAmount: 0n,
      },
    ],
  });

  await worker.tick();
  assert.equal(db.shadowPlans.length, 0, "Tidak boleh mencatat plan saat mode off");
});

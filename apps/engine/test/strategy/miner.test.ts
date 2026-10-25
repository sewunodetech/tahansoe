/**
 * Unit test untuk Survivor Playbook Miner (spec m4 §3.4).
 *
 * Menguji:
 * 1. Deteksi at-risk (HF < 1.15) dan klasifikasi outcome (SURVIVED vs LIQUIDATED)
 * 2. Ekstraksi fitur perilaku proteksi (lead time, HF buffer, funding source, relative size)
 * 3. Emisi candidate Playbook[] dengan bukti agregat tanpa kebocoran alamat wallet
 * 4. End-to-end miner run pada minimal 3 jendela crash historis
 * 5. CLI subcommand `strategy mine` dan `strategy list-windows`
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  HISTORICAL_CRASH_WINDOWS,
  getCrashWindowById,
} from "../../src/strategy/miner/windows.ts";
import {
  normalizeAaveLog,
} from "../../src/strategy/miner/log-fetcher.ts";
import {
  evaluateWalletRiskFromEvents,
  groupEventsByWallet,
  parseHealthFactor,
} from "../../src/strategy/miner/risk-evaluator.ts";
import {
  determineFundingSource,
  extractProtectionBehavior,
} from "../../src/strategy/miner/feature-extractor.ts";
import {
  aggregateWindowResults,
  assertNoWalletsLeaked,
  emitCandidatePlaybooks,
} from "../../src/strategy/miner/playbook-emitter.ts";
import {
  mineCrashWindow,
  runSurvivorMiner,
} from "../../src/strategy/miner/miner.ts";
import { strategyCommand } from "../../src/cli/commands/strategy.ts";
import {
  getUsdcDepegFixtureEvents,
  getYenCarryFixtureEvents,
  getTariffCrashFixtureEvents,
} from "../../src/strategy/miner/fixtures/recorded-windows.ts";
import type { NormalizedAaveEvent } from "../../src/strategy/miner/types.ts";

test("Crash Windows Catalog: memuat minimal 3 jendela crash resmi Arbitrum One", () => {
  assert.ok(HISTORICAL_CRASH_WINDOWS.length >= 3, "Harus ada minimal 3 jendela crash");

  const usdcWin = getCrashWindowById("usdc-depeg-mar-2023");
  assert.ok(usdcWin, "Window usdc-depeg-mar-2023 harus ada");
  assert.equal(usdcWin.dominantPaths.includes("T4"), true);

  const yenWin = getCrashWindowById("yen-carry-aug-2024");
  assert.ok(yenWin, "Window yen-carry-aug-2024 harus ada");
  assert.equal(yenWin.dominantPaths.includes("T1"), true);
  assert.equal(yenWin.dominantPaths.includes("T3"), true);

  const tariffWin = getCrashWindowById("tariff-crash-oct-2025");
  assert.ok(tariffWin, "Window tariff-crash-oct-2025 harus ada");
  assert.equal(tariffWin.dominantPaths.includes("T1"), true);
  assert.equal(tariffWin.dominantPaths.includes("T6"), true);
});

test("Log Normalizer: menormalisasi event Aave V3 Pool secara tepat", () => {
  // 1. Supply
  const supply = normalizeAaveLog(
    "Supply",
    {
      reserve: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",
      user: "0x1111111111111111111111111111111111111111",
      onBehalfOf: "0x2222222222222222222222222222222222222222",
      amount: 1000n,
      referralCode: 0,
    },
    100n,
    0,
    "0xabc",
  );
  assert.equal(supply?.type, "Supply");
  assert.equal(supply?.user, "0x2222222222222222222222222222222222222222"); // onBehalfOf
  assert.equal(supply?.amount, 1000n);

  // 2. Repay
  const repay = normalizeAaveLog(
    "Repay",
    {
      reserve: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
      user: "0x3333333333333333333333333333333333333333",
      repayer: "0x3333333333333333333333333333333333333333",
      amount: 500n,
      useATokens: true,
    },
    105n,
    1,
    "0xdef",
  );
  assert.equal(repay?.type, "Repay");
  assert.equal(repay?.user, "0x3333333333333333333333333333333333333333");
  assert.equal(repay?.extra?.useATokens, true);

  // 3. LiquidationCall
  const liq = normalizeAaveLog(
    "LiquidationCall",
    {
      collateralAsset: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",
      debtAsset: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
      user: "0x4444444444444444444444444444444444444444",
      debtToCover: 2000n,
      liquidatedCollateralAmount: 1n,
      liquidator: "0x9999999999999999999999999999999999999999",
      receiveAToken: false,
    },
    110n,
    2,
    "0x123",
  );
  assert.equal(liq?.type, "LiquidationCall");
  assert.equal(liq?.user, "0x4444444444444444444444444444444444444444");
  assert.equal(liq?.amount, 2000n);
  assert.equal(liq?.extra?.liquidator, "0x9999999999999999999999999999999999999999");
});

test("Risk Evaluator: mengklasifikasikan at-risk dan outcome SURVIVED vs LIQUIDATED", () => {
  const window = HISTORICAL_CRASH_WINDOWS[0]!;
  const userA = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const userB = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const userC = "0xcccccccccccccccccccccccccccccccccccccccc";

  const events: NormalizedAaveEvent[] = [
    // userA: Borrow + LiquidationCall
    {
      type: "Borrow",
      blockNumber: 100n,
      logIndex: 0,
      transactionHash: "0x1",
      user: userA,
      reserveAsset: "0xusdc",
      amount: 10_000n,
    },
    {
      type: "LiquidationCall",
      blockNumber: 200n,
      logIndex: 1,
      transactionHash: "0x2",
      user: userA,
      reserveAsset: "0xusdc",
      amount: 5_000n,
      extra: { liquidator: "0xliq" },
    },
    // userB: Borrow + Repay (Survivor)
    {
      type: "Borrow",
      blockNumber: 100n,
      logIndex: 2,
      transactionHash: "0x3",
      user: userB,
      reserveAsset: "0xusdc",
      amount: 10_000n,
    },
    {
      type: "Repay",
      blockNumber: 150n,
      logIndex: 3,
      transactionHash: "0x4",
      user: userB,
      reserveAsset: "0xusdc",
      amount: 5_000n,
      extra: { repayer: userB, useATokens: false },
    },
    // userC: Supply only (Healthy)
    {
      type: "Supply",
      blockNumber: 100n,
      logIndex: 4,
      transactionHash: "0x5",
      user: userC,
      reserveAsset: "0xweth",
      amount: 50n,
    },
  ];

  const grouped = groupEventsByWallet(events);

  const resA = evaluateWalletRiskFromEvents(grouped.get(userA)!, window);
  assert.equal(resA.isAtRisk, true);
  assert.equal(resA.outcome, "LIQUIDATED");

  const resB = evaluateWalletRiskFromEvents(grouped.get(userB)!, window);
  assert.equal(resB.isAtRisk, true);
  assert.equal(resB.outcome, "SURVIVED");

  const resC = evaluateWalletRiskFromEvents(grouped.get(userC)!, window);
  assert.equal(resC.outcome, "NOT_AT_RISK");
});

test("Risk Evaluator: evaluasi dengan snapshot getUserAccountData historis", () => {
  const window = HISTORICAL_CRASH_WINDOWS[0]!;
  const user = "0x1234567890123456789012345678901234567890";

  const grouped = groupEventsByWallet([
    {
      type: "Borrow",
      blockNumber: 100n,
      logIndex: 0,
      transactionHash: "0x1",
      user,
      reserveAsset: "0xusdc",
      amount: 1000n,
    },
  ]);

  // Case 1: HF = 1.08 (< 1.15) -> At risk & Survived
  const res1 = evaluateWalletRiskFromEvents(grouped.get(user)!, window, {
    totalCollateralBase: 1200n,
    totalDebtBase: 1000n,
    availableBorrowsBase: 100n,
    currentLiquidationThreshold: 8500n,
    ltv: 8000n,
    healthFactor: 1.08,
  });
  assert.equal(res1.isAtRisk, true);
  assert.equal(res1.outcome, "SURVIVED");

  // Case 2: HF = 1.50 (>= 1.15) -> Not at risk
  const res2 = evaluateWalletRiskFromEvents(grouped.get(user)!, window, {
    totalCollateralBase: 2000n,
    totalDebtBase: 1000n,
    availableBorrowsBase: 500n,
    currentLiquidationThreshold: 8500n,
    ltv: 8000n,
    healthFactor: 1.5,
  });
  assert.equal(res2.isAtRisk, false);
  assert.equal(res2.outcome, "NOT_AT_RISK");
});

test("Feature Extractor: mendeteksi funding source dan menghitung leadBlocks secara tepat", () => {
  const window = HISTORICAL_CRASH_WINDOWS[0]!;
  const drawdownBlock = window.drawdownStartBlock;

  // 1. REPAY_WALLET
  const user1 = "0x1000000000000000000000000000000000000001";
  const history1 = {
    wallet: user1,
    events: [],
    hasLiquidation: false,
    liquidationEvents: [],
    repayEvents: [
      {
        type: "Repay" as const,
        blockNumber: drawdownBlock - 1000n,
        logIndex: 1,
        transactionHash: "0x1",
        user: user1,
        reserveAsset: "0xusdc",
        amount: 3000n,
        extra: { repayer: user1, useATokens: false },
      },
    ],
    supplyEvents: [],
    withdrawEvents: [],
    borrowEvents: [
      {
        type: "Borrow" as const,
        blockNumber: drawdownBlock - 5000n,
        logIndex: 0,
        transactionHash: "0x0",
        user: user1,
        reserveAsset: "0xusdc",
        amount: 10000n,
      },
    ],
  };

  const feat1 = extractProtectionBehavior(history1, window);
  assert.ok(feat1);
  assert.equal(feat1.fundingSource, "REPAY_WALLET");
  assert.equal(feat1.leadBlocks, 1000n); // Preemptive 1000 blocks
  assert.ok(feat1.hfAfterAction > 1.35);
  assert.equal(feat1.relativeSize, 0.3); // 3000 / 10000

  // 2. WITHDRAW_AND_REPAY via useATokens
  const user2 = "0x1000000000000000000000000000000000000002";
  const history2 = {
    wallet: user2,
    events: [],
    hasLiquidation: false,
    liquidationEvents: [],
    repayEvents: [
      {
        type: "Repay" as const,
        blockNumber: drawdownBlock - 500n,
        logIndex: 1,
        transactionHash: "0x2",
        user: user2,
        reserveAsset: "0xusdc",
        amount: 5000n,
        extra: { repayer: user2, useATokens: true },
      },
    ],
    supplyEvents: [],
    withdrawEvents: [],
    borrowEvents: [
      {
        type: "Borrow" as const,
        blockNumber: drawdownBlock - 2000n,
        logIndex: 0,
        transactionHash: "0x0",
        user: user2,
        reserveAsset: "0xusdc",
        amount: 10000n,
      },
    ],
  };

  const feat2 = extractProtectionBehavior(history2, window);
  assert.ok(feat2);
  assert.equal(feat2.fundingSource, "WITHDRAW_AND_REPAY");

  // 3. COLLATERAL_TOPUP
  const user3 = "0x1000000000000000000000000000000000000003";
  const history3 = {
    wallet: user3,
    events: [],
    hasLiquidation: false,
    liquidationEvents: [],
    repayEvents: [],
    supplyEvents: [
      {
        type: "Supply" as const,
        blockNumber: drawdownBlock - 800n,
        logIndex: 1,
        transactionHash: "0x3",
        user: user3,
        reserveAsset: "0xweth",
        amount: 20n,
      },
    ],
    withdrawEvents: [],
    borrowEvents: [],
  };

  const feat3 = extractProtectionBehavior(history3, window);
  assert.ok(feat3);
  assert.equal(feat3.fundingSource, "COLLATERAL_TOPUP");
  assert.equal(feat3.leadBlocks, 800n);
});

test("Playbook Emitter: menghasilkan candidate Playbook[] dengan bukti agregat tanpa alamat", () => {
  const window = HISTORICAL_CRASH_WINDOWS[0]!;
  const userA = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const userB = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  const walletResults = [
    {
      wallet: userA,
      windowId: window.id,
      isAtRisk: true,
      minHf: 1.08,
      outcome: "SURVIVED" as const,
      behavior: {
        fundingSource: "REPAY_WALLET" as const,
        firstDeRiskBlock: window.drawdownStartBlock - 1000n,
        leadBlocks: 1000n,
        minHfDuringWindow: 1.08,
        hfAfterAction: 1.65,
        repayOrTopupAmountBase: 5000n,
        debtBaseBefore: 10000n,
        relativeSize: 0.5,
      },
    },
    {
      wallet: userB,
      windowId: window.id,
      isAtRisk: true,
      minHf: 0.95,
      outcome: "LIQUIDATED" as const,
    },
  ];

  const evidence = aggregateWindowResults(
    window.id,
    window.name,
    window.startBlock,
    window.endBlock,
    10,
    walletResults,
  );

  assert.equal(evidence.atRiskWallets, 2);
  assert.equal(evidence.survivedWallets, 1);
  assert.equal(evidence.liquidatedWallets, 1);
  assert.equal(evidence.survivalRate, 0.5);
  assert.equal(evidence.actionDistribution.repayWallet, 1);
  assert.equal(evidence.medianHfAfter, 1.65);

  const playbooks = emitCandidatePlaybooks([evidence]);
  assert.ok(playbooks.length >= 3, "Harus menghasilkan minimal 3 candidate playbooks");

  for (const pb of playbooks) {
    assert.equal(pb.source, "MINER");
    assert.ok(pb.id.length > 0);
    assert.ok(pb.targetHf >= 1.4);
    assert.ok(pb.evidence);
    assert.ok(pb.evidence.sampleSize >= 1);
    assert.ok(pb.evidence.windowIds?.includes(window.id));
  }

  // Verifikasi INVARIANT: assertNoWalletsLeaked tidak boleh melempar
  assert.doesNotThrow(() => assertNoWalletsLeaked(playbooks));
});

test("Playbook Emitter: assertNoWalletsLeaked mendeteksi dan menolak kebocoran alamat 0x", () => {
  const leakedPlaybooks: any = [
    {
      id: "miner-leaked",
      description: "Follow wallet 0x1111111111111111111111111111111111111111",
      when: { hfBelow: 1.2 },
      action: "REPAY_WALLET",
      targetHf: 1.5,
      source: "MINER",
    },
  ];

  assert.throws(
    () => assertNoWalletsLeaked(leakedPlaybooks),
    /KEAMANAN TERCEMAR: Ditemukan alamat Ethereum/i,
  );
});

test("Survivor Miner: end-to-end run pada 3 jendela crash menghasilkan report dan playbooks", async () => {
  const tempOut = path.resolve(process.cwd(), "apps/engine/.data/test-playbooks.json");

  const report = await runSurvivorMiner({
    useFixtures: true,
    outputPath: tempOut,
  });

  assert.equal(report.windows.length, 3, "Harus menambang tepat 3 jendela");
  assert.ok(report.summary.totalAtRiskAnalyzed >= 10);
  assert.ok(report.summary.totalSurvivors >= 5);
  assert.ok(report.summary.totalLiquidated >= 3);
  assert.ok(report.candidatePlaybooks.length >= 4);

  // Periksa file tersimpan di disk
  const content = await fs.readFile(tempOut, "utf-8");
  assert.ok(content.length > 0);
  assert.equal(content.includes("0x1111111111111111111111111111111111111001"), false);

  // Bersihkan file tes sementara
  await fs.unlink(tempOut).catch(() => {});
});

test("CLI Command: `tahansoe strategy list-windows` mencetak katalog jendela", async () => {
  let output = "";
  const code = await strategyCommand(["list-windows"], {
    stdout: (s) => {
      output += s;
    },
  });

  assert.equal(code, 0);
  assert.ok(output.includes("usdc-depeg-mar-2023"));
  assert.ok(output.includes("yen-carry-aug-2024"));
  assert.ok(output.includes("tariff-crash-oct-2025"));
});

test("CLI Command: `tahansoe strategy mine --fixtures --json` menghasilkan output JSON valid", async () => {
  let output = "";
  const code = await strategyCommand(["mine", "--fixtures", "--json"], {
    stdout: (s) => {
      output += s;
    },
  });

  assert.equal(code, 0);
  const parsed = JSON.parse(output);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.report.windows.length, 3);
  assert.ok(parsed.report.candidatePlaybooks.length >= 4);
});

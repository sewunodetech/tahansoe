import test from "node:test";
import assert from "node:assert/strict";
import { ARBITRUM_SEPOLIA, type Address } from "@tahansoe/domain";
import {
  clampTrigger,
  shouldUpdateDynamicTrigger,
  computeValidUntil,
  DynamicTriggerService,
} from "../../src/sentinel/dynamic-trigger.ts";
import { InMemorySentinelDatabase } from "../../src/sentinel/db-adapter.ts";
import { SentinelWorker } from "../../src/sentinel/sentinel-worker.ts";
import type { PolicyRecord } from "../../src/sentinel/types.ts";

const RISK_AGENT_ADDR = (ARBITRUM_SEPOLIA.riskAgent?.toLowerCase() ??
  "0x4ef8e7a6106ffc768fcd12b5886319da71cd42ca") as Address;

const USER_ADDR = "0x1111111111111111111111111111111111111111" as Address;
const USDC_ADDR = "0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d" as Address;
const GUARDIAN_V4_ADDR = "0xa7bbab6366a723e17cd2f220d708757e449571b4" as Address;

function createTestPolicy(overrides: Partial<PolicyRecord> = {}): PolicyRecord {
  return {
    id: "pol-1",
    userId: "user-1",
    userAddress: USER_ADDR,
    chainId: ARBITRUM_SEPOLIA.chainId,
    guardianAddress: GUARDIAN_V4_ADDR,
    guardianVersion: 4,
    debtAsset: USDC_ADDR,
    maxRepayPerAction: 1000n * 10n ** 6n,
    triggerThreshold: 1.3,
    targetHealthFactor: 1.6,
    isActive: true,
    minTriggerHf: 1.2,
    maxTriggerHf: 1.5,
    riskAgent: RISK_AGENT_ADDR,
    dynamicTriggerHf: null,
    dynamicValidUntil: null,
    protocol: "aave-v3",
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure function tests
// ─────────────────────────────────────────────────────────────────────────────

test("clampTrigger: clamps to band [min, max] and strictly below targetHF", () => {
  // Value inside band
  assert.equal(clampTrigger(1.35, 1.2, 1.5, 1.6), 1.35);

  // Clamped up to min
  assert.equal(clampTrigger(1.1, 1.2, 1.5, 1.6), 1.2);

  // Clamped down to max
  assert.equal(clampTrigger(1.55, 1.2, 1.5, 1.6), 1.5);

  // Strictly below targetHF when max >= targetHF
  assert.equal(clampTrigger(1.58, 1.2, 1.6, 1.55), 1.54);

  // Invalid band
  assert.equal(clampTrigger(1.3, 1.5, 1.2, 1.6), null);
  assert.equal(clampTrigger(1.3, -1, 1.5, 1.6), null);
  assert.equal(clampTrigger(1.3, 1.4, 1.5, 1.35), null);
});

test("shouldUpdateDynamicTrigger: hysteresis logic", () => {
  const now = new Date("2026-10-25T12:00:00Z");

  // Case 1: No active dynamic trigger -> update
  const res1 = shouldUpdateDynamicTrigger({
    targetTriggerHf: 1.45,
    currentTriggerHf: null,
    currentValidUntil: null,
    now,
  });
  assert.equal(res1.shouldUpdate, true);
  assert.equal(res1.reason, "no_active_dynamic_trigger");

  // Case 2: Expired dynamic trigger -> update
  const res2 = shouldUpdateDynamicTrigger({
    targetTriggerHf: 1.45,
    currentTriggerHf: 1.4,
    currentValidUntil: Math.floor(now.getTime() / 1000) - 10,
    now,
  });
  assert.equal(res2.shouldUpdate, true);

  // Case 3: Delta >= 0.02 -> update
  const res3 = shouldUpdateDynamicTrigger({
    targetTriggerHf: 1.45,
    currentTriggerHf: 1.4,
    currentValidUntil: Math.floor(now.getTime() / 1000) + 7200,
    now,
  });
  assert.equal(res3.shouldUpdate, true);
  assert.match(res3.reason, /^delta_exceeded_/);

  // Case 4: Delta < 0.02 and expires in > 30 mins -> holds (no update)
  const res4 = shouldUpdateDynamicTrigger({
    targetTriggerHf: 1.41,
    currentTriggerHf: 1.4,
    currentValidUntil: Math.floor(now.getTime() / 1000) + 3600, // 60 mins remaining
    now,
  });
  assert.equal(res4.shouldUpdate, false);
  assert.equal(res4.reason, "hysteresis_holds");

  // Case 5: Delta < 0.02 but expires within 30 mins -> update
  const res5 = shouldUpdateDynamicTrigger({
    targetTriggerHf: 1.41,
    currentTriggerHf: 1.4,
    currentValidUntil: Math.floor(now.getTime() / 1000) + 900, // 15 mins remaining
    now,
  });
  assert.equal(res5.shouldUpdate, true);
  assert.match(res5.reason, /^expiring_in_/);
});

test("computeValidUntil: min(now + 2h, assessment.validUntil)", () => {
  const now = new Date("2026-10-25T12:00:00Z");

  // Assessment valid for 4h -> capped at now + 2h
  const assessmentLong = new Date("2026-10-25T16:00:00Z");
  const expectedLongSec = Math.floor(now.getTime() / 1000) + 7200;
  assert.equal(computeValidUntil(assessmentLong, now), expectedLongSec);

  // Assessment valid for 1h -> uses assessment expiry
  const assessmentShort = new Date("2026-10-25T13:00:00Z");
  const expectedShortSec = Math.floor(assessmentShort.getTime() / 1000);
  assert.equal(computeValidUntil(assessmentShort, now), expectedShortSec);
});

// ─────────────────────────────────────────────────────────────────────────────
// DynamicTriggerService integration tests
// ─────────────────────────────────────────────────────────────────────────────

test("DynamicTriggerService: skips when riskAgent differs from engine / ChainConfig", async () => {
  const db = new InMemorySentinelDatabase();
  const now = new Date("2026-10-25T12:00:00Z");

  db.latestRiskAssessment = {
    id: "ass-1",
    regime: "ELEVATED",
    validUntil: new Date("2026-10-25T14:00:00Z"),
    recommendedTriggerHf: 1.45,
    explanation: "elevated volatility",
  };

  const service = new DynamicTriggerService({
    chainId: ARBITRUM_SEPOLIA.chainId,
    db,
    mode: "dry-run",
    riskAgentAddress: RISK_AGENT_ADDR,
    now: () => now,
  });

  // Policy with unauthorized risk agent (e.g. 0x222...)
  const policy = createTestPolicy({
    riskAgent: "0x2222222222222222222222222222222222222222" as Address,
  });

  const decision = await service.evaluatePolicy(policy);
  assert.equal(decision.status, "skipped");
  assert.match(decision.reason, /skipped_unauthorized_risk_agent/);
});

test("DynamicTriggerService: stale or missing assessment means no write (static stays)", async () => {
  const db = new InMemorySentinelDatabase();
  const now = new Date("2026-10-25T12:00:00Z");

  const service = new DynamicTriggerService({
    chainId: ARBITRUM_SEPOLIA.chainId,
    db,
    mode: "dry-run",
    riskAgentAddress: RISK_AGENT_ADDR,
    now: () => now,
  });

  const policy = createTestPolicy();

  // 1. Missing assessment
  const decisionMissing = await service.evaluatePolicy(policy);
  assert.equal(decisionMissing.status, "skipped");
  assert.equal(decisionMissing.reason, "skipped_missing_risk_assessment");

  // 2. Stale assessment (validUntil in past)
  db.latestRiskAssessment = {
    id: "ass-stale",
    regime: "CALM",
    validUntil: new Date("2026-10-25T11:00:00Z"), // 1h ago
    recommendedTriggerHf: 1.4,
    explanation: "stale data",
  };

  const decisionStale = await service.evaluatePolicy(policy);
  assert.equal(decisionStale.status, "skipped");
  assert.equal(decisionStale.reason, "skipped_stale_risk_assessment");
});

test("DynamicTriggerService: clamps recommended trigger to band and below target", async () => {
  const db = new InMemorySentinelDatabase();
  const now = new Date("2026-10-25T12:00:00Z");

  // Recommendation 1.55 exceeds band max 1.50
  db.latestRiskAssessment = {
    id: "ass-high",
    regime: "CRISIS",
    validUntil: new Date("2026-10-25T14:00:00Z"),
    recommendedTriggerHf: 1.55,
    explanation: "market turmoil",
  };

  const logs: string[] = [];
  const service = new DynamicTriggerService({
    chainId: ARBITRUM_SEPOLIA.chainId,
    db,
    mode: "dry-run",
    riskAgentAddress: RISK_AGENT_ADDR,
    logger: {
      info: (m) => logs.push(m),
      warn: () => {},
      error: () => {},
    },
    now: () => now,
  });

  const policy = createTestPolicy({
    minTriggerHf: 1.2,
    maxTriggerHf: 1.5,
    targetHealthFactor: 1.6,
  });

  const decision = await service.evaluatePolicy(policy);
  assert.equal(decision.status, "dry_run");
  // Clamped to band max: 1.50
  assert.equal(decision.targetTriggerHf, 1.5);
});

test("DynamicTriggerService: dry-run computes and logs but sends no transactions", async () => {
  const db = new InMemorySentinelDatabase();
  const now = new Date("2026-10-25T12:00:00Z");

  db.latestRiskAssessment = {
    id: "ass-1",
    regime: "ELEVATED",
    validUntil: new Date("2026-10-25T14:00:00Z"),
    recommendedTriggerHf: 1.45,
    explanation: "elevated volatility",
  };

  let writeCalled = false;
  const fakeWalletClient: any = {
    async writeContract() {
      writeCalled = true;
      return "0xtxhash";
    },
  };

  const logs: string[] = [];
  const service = new DynamicTriggerService({
    chainId: ARBITRUM_SEPOLIA.chainId,
    db,
    mode: "dry-run",
    walletClient: fakeWalletClient,
    riskAgentAddress: RISK_AGENT_ADDR,
    logger: {
      info: (m) => logs.push(m),
      warn: () => {},
      error: () => {},
    },
    now: () => now,
  });

  const policy = createTestPolicy();
  const decision = await service.evaluatePolicy(policy);

  assert.equal(decision.status, "dry_run");
  assert.equal(decision.targetTriggerHf, 1.45);
  assert.equal(writeCalled, false, "Dry run must NOT broadcast transactions");
  assert.ok(logs.some((l) => l.includes("[dry-run]")));
});

test("DynamicTriggerService: live mode simulates with eth_call before writing and sends alert on success", async () => {
  const db = new InMemorySentinelDatabase();
  const now = new Date("2026-10-25T12:00:00Z");

  db.latestRiskAssessment = {
    id: "ass-1",
    regime: "STRESSED",
    validUntil: new Date("2026-10-25T14:00:00Z"),
    recommendedTriggerHf: 1.45,
    explanation: "elevated liquidation risk",
  };

  let simulateCalled = false;
  let writeCalled = false;
  const fakeClient: any = {
    async simulateContract(params: any) {
      simulateCalled = true;
      assert.equal(params.functionName, "setDynamicTrigger");
      return { request: {} };
    },
  };

  const fakeWalletClient: any = {
    async writeContract(params: any) {
      writeCalled = true;
      assert.equal(params.functionName, "setDynamicTrigger");
      return "0xsuccess_tx_hash";
    },
  };

  const sentAlerts: string[] = [];
  const fakeTelegram: any = {
    async send(_chatId: string, msg: string) {
      sentAlerts.push(msg);
    },
  };

  db.linkedTelegram.set("user-1", ["12345678"]);

  const service = new DynamicTriggerService({
    chainId: ARBITRUM_SEPOLIA.chainId,
    db,
    client: fakeClient,
    walletClient: fakeWalletClient,
    mode: "live",
    riskAgentAddress: RISK_AGENT_ADDR,
    channelAdapter: fakeTelegram,
    now: () => now,
  });

  // Inject a mock account matching RISK_AGENT_ADDR
  (service as any).account = { address: RISK_AGENT_ADDR };

  const policy = createTestPolicy();
  const decision = await service.evaluatePolicy(policy);

  assert.equal(decision.status, "executed");
  assert.equal(decision.txHash, "0xsuccess_tx_hash");
  assert.equal(simulateCalled, true, "Must simulate before writing");
  assert.equal(writeCalled, true, "Must call writeContract");
  assert.equal(sentAlerts.length, 1, "Must dispatch telegram alert on success");
  assert.match(sentAlerts[0]!, /TRIGGER DINAMIS DIPERBARUI|DYNAMIC TRIGGER UPDATED/);
  assert.match(sentAlerts[0]!, /STRESSED/);
});

test("DynamicTriggerService: simulation failure records failure without throwing", async () => {
  const db = new InMemorySentinelDatabase();
  const now = new Date("2026-10-25T12:00:00Z");

  db.latestRiskAssessment = {
    id: "ass-1",
    regime: "ELEVATED",
    validUntil: new Date("2026-10-25T14:00:00Z"),
    recommendedTriggerHf: 1.45,
    explanation: "elevated volatility",
  };

  const fakeClient: any = {
    async simulateContract() {
      throw new Error("execution reverted: InvalidTrigger");
    },
  };

  let writeCalled = false;
  const fakeWalletClient: any = {
    async writeContract() {
      writeCalled = true;
      return "0xtx";
    },
  };

  const service = new DynamicTriggerService({
    chainId: ARBITRUM_SEPOLIA.chainId,
    db,
    client: fakeClient,
    walletClient: fakeWalletClient,
    mode: "live",
    riskAgentAddress: RISK_AGENT_ADDR,
    now: () => now,
  });

  (service as any).account = { address: RISK_AGENT_ADDR };

  const policy = createTestPolicy();
  const decision = await service.evaluatePolicy(policy);

  assert.equal(decision.status, "failed");
  assert.equal(decision.reason, "simulation_failed");
  assert.match(decision.error!, /InvalidTrigger/);
  assert.equal(writeCalled, false, "Must not broadcast if simulation fails");
});

test("SentinelWorker: dynamic trigger evaluation in sentinel tick does not break on failure (I6)", async () => {
  const db = new InMemorySentinelDatabase();
  const now = new Date("2026-10-25T12:00:00Z");

  // Upsert user and policy into in-memory DB
  const userId = await db.upsertUser(USER_ADDR, ARBITRUM_SEPOLIA.chainId);
  await db.upsertPolicy({
    userId,
    chainId: ARBITRUM_SEPOLIA.chainId,
    guardianAddress: GUARDIAN_V4_ADDR,
    debtAsset: USDC_ADDR,
    triggerThreshold: 1.3,
    targetHealthFactor: 1.6,
    maxRepayPerAction: 1000n * 10n ** 6n,
    guardianVersion: 4,
    protocol: "aave-v3",
  });
  await db.updateTriggerBand({
    userId,
    guardianAddress: GUARDIAN_V4_ADDR,
    minTriggerHf: 1.2,
    maxTriggerHf: 1.5,
    riskAgent: RISK_AGENT_ADDR,
  });

  db.latestRiskAssessment = {
    id: "ass-1",
    regime: "ELEVATED",
    validUntil: new Date("2026-10-25T14:00:00Z"),
    recommendedTriggerHf: 1.45,
    explanation: "elevated volatility",
  };

  // Mock a dynamicTriggerService whose evaluateAll throws an error
  const failingService: any = {
    async evaluateAll() {
      throw new Error("RPC network timeout");
    },
  };

  const worker = new SentinelWorker({
    db,
    chainId: ARBITRUM_SEPOLIA.chainId,
    dynamicTriggerService: failingService,
    multicallLoader: async () => [
      {
        accountData: {
          collateralBase: 10_000n * 10n ** 8n,
          debtBase: 5000n * 10n ** 8n,
          liquidationThresholdBps: 8500n,
          healthFactor: 17n * 10n ** 17n, // 1.70
        },
        allowance: 1000n * 10n ** 6n,
        balance: 1000n * 10n ** 6n,
        quoteAmount: 0n,
      },
    ],
    clock: {
      now: () => now,
      setTimeout: () => {},
      clearTimeout: () => {},
    },
  });

  // Tick must execute cleanly and not throw
  const res = await worker.tick();
  assert.equal(res.checkedUsers, 1);
  assert.ok(Array.isArray(res.dynamicTriggerActions));
  assert.equal(res.dynamicTriggerActions.length, 0);
});

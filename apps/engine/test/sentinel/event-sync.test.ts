import test from "node:test";
import assert from "node:assert/strict";
import { encodeEventTopics, encodeAbiParameters, parseAbiItem } from "viem";
import { hfToWad } from "@tahansoe/domain";
import { syncGuardianEvents } from "../../src/sentinel/event-sync.ts";
import { InMemorySentinelDatabase } from "../../src/sentinel/db-adapter.ts";
import type { ChannelAdapter, InboundMessage } from "../../src/gateway/core/adapter.ts";

class FakeChannelAdapter implements ChannelAdapter {
  readonly channelName = "telegram";
  public sentMessages: Array<{ chatId: string; message: string; options?: any }> = [];

  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  async send(chatId: string, message: string, options?: any): Promise<void> {
    this.sentMessages.push({ chatId, message, options });
  }
  onMessage(_handler: (msg: InboundMessage) => Promise<void>): void {}
}

test("event-sync: memproses PolicySet dan PolicyDisabled ke database", async () => {
  const db = new InMemorySentinelDatabase();
  const adapter = new FakeChannelAdapter();

  const user = "0x1111111111111111111111111111111111111111";
  const debtAsset = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d";
  const guardian = "0x1A5D249A8e711E2288AdD7c01e31Eb7FFB05D97E";

  const policySetAbi = parseAbiItem(
    "event PolicySet(address indexed user, address indexed debtAsset, uint256 triggerHF, uint256 targetHF, uint256 maxRepayPerAction)",
  );

  const policySetTopics = encodeEventTopics({
    abi: [policySetAbi],
    eventName: "PolicySet",
    args: {
      user: user as `0x${string}`,
      debtAsset: debtAsset as `0x${string}`,
    },
  });

  const policySetData = encodeAbiParameters(
    [
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
    ],
    [hfToWad(1.30), hfToWad(1.60), 500_000_000n],
  );

  const fakeClient: any = {
    async getBlockNumber() {
      return 313944200n;
    },
    async getLogs() {
      return [
        {
          address: guardian,
          topics: policySetTopics,
          data: policySetData,
          blockNumber: 313944180n,
        },
      ];
    },
  };

  const res = await syncGuardianEvents({
    client: fakeClient,
    db,
    chainId: 421614,
    channelAdapter: adapter,
  });

  assert.equal(res.logsProcessed, 1);

  // Verifikasi user terbuat
  const userId = await db.upsertUser(user as any, 421614);
  assert.ok(userId);

  // Verifikasi policy tersimpan
  const activePolicies = await db.loadActivePolicies(421614);
  assert.equal(activePolicies.length, 1);
  const pol = activePolicies[0]!;
  assert.equal(pol.userAddress, user.toLowerCase());
  assert.equal(pol.debtAsset, debtAsset.toLowerCase());
  assert.equal(pol.triggerThreshold, 1.30);
  assert.equal(pol.targetHealthFactor, 1.60);
  assert.equal(pol.maxRepayPerAction, 500_000_000n);
  assert.equal(pol.isActive, true);

  // Verifikasi cursor tersimpan
  const cursor = await db.getCursor(421614, guardian as any, "events");
  assert.equal(cursor, 313944200n);

  // Sekarang simulasikan event PolicyDisabled
  const policyDisabledAbi = parseAbiItem("event PolicyDisabled(address indexed user)");
  const disabledTopics = encodeEventTopics({
    abi: [policyDisabledAbi],
    eventName: "PolicyDisabled",
    args: {
      user: user as `0x${string}`,
    },
  });

  const fakeClientDisabled: any = {
    async getBlockNumber() {
      return 313944250n;
    },
    async getLogs() {
      return [
        {
          address: guardian,
          topics: disabledTopics,
          data: "0x",
          blockNumber: 313944220n,
        },
      ];
    },
  };

  await syncGuardianEvents({
    client: fakeClientDisabled,
    db,
    chainId: 421614,
    channelAdapter: adapter,
  });

  const activeAfterDisable = await db.loadActivePolicies(421614);
  assert.equal(activeAfterDisable.length, 0);

  const updatedCursor = await db.getCursor(421614, guardian as any, "events");
  assert.equal(updatedCursor, 313944250n);
});

test("event-sync: memproses Protected event dan mengirim alert Telegram", async () => {
  const db = new InMemorySentinelDatabase();
  const adapter = new FakeChannelAdapter();

  const user = "0x2222222222222222222222222222222222222222";
  const debtAsset = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d";
  const caller = "0x9999999999999999999999999999999999999999";
  const guardian = "0x1A5D249A8e711E2288AdD7c01e31Eb7FFB05D97E";

  const userId = await db.upsertUser(user as any, 421614);
  db.linkedTelegram.set(userId, ["123456789"]);

  const protectedAbi = parseAbiItem(
    "event Protected(address indexed user, address indexed debtAsset, address indexed caller, uint256 repaid, uint256 healthFactorBefore, uint256 healthFactorAfter)",
  );

  const protectedTopics = encodeEventTopics({
    abi: [protectedAbi],
    eventName: "Protected",
    args: {
      user: user as `0x${string}`,
      debtAsset: debtAsset as `0x${string}`,
      caller: caller as `0x${string}`,
    },
  });

  const protectedData = encodeAbiParameters(
    [
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
    ],
    [250_000_000n, hfToWad(1.15), hfToWad(1.61)],
  );

  const fakeClient: any = {
    async getBlockNumber() {
      return 313944300n;
    },
    async getLogs() {
      return [
        {
          address: guardian,
          topics: protectedTopics,
          data: protectedData,
          blockNumber: 313944280n,
        },
      ];
    },
  };

  await syncGuardianEvents({
    client: fakeClient,
    db,
    chainId: 421614,
    channelAdapter: adapter,
  });

  assert.equal(adapter.sentMessages.length, 1);
  assert.equal(adapter.sentMessages[0]!.chatId, "123456789");
  assert.match(adapter.sentMessages[0]!.message, /EKSEKUSI PROTEKSI BERHASIL|PROTECTION EXECUTED/);
  assert.equal(db.notifications.length, 1);
  assert.equal(db.notifications[0]!.type, "EXECUTION_SUCCESS");
});

test("event-sync: memproses v2 Layer dan TriggerBand events", async () => {
  const db = new InMemorySentinelDatabase();
  const user = "0x3333333333333333333333333333333333333333";
  const guardian = "0x1A5D249A8e711E2288AdD7c01e31Eb7FFB05D97E";

  const userId = await db.upsertUser(user as any, 421614);
  await db.upsertPolicy({
    userId,
    chainId: 421614,
    guardianAddress: guardian as any,
    guardianVersion: 2,
    debtAsset: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
    maxRepayPerAction: 100n,
    triggerThreshold: 1.3,
    targetHealthFactor: 1.6,
  });

  const triggerBandAbi = parseAbiItem(
    "event TriggerBandSet(address indexed user, uint256 minTriggerHF, uint256 maxTriggerHF, address riskAgent)",
  );

  const bandTopics = encodeEventTopics({
    abi: [triggerBandAbi],
    eventName: "TriggerBandSet",
    args: {
      user: user as `0x${string}`,
    },
  });

  const bandData = encodeAbiParameters(
    [
      { type: "uint256" },
      { type: "uint256" },
      { type: "address" },
    ],
    [
      hfToWad(1.25),
      hfToWad(1.55),
      "0x8888888888888888888888888888888888888888" as `0x${string}`,
    ],
  );

  const fakeClient: any = {
    async getBlockNumber() {
      return 313944400n;
    },
    async getLogs() {
      return [
        {
          address: guardian,
          topics: bandTopics,
          data: bandData,
          blockNumber: 313944350n,
        },
      ];
    },
  };

  await syncGuardianEvents({
    client: fakeClient,
    db,
    chainId: 421614,
  });

  const policies = await db.loadActivePolicies(421614);
  assert.equal(policies.length, 1);
  assert.equal(policies[0]!.minTriggerHf, 1.25);
  assert.equal(policies[0]!.maxTriggerHf, 1.55);
  assert.equal(policies[0]!.riskAgent, "0x8888888888888888888888888888888888888888");
});

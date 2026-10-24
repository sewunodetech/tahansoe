import test from "node:test";
import assert from "node:assert/strict";
import { encodeEventTopics, encodeAbiParameters, parseAbiItem } from "viem";
import { hfToWad } from "@tahansoe/domain";
import { syncGuardianEvents } from "../../src/sentinel/event-sync.ts";
import { InMemorySentinelDatabase } from "../../src/sentinel/db-adapter.ts";
import type { TelegramSender } from "../../src/telegram/index.ts";

class FakeChannelAdapter implements TelegramSender {
  readonly channelName = "telegram";
  public sentMessages: Array<{ chatId: string; message: string; options?: any }> = [];

  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  async send(chatId: string | number | bigint, message: string, options?: any): Promise<void> {
    this.sentMessages.push({ chatId: String(chatId), message, options });
  }
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


test("event-sync: memproses event v4 Aave (PolicySet, Protected, FeeCharged, PolicyDisabled)", async () => {
  const db = new InMemorySentinelDatabase();
  const adapter = new FakeChannelAdapter();

  const user = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const debtAsset = "0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d";
  // TahansoeGuardianAaveV4 di registry Arbitrum Sepolia.
  const guardian = "0xa7bbab6366a723e17cd2f220d708757e449571b4";

  const userId = await db.upsertUser(user as any, 421614);
  db.linkedTelegram.set(userId, ["chat_v4_aave"]);

  // 1. Simulasikan PolicySet (Aave v4)
  const policySetAbi = parseAbiItem(
    "event PolicySet(address indexed user, address indexed debtAsset, uint256 triggerHF, uint256 targetHF, uint256 maxRepayPerAction)",
  );
  const setTopics = encodeEventTopics({
    abi: [policySetAbi],
    eventName: "PolicySet",
    args: { user: user as any, debtAsset: debtAsset as any },
  });
  const setData = encodeAbiParameters(
    [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
    [hfToWad(1.30), hfToWad(1.60), 500_000_000n],
  );

  // 2. Simulasikan Protected & FeeCharged dalam tx yang sama
  const protectedAbi = parseAbiItem(
    "event Protected(address indexed user, address indexed debtAsset, address indexed caller, uint256 repaid, uint256 healthFactorBefore, uint256 healthFactorAfter)",
  );
  const protTopics = encodeEventTopics({
    abi: [protectedAbi],
    eventName: "Protected",
    args: {
      user: user as any,
      debtAsset: debtAsset as any,
      caller: "0x9999999999999999999999999999999999999999",
    },
  });
  const protData = encodeAbiParameters(
    [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
    [200_000_000n, hfToWad(1.10), hfToWad(1.50)],
  );

  const feeChargedAbi = parseAbiItem(
    "event FeeCharged(address indexed user, address indexed debtAsset, uint256 amount, uint256 waived)",
  );
  const feeTopics = encodeEventTopics({
    abi: [feeChargedAbi],
    eventName: "FeeCharged",
    args: { user: user as any, debtAsset: debtAsset as any },
  });
  const feeData = encodeAbiParameters(
    [{ type: "uint256" }, { type: "uint256" }],
    [300_000n, 0n], // 0.3 USDC fee
  );

  const txHash = "0x1111111111111111111111111111111111111111111111111111111111111111";

  const fakeClient: any = {
    async getBlockNumber() {
      return 322451900n;
    },
    async getLogs(params: { address?: string }) {
      // Hanya Guardian v4 yang memancarkan event; Guardian v1 di registry tidak punya log.
      if (params?.address?.toLowerCase() !== guardian) return [];
      return [
        {
          address: guardian,
          topics: setTopics,
          data: setData,
          blockNumber: 313944210n,
          transactionHash: "0xsethash",
        },
        {
          address: guardian,
          topics: feeTopics,
          data: feeData,
          blockNumber: 313944220n,
          transactionHash: txHash,
        },
        {
          address: guardian,
          topics: protTopics,
          data: protData,
          blockNumber: 313944220n,
          transactionHash: txHash,
        },
      ];
    },
  };

  const syncRes = await syncGuardianEvents({
    client: fakeClient,
    db,
    chainId: 421614,
    channelAdapter: adapter,
    chunkSize: 100_000_000n,
  });

  assert.equal(syncRes.logsProcessed, 3);

  // Verifikasi policy aktif tersimpan dengan positionKey
  const policies = await db.loadActivePolicies(421614);
  assert.equal(policies.length, 1);
  assert.ok(policies[0]!.positionKey);
  assert.equal(policies[0]!.protocol, "aave-v3");

  // Verifikasi alert telegram terkirim dengan detail protokol, posisi, dan fee
  assert.equal(adapter.sentMessages.length, 1);
  const msg = adapter.sentMessages[0]!.message;
  assert.match(msg, /Aave V3/);
  assert.match(msg, /Fee:/);
  assert.match(msg, /200\.00/);

  // 3. Simulasikan PolicyDisabled (v4 per debt asset)
  const policyDisabledAbi = parseAbiItem(
    "event PolicyDisabled(address indexed user, address indexed debtAsset)",
  );
  const disTopics = encodeEventTopics({
    abi: [policyDisabledAbi],
    eventName: "PolicyDisabled",
    args: { user: user as any, debtAsset: debtAsset as any },
  });

  const fakeClientDis: any = {
    async getBlockNumber() {
      return 322452000n;
    },
    async getLogs(params: { address?: string }) {
      if (params?.address?.toLowerCase() !== guardian) return [];
      return [
        {
          address: guardian,
          topics: disTopics,
          data: "0x",
          blockNumber: 322451950n,
        },
      ];
    },
  };

  await syncGuardianEvents({
    client: fakeClientDis,
    db,
    chainId: 421614,
    chunkSize: 100_000_000n,
  });

  const remaining = await db.loadActivePolicies(421614);
  assert.equal(remaining.length, 0);
});

test("event-sync: memproses event v4 Morpho (PolicySet, Protected, FeeCharged, PolicyDisabled)", async () => {
  const db = new InMemorySentinelDatabase();
  const adapter = new FakeChannelAdapter();

  const user = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const marketId = "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
  const guardian = "0x1a5d249a8e711e2288add7c01e31eb7ffb05d97e";

  const userId = await db.upsertUser(user as any, 421614);
  db.linkedTelegram.set(userId, ["chat_v4_morpho"]);

  // 1. Simulasikan PolicySet (Morpho)
  const policySetMorphoAbi = parseAbiItem(
    "event PolicySet(address indexed user, bytes32 indexed marketId, uint256 triggerHF, uint256 targetHF, uint256 maxRepayPerAction)",
  );
  const setTopics = encodeEventTopics({
    abi: [policySetMorphoAbi],
    eventName: "PolicySet",
    args: { user: user as any, marketId: marketId as any },
  });
  const setData = encodeAbiParameters(
    [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
    [hfToWad(1.20), hfToWad(1.50), 1000_000_000n],
  );

  // 2. Simulasikan Protected & FeeCharged (Morpho)
  const protectedMorphoAbi = parseAbiItem(
    "event Protected(address indexed user, bytes32 indexed marketId, address indexed caller, uint256 repaid, uint256 healthFactorBefore, uint256 healthFactorAfter)",
  );
  const protTopics = encodeEventTopics({
    abi: [protectedMorphoAbi],
    eventName: "Protected",
    args: {
      user: user as any,
      marketId: marketId as any,
      caller: "0x9999999999999999999999999999999999999999",
    },
  });
  const protData = encodeAbiParameters(
    [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
    [400_000_000n, hfToWad(1.10), hfToWad(1.45)],
  );

  const feeChargedMorphoAbi = parseAbiItem(
    "event FeeCharged(address indexed user, bytes32 indexed marketId, uint256 amount, uint256 waived)",
  );
  const feeTopics = encodeEventTopics({
    abi: [feeChargedMorphoAbi],
    eventName: "FeeCharged",
    args: { user: user as any, marketId: marketId as any },
  });
  const feeData = encodeAbiParameters(
    [{ type: "uint256" }, { type: "uint256" }],
    [600_000n, 0n],
  );

  const txHash = "0x2222222222222222222222222222222222222222222222222222222222222222";

  const fakeClient: any = {
    async getBlockNumber() {
      return 313944300n;
    },
    async getLogs() {
      return [
        {
          address: guardian,
          topics: setTopics,
          data: setData,
          blockNumber: 313944210n,
          transactionHash: "0xsetmorpho",
        },
        {
          address: guardian,
          topics: feeTopics,
          data: feeData,
          blockNumber: 313944220n,
          transactionHash: txHash,
        },
        {
          address: guardian,
          topics: protTopics,
          data: protData,
          blockNumber: 313944220n,
          transactionHash: txHash,
        },
      ];
    },
  };

  const syncRes = await syncGuardianEvents({
    client: fakeClient,
    db,
    chainId: 421614,
    channelAdapter: adapter,
  });

  assert.equal(syncRes.logsProcessed, 3);

  // Verifikasi policy Morpho tersimpan
  const policies = await db.loadActivePolicies(421614);
  assert.equal(policies.length, 1);
  assert.equal(policies[0]!.protocol, "morpho-blue");
  assert.equal(policies[0]!.marketId, marketId);
  assert.ok(policies[0]!.positionKey?.startsWith("morpho-blue:"));

  // Verifikasi receipt telegram mencantumkan Morpho Blue, market short id, dan fee
  assert.equal(adapter.sentMessages.length, 1);
  const msg = adapter.sentMessages[0]!.message;
  assert.match(msg, /Morpho Blue/);
  assert.match(msg, /Market/);
  assert.match(msg, /Fee:/);
});

test("event-sync: dua policy v4 untuk aset utang berbeda tersimpan terpisah; policy v2 tetap satu per Guardian", async () => {
  const db = new InMemorySentinelDatabase();
  const user = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const usdc = "0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d";
  const weth = "0x1df462e2712496373a347f8ad10802a5e95f053d";
  const v4 = "0xa7bbab6366a723e17cd2f220d708757e449571b4";
  const v1 = "0x1a5d249a8e711e2288add7c01e31eb7ffb05d97e";

  const policySetAbi = parseAbiItem(
    "event PolicySet(address indexed user, address indexed debtAsset, uint256 triggerHF, uint256 targetHF, uint256 maxRepayPerAction)",
  );
  const policySetLog = (address: string, debtAsset: string, block: bigint, logIndex: number) => ({
    address,
    topics: encodeEventTopics({
      abi: [policySetAbi],
      eventName: "PolicySet",
      args: { user: user as any, debtAsset: debtAsset as any },
    }),
    data: encodeAbiParameters(
      [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
      [hfToWad(1.3), hfToWad(1.6), 1_000_000n],
    ),
    blockNumber: block,
    transactionHash: `0x${String(logIndex).padStart(64, "0")}`,
    logIndex,
  });

  const logsByGuardian: Record<string, any[]> = {
    // Guardian v1 (klasik): user ganti aset utang dari USDC ke WETH, tetap satu policy.
    [v1]: [policySetLog(v1, usdc, 313944200n, 1), policySetLog(v1, weth, 313944250n, 2)],
    // Guardian v4: dua posisi berbeda pada Guardian yang sama.
    [v4]: [policySetLog(v4, usdc, 322451800n, 3), policySetLog(v4, weth, 322451850n, 4)],
  };
  const fakeClient: any = {
    async getBlockNumber() {
      return 322451900n;
    },
    async getLogs(params: { address?: string }) {
      return logsByGuardian[params?.address?.toLowerCase() ?? ""] ?? [];
    },
  };

  await syncGuardianEvents({ client: fakeClient, db, chainId: 421614, chunkSize: 100_000_000n });

  const active = await db.loadActivePolicies(421614);
  const onV4 = active.filter((p) => p.guardianAddress === v4);
  const onV1 = active.filter((p) => p.guardianAddress === v1);
  assert.equal(onV4.length, 2, "v4 menyimpan satu policy per aset utang");
  assert.deepEqual(onV4.map((p) => p.debtAsset).sort(), [weth, usdc].sort());
  assert.equal(onV1.length, 1, "v1 tetap satu policy per user per Guardian");
  assert.equal(onV1[0]!.debtAsset, weth, "policy v1 terakhir menimpa yang sebelumnya");
});

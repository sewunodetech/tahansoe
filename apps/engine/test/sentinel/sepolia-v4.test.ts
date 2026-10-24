import test from "node:test";
import assert from "node:assert/strict";
import { encodeEventTopics, encodeAbiParameters, parseAbiItem } from "viem";
import { ARBITRUM_SEPOLIA, hfToWad, wadToNumber, type Address } from "@tahansoe/domain";
import {
  getGuardiansForChain,
  createGuardianAdaptersForChain,
  V2V3GuardianAdapter,
  AaveV4GuardianAdapter,
  buildPositionKey,
} from "../../src/sentinel/adapters.ts";
import { syncGuardianEvents } from "../../src/sentinel/event-sync.ts";
import { InMemorySentinelDatabase } from "../../src/sentinel/db-adapter.ts";
import { Keeper } from "../../src/sentinel/keeper.ts";

test("sepolia-v4: real ARBITRUM_SEPOLIA configuration discovery (v1 + v4)", () => {
  // 1. Verifikasi konfigurasi guardian di chain registry ARBITRUM_SEPOLIA
  assert.ok(ARBITRUM_SEPOLIA.guardians, "ARBITRUM_SEPOLIA harus memiliki guardians array");
  assert.equal(ARBITRUM_SEPOLIA.guardians.length, 2, "Harus ada 2 guardian terdaftar (v1 dan v4)");

  const v1Config = ARBITRUM_SEPOLIA.guardians[0]!;
  assert.equal(v1Config.version, 1);
  assert.equal(v1Config.address.toLowerCase(), "0x1a5d249a8e711e2288add7c01e31eb7ffb05d97e");
  assert.equal(v1Config.deployedBlock, 313944170);
  assert.equal(v1Config.protocol ?? "aave-v3", "aave-v3");

  const v4Config = ARBITRUM_SEPOLIA.guardians[1]!;
  assert.equal(v4Config.version, 4);
  assert.equal(v4Config.address.toLowerCase(), "0xa7bbab6366a723e17cd2f220d708757e449571b4");
  assert.equal(v4Config.deployedBlock, 322451784);
  assert.equal(v4Config.protocol, "aave-v3");

  // 2. getGuardiansForChain menghasilkan kedua entri
  const guardians = getGuardiansForChain(ARBITRUM_SEPOLIA);
  assert.equal(guardians.length, 2);
  assert.equal(guardians[0]!.version, 1);
  assert.equal(guardians[1]!.version, 4);

  // 3. createGuardianAdaptersForChain membangun instance adapter yang tepat
  const adapters = createGuardianAdaptersForChain(ARBITRUM_SEPOLIA);
  assert.equal(adapters.length, 2);

  const adapter1 = adapters[0]!;
  assert.ok(adapter1 instanceof V2V3GuardianAdapter, "Guardian v1 harus menggunakan V2V3GuardianAdapter");
  assert.equal(adapter1.version, 1);
  assert.equal(adapter1.guardianAddress, v1Config.address.toLowerCase());
  assert.equal(adapter1.protocol, "aave-v3");

  const adapter4 = adapters[1]!;
  assert.ok(adapter4 instanceof AaveV4GuardianAdapter, "Guardian v4 harus menggunakan AaveV4GuardianAdapter");
  assert.equal(adapter4.version, 4);
  assert.equal(adapter4.guardianAddress, v4Config.address.toLowerCase());
  assert.equal(adapter4.protocol, "aave-v3");
});

test("sepolia-v4: positionKey format for Aave V4 on Arbitrum Sepolia", () => {
  const guardianAddress = "0xa7Bbab6366a723e17cd2f220D708757e449571b4";
  const debtAsset = "0x75faf114eafB1BDbe2F0316DF893fd58CE46AA4d"; // USDC Sepolia

  const posKey = buildPositionKey({
    protocol: "aave-v3",
    chainId: ARBITRUM_SEPOLIA.chainId,
    guardian: guardianAddress,
    key: debtAsset,
  });

  assert.equal(
    posKey,
    "aave-v3:421614:0xa7bbab6366a723e17cd2f220d708757e449571b4:0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d",
    "positionKey harus mengikuti format aave-v3:<chainId>:<guardian>:<debtAsset> lowercase",
  );
});

test("sepolia-v4: event sync start block for v4 = 322451784n when cursor is empty", async () => {
  const db = new InMemorySentinelDatabase();
  const queries: Array<{ address: Address; fromBlock: bigint; toBlock: bigint }> = [];

  const fakeClient: any = {
    async getBlockNumber() {
      return 322452000n;
    },
    async getLogs(params: any) {
      queries.push({
        address: params.address.toLowerCase(),
        fromBlock: params.fromBlock,
        toBlock: params.toBlock,
      });
      return [];
    },
  };

  await syncGuardianEvents({
    client: fakeClient,
    db,
    chainId: ARBITRUM_SEPOLIA.chainId,
  });

  // Memastikan getLogs dipanggil untuk kedua guardian
  const v1Query = queries.find((q) => q.address === "0x1a5d249a8e711e2288add7c01e31eb7ffb05d97e");
  assert.ok(v1Query, "Query log untuk guardian v1 harus ada");
  assert.equal(v1Query.fromBlock, 313944170n, "Start block untuk v1 harus dari deployedBlock 313944170");

  const v4Query = queries.find((q) => q.address === "0xa7bbab6366a723e17cd2f220d708757e449571b4");
  assert.ok(v4Query, "Query log untuk guardian v4 harus ada");
  assert.equal(v4Query.fromBlock, 322451784n, "Start block untuk v4 harus tepat dari deployedBlock 322451784");
});

test("sepolia-v4: event sync decodes v4 events into position_key-tagged rows", async () => {
  const db = new InMemorySentinelDatabase();
  const v4Guardian = "0xa7bbab6366a723e17cd2f220d708757e449571b4" as Address;
  const user = "0x4444444444444444444444444444444444444444" as Address;
  const usdc = "0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d" as Address;

  const expectedPositionKey = `aave-v3:421614:${v4Guardian}:${usdc}`;

  // 1. PolicySet v4
  const policySetAbi = parseAbiItem(
    "event PolicySet(address indexed user, address indexed debtAsset, uint256 triggerHF, uint256 targetHF, uint256 maxRepayPerAction)",
  );
  const setTopics = encodeEventTopics({
    abi: [policySetAbi],
    eventName: "PolicySet",
    args: { user, debtAsset: usdc },
  });
  const setData = encodeAbiParameters(
    [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
    [hfToWad(1.35), hfToWad(1.65), 1_000_000_000n],
  );

  // 2. LayerUsed v4
  const layerUsedAbi = parseAbiItem(
    "event LayerUsed(address indexed user, address indexed debtAsset, uint8 indexed layer, uint256 amountIn, uint256 debtRepaid)",
  );
  const layerTopics = encodeEventTopics({
    abi: [layerUsedAbi],
    eventName: "LayerUsed",
    args: { user, debtAsset: usdc, layer: 1 },
  });
  const layerData = encodeAbiParameters(
    [{ type: "uint256" }, { type: "uint256" }],
    [500_000_000n, 500_000_000n],
  );

  // 3. FeeCharged v4
  const feeChargedAbi = parseAbiItem(
    "event FeeCharged(address indexed user, address indexed debtAsset, uint256 amount, uint256 waived)",
  );
  const feeTopics = encodeEventTopics({
    abi: [feeChargedAbi],
    eventName: "FeeCharged",
    args: { user, debtAsset: usdc },
  });
  const feeData = encodeAbiParameters(
    [{ type: "uint256" }, { type: "uint256" }],
    [500_000n, 0n],
  );

  const fakeClient: any = {
    async getBlockNumber() {
      return 322452100n;
    },
    async getLogs(params: any) {
      if (params.address.toLowerCase() === v4Guardian) {
        return [
          {
            address: v4Guardian,
            topics: setTopics,
            data: setData,
            blockNumber: 322451800n,
            transactionHash: "0xtx1",
          },
          {
            address: v4Guardian,
            topics: feeTopics,
            data: feeData,
            blockNumber: 322451810n,
            transactionHash: "0xtx2",
          },
          {
            address: v4Guardian,
            topics: layerTopics,
            data: layerData,
            blockNumber: 322451810n,
            transactionHash: "0xtx2",
          },
        ];
      }
      return [];
    },
  };

  const logsLogged: string[] = [];
  await syncGuardianEvents({
    client: fakeClient,
    db,
    chainId: ARBITRUM_SEPOLIA.chainId,
    logger: {
      info: (m) => logsLogged.push(m),
      warn: () => {},
      error: () => {},
    },
  });

  // Verifikasi policy v4 tersimpan dengan positionKey tepat
  const active = await db.loadActivePolicies(ARBITRUM_SEPOLIA.chainId);
  assert.equal(active.length, 1);
  const pol = active[0]!;
  assert.equal(pol.guardianAddress, v4Guardian);
  assert.equal(pol.guardianVersion, 4);
  assert.equal(pol.positionKey, expectedPositionKey);
  assert.equal(pol.debtAsset, usdc);
  assert.equal(pol.triggerThreshold, 1.35);
  assert.equal(pol.targetHealthFactor, 1.65);
  assert.equal(pol.maxRepayPerAction, 1_000_000_000n);

  // Verifikasi LayerUsed dan FeeCharged mencatat positionKey
  const layerLog = logsLogged.find((l) => l.includes("LayerUsed"));
  assert.ok(layerLog, "Log LayerUsed harus tercatat");
  assert.ok(layerLog.includes(expectedPositionKey), "Log LayerUsed harus memuat positionKey");

  const feeLog = logsLogged.find((l) => l.includes("FeeCharged"));
  assert.ok(feeLog, "Log FeeCharged harus tercatat");
  assert.ok(feeLog.includes(expectedPositionKey), "Log FeeCharged harus memuat positionKey");

  // 4. PolicyDisabled v4 per debt asset
  const policyDisabledAbi = parseAbiItem(
    "event PolicyDisabled(address indexed user, address indexed debtAsset)",
  );
  const disTopics = encodeEventTopics({
    abi: [policyDisabledAbi],
    eventName: "PolicyDisabled",
    args: { user, debtAsset: usdc },
  });

  const fakeClientDis: any = {
    async getBlockNumber() {
      return 322452200n;
    },
    async getLogs(params: any) {
      if (params.address.toLowerCase() === v4Guardian) {
        return [
          {
            address: v4Guardian,
            topics: disTopics,
            data: "0x",
            blockNumber: 322451900n,
            transactionHash: "0xtx3",
          },
        ];
      }
      return [];
    },
  };

  await syncGuardianEvents({
    client: fakeClientDis,
    db,
    chainId: ARBITRUM_SEPOLIA.chainId,
  });

  const activeAfter = await db.loadActivePolicies(ARBITRUM_SEPOLIA.chainId);
  assert.equal(activeAfter.length, 0, "Policy harus dinonaktifkan setelah PolicyDisabled v4");
});

test("sepolia-v4: ABI isolation - v1 uses quoteRepay and 1-arg protect, v4 uses positionsPage and 2-arg protect", async () => {
  const v1Guardian = "0x1a5d249a8e711e2288add7c01e31eb7ffb05d97e" as Address;
  const v4Guardian = "0xa7bbab6366a723e17cd2f220d708757e449571b4" as Address;
  const user = "0x5555555555555555555555555555555555555555" as Address;
  const debtAsset = "0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d" as Address;

  const functionCalls: Array<{ address: string; fn: string; args: any[] }> = [];

  const fakeClient: any = {
    async readContract(params: any) {
      functionCalls.push({
        address: params.address.toLowerCase(),
        fn: params.functionName,
        args: params.args ?? [],
      });

      if (params.functionName === "usersPage") {
        throw new Error("usersPage called! v1 or v4 should not call usersPage if prohibited");
      }
      if (params.functionName === "positionsPage") {
        return [[user], [debtAsset]];
      }
      if (params.functionName === "quoteRepay") {
        return 100n;
      }
      if (params.functionName === "quoteProtect") {
        return [100n, 100n, 0n, 1600000000000000000n];
      }
      if (params.functionName === "needsProtection") {
        return true;
      }
      if (params.functionName === "debtAssetsOf") {
        return [debtAsset];
      }
      return null;
    },
  };

  const v1Adapter = new V2V3GuardianAdapter({
    chainId: ARBITRUM_SEPOLIA.chainId,
    guardianAddress: v1Guardian,
    version: 1,
    protocol: "aave-v3",
    client: fakeClient,
  });

  const v4Adapter = new AaveV4GuardianAdapter({
    chainId: ARBITRUM_SEPOLIA.chainId,
    guardianAddress: v4Guardian,
    version: 4,
    protocol: "aave-v3",
    client: fakeClient,
  });

  // 1. v1.getPositions() tidak boleh memanggil usersPage di v1
  const v1Positions = await v1Adapter.getPositions();
  assert.deepEqual(v1Positions, [], "v1.getPositions() harus return [] tanpa memanggil usersPage");

  // 2. v4.getPositions() memanggil positionsPage
  const v4Positions = await v4Adapter.getPositions();
  assert.equal(v4Positions.length, 1);
  assert.equal(v4Positions[0]!.user, user);
  assert.equal(v4Positions[0]!.key, debtAsset);

  // 3. v1.evaluateProtection memanggil quoteRepay(user), BUKAN quoteProtect
  const posForV1 = {
    user,
    key: debtAsset,
    positionKey: `aave-v3:421614:${v1Guardian}:${debtAsset}`,
    protocol: "aave-v3" as const,
    guardianAddress: v1Guardian,
  };
  const v1Quote = await v1Adapter.evaluateProtection(posForV1);
  assert.equal(v1Quote.needsProtection, true);
  assert.equal(v1Quote.quoteAmount, 100n);

  const lastV1Call = functionCalls.find((c) => c.address === v1Guardian && c.fn === "quoteRepay");
  assert.ok(lastV1Call, "v1 harus memanggil quoteRepay");
  assert.equal(lastV1Call.args[0], user);

  // 4. v4.evaluateProtection memanggil quoteProtect(user, debtAsset)
  const v4Quote = await v4Adapter.evaluateProtection(v4Positions[0]!);
  assert.equal(v4Quote.needsProtection, true);
  assert.equal(v4Quote.quoteAmount, 200n);

  const lastV4Call = functionCalls.find((c) => c.address === v4Guardian && c.fn === "quoteProtect");
  assert.ok(lastV4Call, "v4 harus memanggil quoteProtect");
  assert.equal(lastV4Call.args[0], user);
  assert.equal(lastV4Call.args[1], debtAsset);

  // 5. Keeper execution: pastikan protect(user) dipanggil untuk v1 dan protect(user, debtAsset) untuk v4
  const protectCalls: Array<{ guardian: string; user: string; key?: string }> = [];
  const keeper = new Keeper({
    protectCaller: async (g, u, k) => {
      protectCalls.push({ guardian: g.toLowerCase(), user: u.toLowerCase(), key: k?.toLowerCase() });
      return "0xhash";
    },
  });

  // Eksekusi v1
  await keeper.evaluateAndProtect({
    user,
    hf: 1.1,
    triggerHf: 1.3,
    quoteAmount: 100n,
    guardianAddress: v1Guardian,
    guardianVersion: 1,
    protocol: "aave-v3",
  });

  assert.equal(protectCalls.length, 1);
  assert.equal(protectCalls[0]!.guardian, v1Guardian);
  assert.equal(protectCalls[0]!.user, user);

  // Eksekusi v4
  await keeper.evaluateAndProtect({
    user,
    hf: 1.1,
    triggerHf: 1.3,
    quoteAmount: 200n,
    guardianAddress: v4Guardian,
    guardianVersion: 4,
    protocol: "aave-v3",
    key: debtAsset,
  });

  assert.equal(protectCalls.length, 2);
  assert.equal(protectCalls[1]!.guardian, v4Guardian);
  assert.equal(protectCalls[1]!.user, user);
  assert.equal(protectCalls[1]!.key, debtAsset);
});

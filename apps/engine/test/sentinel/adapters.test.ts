import test from "node:test";
import assert from "node:assert/strict";
import type { Address } from "@tahansoe/domain";
import {
  V2V3GuardianAdapter,
  AaveV4GuardianAdapter,
  MorphoGuardianAdapter,
  createGuardianAdapter,
  buildPositionKey,
  getGuardiansForChain,
} from "../../src/sentinel/adapters.ts";
import { Keeper } from "../../src/sentinel/keeper.ts";

test("adapters: buildPositionKey membentuk format standar huruf kecil", () => {
  const aaveKey = buildPositionKey({
    protocol: "aave-v3",
    chainId: 421614,
    guardian: "0x1A5D249A8E711E2288ADD7C01E31EB7FFB05D97E",
    key: "0x75FAf114eafB1BDbe2F0316DF893fd58CE46AA4d",
  });
  assert.equal(
    aaveKey,
    "aave-v3:421614:0x1a5d249a8e711e2288add7c01e31eb7ffb05d97e:0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d",
  );

  const morphoKey = buildPositionKey({
    protocol: "morpho-blue",
    chainId: 42161,
    guardian: "0x2222222222222222222222222222222222222222",
    key: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
  });
  assert.equal(
    morphoKey,
    "morpho-blue:42161:0x2222222222222222222222222222222222222222:0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
  );
});

test("adapters: getGuardiansForChain mengekstrak seluruh guardian dengan default protocol", () => {
  const chain: any = {
    chainId: 421614,
    guardians: [
      { version: 2, address: "0x1111111111111111111111111111111111111111", deployedBlock: 100 },
      { version: 4, address: "0x2222222222222222222222222222222222222222", deployedBlock: 200, protocol: "aave-v3" },
      { version: 1, address: "0x3333333333333333333333333333333333333333", deployedBlock: 300, protocol: "morpho-blue" },
    ],
  };

  const list = getGuardiansForChain(chain);
  assert.equal(list.length, 3);
  assert.equal(list[0]!.protocol, "aave-v3"); // default saat absent
  assert.equal(list[0]!.version, 2);
  assert.equal(list[1]!.protocol, "aave-v3");
  assert.equal(list[1]!.version, 4);
  assert.equal(list[2]!.protocol, "morpho-blue");
  assert.equal(list[2]!.version, 1);
});

test("adapters: V2V3GuardianAdapter pagination dan eksekusi", async () => {
  const guardian = "0x1a5d249a8e711e2288add7c01e31eb7ffb05d97e" as Address;
  const user1 = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Address;
  const debtAsset = "0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d" as Address;

  let protectCalledWith: any = null;

  const fakeClient: any = {
    async readContract(params: any) {
      if (params.functionName === "usersPage") {
        if (params.args[0] === 0n) return [user1];
        return [];
      }
      if (params.functionName === "policies") {
        return [true, debtAsset, 1300000000000000000n, 1600000000000000000n, 1000n];
      }
      if (params.functionName === "needsProtection") {
        return true;
      }
      if (params.functionName === "quoteProtect") {
        return [100n, 200n, 0n, 300n, 1500000000000000000n]; // l1, l2, l3Collateral, l3Repay, expectedHf
      }
      throw new Error(`Unexpected function ${params.functionName}`);
    },
  };

  const adapter = new V2V3GuardianAdapter({
    chainId: 421614,
    guardianAddress: guardian,
    version: 2,
    protocol: "aave-v3",
    client: fakeClient,
    protectCaller: async (g, u) => {
      protectCalledWith = { g, u };
      return "0xv2hash";
    },
  });

  // 1. Discovery posisi dari usersPage
  const positions = await adapter.getPositions();
  assert.equal(positions.length, 1);
  assert.equal(positions[0]!.user, user1);
  assert.equal(positions[0]!.key, debtAsset);
  assert.equal(positions[0]!.protocol, "aave-v3");
  assert.equal(
    positions[0]!.positionKey,
    `aave-v3:421614:${guardian}:${debtAsset}`,
  );

  // 2. Evaluasi proteksi
  const quote = await adapter.evaluateProtection(positions[0]!);
  assert.equal(quote.needsProtection, true);
  assert.equal(quote.quoteAmount, 600n); // 100 + 200 + 300

  // 3. Eksekusi protect
  const tx = await adapter.protect(positions[0]!);
  assert.equal(tx, "0xv2hash");
  assert.deepEqual(protectCalledWith, { g: guardian, u: user1 });
});

test("adapters: AaveV4GuardianAdapter pagination, prioritas debtAssetsOf, dan eksekusi", async () => {
  const guardian = "0x2222222222222222222222222222222222222222" as Address;
  const user = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Address;
  const usdc = "0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d" as Address;
  const weth = "0x1df462e2712496373a347f8ad10802a5e95f053d" as Address;

  let protectCalledWith: any = null;

  const fakeClient: any = {
    async readContract(params: any) {
      if (params.functionName === "positionsPage") {
        if (params.args[0] === 0n) {
          // User memiliki 2 aset utang: USDC dan WETH
          return [[user, user], [usdc, weth]];
        }
        return [[], []];
      }
      if (params.functionName === "debtAssetsOf") {
        // User menetapkan prioritas: WETH lebih diprioritaskan daripada USDC
        return [weth, usdc];
      }
      if (params.functionName === "needsProtection") {
        // Kedua aset butuh proteksi
        return true;
      }
      if (params.functionName === "quoteProtect") {
        // l1, l2, l3, expectedHf
        const debt = params.args[1];
        if (debt.toLowerCase() === weth) {
          return [50n, 50n, 0n, 1500000000000000000n];
        }
        return [200n, 100n, 0n, 1500000000000000000n];
      }
      throw new Error(`Unexpected function ${params.functionName}`);
    },
  };

  const adapter = new AaveV4GuardianAdapter({
    chainId: 421614,
    guardianAddress: guardian,
    version: 4,
    protocol: "aave-v3",
    client: fakeClient,
    protectCaller: async (g, u, k) => {
      protectCalledWith = { g, u, k };
      return "0xv4aavehash";
    },
  });

  // 1. Get positions
  const positions = await adapter.getPositions();
  assert.equal(positions.length, 2);

  // 2. Prioritize: WETH adalah prioritas #1, sehingga dalam 1 tick HANYA WETH yang diproteksi
  const prioritized = await adapter.prioritizePositions(positions);
  assert.equal(prioritized.length, 1);
  assert.equal(prioritized[0]!.key, weth); // WETH terpilih karena prioritas tertinggi

  // 3. Evaluasi WETH
  const quote = await adapter.evaluateProtection(prioritized[0]!);
  assert.equal(quote.needsProtection, true);
  assert.equal(quote.quoteAmount, 100n);

  // 4. Eksekusi protect untuk (user, debtAsset)
  const tx = await adapter.protect(prioritized[0]!);
  assert.equal(tx, "0xv4aavehash");
  assert.deepEqual(protectCalledWith, { g: guardian, u: user, k: weth });
});

test("adapters: AaveV4GuardianAdapter saat aset prioritas 1 aman, aset prioritas 2 dipilih", async () => {
  const guardian = "0x2222222222222222222222222222222222222222" as Address;
  const user = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Address;
  const usdc = "0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d" as Address;
  const weth = "0x1df462e2712496373a347f8ad10802a5e95f053d" as Address;

  const fakeClient: any = {
    async readContract(params: any) {
      if (params.functionName === "debtAssetsOf") {
        return [weth, usdc]; // WETH prioritas 1, USDC prioritas 2
      }
      if (params.functionName === "needsProtection") {
        const debt = params.args[1];
        // WETH sudah aman, hanya USDC yang butuh proteksi
        return debt.toLowerCase() === usdc;
      }
      if (params.functionName === "quoteProtect") {
        const debt = params.args[1];
        if (debt.toLowerCase() === usdc) {
          return [300n, 0n, 0n, 1500000000000000000n];
        }
        return [0n, 0n, 0n, 2000000000000000000n];
      }
      throw new Error(`Unexpected function ${params.functionName}`);
    },
  };

  const adapter = new AaveV4GuardianAdapter({
    chainId: 421614,
    guardianAddress: guardian,
    version: 4,
    protocol: "aave-v3",
    client: fakeClient,
  });

  const positions = [
    {
      user,
      key: usdc,
      positionKey: `aave-v3:421614:${guardian}:${usdc}`,
      protocol: "aave-v3" as const,
      guardianAddress: guardian,
    },
    {
      user,
      key: weth,
      positionKey: `aave-v3:421614:${guardian}:${weth}`,
      protocol: "aave-v3" as const,
      guardianAddress: guardian,
    },
  ];

  const prioritized = await adapter.prioritizePositions(positions);
  assert.equal(prioritized.length, 1);
  assert.equal(prioritized[0]!.key, usdc); // USDC terpilih karena WETH tidak butuh proteksi
});

test("adapters: MorphoGuardianAdapter pagination, needsProtection, quoteProtect, dan protect", async () => {
  const guardian = "0x3333333333333333333333333333333333333333" as Address;
  const user = "0xcccccccccccccccccccccccccccccccccccccccc" as Address;
  const marketId = "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";

  let protectCalledWith: any = null;

  const fakeClient: any = {
    async readContract(params: any) {
      if (params.functionName === "positionsPage") {
        if (params.args[0] === 0n) {
          return [[user], [marketId]];
        }
        return [[], []];
      }
      if (params.functionName === "needsProtection") {
        assert.equal(params.args[0].toLowerCase(), user);
        assert.equal(params.args[1].toLowerCase(), marketId);
        return true;
      }
      if (params.functionName === "quoteProtect") {
        // l1Repay, l2Repay, expectedHf
        return [250n, 150n, 1400000000000000000n];
      }
      throw new Error(`Unexpected function ${params.functionName}`);
    },
  };

  const adapter = new MorphoGuardianAdapter({
    chainId: 42161,
    guardianAddress: guardian,
    version: 4,
    protocol: "morpho-blue",
    client: fakeClient,
    protectCaller: async (g, u, k) => {
      protectCalledWith = { g, u, k };
      return "0xmorphohash";
    },
  });

  // 1. Get positions
  const positions = await adapter.getPositions();
  assert.equal(positions.length, 1);
  assert.equal(positions[0]!.user, user);
  assert.equal(positions[0]!.key, marketId);
  assert.equal(positions[0]!.protocol, "morpho-blue");
  assert.equal(
    positions[0]!.positionKey,
    `morpho-blue:42161:${guardian}:${marketId}`,
  );

  // 2. Evaluasi
  const quote = await adapter.evaluateProtection(positions[0]!);
  assert.equal(quote.needsProtection, true);
  assert.equal(quote.quoteAmount, 400n); // 250 + 150

  // 3. Protect
  const tx = await adapter.protect(positions[0]!);
  assert.equal(tx, "0xmorphohash");
  assert.deepEqual(protectCalledWith, { g: guardian, u: user, k: marketId });
});

test("adapters: createGuardianAdapter memilih kelas adapter yang tepat", () => {
  const v2 = createGuardianAdapter({
    chainId: 421614,
    guardianAddress: "0x1111111111111111111111111111111111111111",
    version: 2,
    protocol: "aave-v3",
  });
  assert.ok(v2 instanceof V2V3GuardianAdapter);

  const aaveV4 = createGuardianAdapter({
    chainId: 421614,
    guardianAddress: "0x2222222222222222222222222222222222222222",
    version: 4,
    protocol: "aave-v3",
  });
  assert.ok(aaveV4 instanceof AaveV4GuardianAdapter);

  const morpho = createGuardianAdapter({
    chainId: 42161,
    guardianAddress: "0x3333333333333333333333333333333333333333",
    version: 4,
    protocol: "morpho-blue",
  });
  assert.ok(morpho instanceof MorphoGuardianAdapter);
});

test("adapters: Keeper.runTick mengevaluasi multi-adapter dalam mode dry-run dan live", async () => {
  const guardianAave = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Address;
  const guardianMorpho = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Address;
  const user = "0xcccccccccccccccccccccccccccccccccccccccc" as Address;
  const debtAsset = "0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d";
  const marketId = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";

  const posAave = {
    user,
    key: debtAsset,
    positionKey: `aave-v3:421614:${guardianAave}:${debtAsset}`,
    protocol: "aave-v3" as const,
    guardianAddress: guardianAave,
  };

  const posMorpho = {
    user,
    key: marketId,
    positionKey: `morpho-blue:42161:${guardianMorpho}:${marketId}`,
    protocol: "morpho-blue" as const,
    guardianAddress: guardianMorpho,
  };

  const fakeAaveAdapter: any = {
    protocol: "aave-v3",
    version: 4,
    guardianAddress: guardianAave,
    chainId: 421614,
    async getPositions() {
      return [posAave];
    },
    async evaluateProtection() {
      return { needsProtection: true, quoteAmount: 500n };
    },
    async protect() {
      return "0xtxaave";
    },
  };

  const fakeMorphoAdapter: any = {
    protocol: "morpho-blue",
    version: 4,
    guardianAddress: guardianMorpho,
    chainId: 42161,
    async getPositions() {
      return [posMorpho];
    },
    async evaluateProtection() {
      return { needsProtection: true, quoteAmount: 300n };
    },
    async protect() {
      return "0xtxmorpho";
    },
  };

  // 1. Dry run
  const dryKeeper = new Keeper();
  const dryResults = await dryKeeper.runTick([fakeAaveAdapter, fakeMorphoAdapter]);

  assert.equal(dryResults.length, 2);
  assert.equal(dryResults[0]!.status, "dry_run");
  assert.equal(dryResults[0]!.positionKey, posAave.positionKey);
  assert.equal(dryResults[0]!.quoteAmount, 500n);

  assert.equal(dryResults[1]!.status, "dry_run");
  assert.equal(dryResults[1]!.positionKey, posMorpho.positionKey);
  assert.equal(dryResults[1]!.quoteAmount, 300n);

  // 2. Live execution via protectCaller
  let executedKeys: string[] = [];
  const liveKeeper = new Keeper({
    protectCaller: async (g, u, k) => {
      executedKeys.push(`${g}:${u}:${k}`);
      return "0xhash";
    },
  });

  const liveResults = await liveKeeper.runTick([fakeAaveAdapter, fakeMorphoAdapter]);
  assert.equal(liveResults.length, 2);
  assert.equal(liveResults[0]!.status, "executed");
  assert.equal(liveResults[1]!.status, "executed");
  assert.equal(executedKeys.length, 2);
});

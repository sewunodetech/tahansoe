import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, parseAbi, type Log } from "viem";
import { guardianAaveV4Abi, guardianAbi, guardianMorphoAbi } from "../src/abis.ts";
import { guessConstructorArgs, parseDeploymentOutput, SIM_DEPLOYER } from "../src/deploy.ts";
import { forkContracts, MORPHO_BLUE_ARBITRUM_ONE } from "../src/forks.ts";
import { decodeGuardianLogs, getKeeperCheckedAt, SIM_KEEPER, startKeeper } from "../src/keeper.ts";
import { toFeedAnswer } from "../src/oracle.ts";
import { GUARDIAN } from "./helpers.ts";

describe("DeploySim output", () => {
  it("parses the SIM_DEPLOYMENT line from forge logs", () => {
    const stdout = [
      "Script ran successfully.",
      "== Logs ==",
      '  SIM_DEPLOYMENT {"guardian":"0x1111111111111111111111111111111111111111","simPriceFeed":"0x2222222222222222222222222222222222222222","testVault":"0x3333333333333333333333333333333333333333"}',
      "ONCHAIN EXECUTION COMPLETE",
    ].join("\n");
    assert.deepEqual(parseDeploymentOutput(stdout), {
      guardian: "0x1111111111111111111111111111111111111111",
      simPriceFeed: "0x2222222222222222222222222222222222222222",
      testVault: "0x3333333333333333333333333333333333333333",
    });
  });

  it("parses guardianAaveV4 and guardianMorpho when present", () => {
    const stdout = [
      "Script ran successfully.",
      "== Logs ==",
      '  SIM_DEPLOYMENT {"guardian":"0x1111111111111111111111111111111111111111","simPriceFeed":"0x2222222222222222222222222222222222222222","guardianAaveV4":"0x4444444444444444444444444444444444444444","guardianMorpho":"0x5555555555555555555555555555555555555555"}',
    ].join("\n");
    assert.deepEqual(parseDeploymentOutput(stdout), {
      guardian: "0x1111111111111111111111111111111111111111",
      simPriceFeed: "0x2222222222222222222222222222222222222222",
      guardianAaveV4: "0x4444444444444444444444444444444444444444",
      guardianMorpho: "0x5555555555555555555555555555555555555555",
    });
  });

  it("accepts guardianV3 as an alias and drops zero addresses", () => {
    const out = parseDeploymentOutput(
      'SIM_DEPLOYMENT {"chainId":4216199,"guardianV3":"0x1111111111111111111111111111111111111111","simPriceFeed":"0x2222222222222222222222222222222222222222","testVault":"0x0000000000000000000000000000000000000000","guardianAaveV4":"0x0000000000000000000000000000000000000000","guardianMorpho":"0x0000000000000000000000000000000000000000"}',
    );
    assert.deepEqual(out, {
      guardian: "0x1111111111111111111111111111111111111111",
      simPriceFeed: "0x2222222222222222222222222222222222222222",
    });
  });

  it("treats testVault, guardianAaveV4 and guardianMorpho as optional and rejects bad output", () => {
    const ok = parseDeploymentOutput(
      'SIM_DEPLOYMENT {"guardian":"0x1111111111111111111111111111111111111111","simPriceFeed":"0x2222222222222222222222222222222222222222"}',
    );
    assert.ok(ok && !("testVault" in ok) && !("guardianAaveV4" in ok) && !("guardianMorpho" in ok));
    assert.equal(parseDeploymentOutput("no marker"), null);
    assert.equal(parseDeploymentOutput('SIM_DEPLOYMENT {"guardian":"0x1"}'), null);
    assert.equal(parseDeploymentOutput("SIM_DEPLOYMENT {broken"), null);
  });

  it("guesses fallback constructor args from the ABI", () => {
    // SimPriceFeed(address updater_, int256 initialAnswer, string description_)
    const abi = parseAbi(["constructor(address updater_, int256 initialAnswer, string description_)"]);
    assert.deepEqual(guessConstructorArgs(abi, { initialAnswer: 5n, updater: SIM_DEPLOYER }), [SIM_DEPLOYER, 5n, "Tahansoe Sim"]);
    const vault = parseAbi(["constructor(address asset_, string name_, string symbol_)"]);
    const usdc = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" as const;
    assert.deepEqual(guessConstructorArgs(vault, { initialAnswer: 0n, updater: SIM_DEPLOYER, asset: usdc }), [usdc, "Tahansoe Sim", "vSIM"]);
  });
});

describe("forkContracts", () => {
  const reg = {
    pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD" as const,
    weth: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1" as const,
    usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" as const,
  };

  it("returns original contracts when v4 keys are absent", () => {
    const rec = {
      runtime: {
        deployment: {
          guardian: GUARDIAN,
          simPriceFeed: "0x2222222222222222222222222222222222222222",
          updater: "0x2222222222222222222222222222222222222222",
          method: "artifacts" as const,
        },
      },
    } as any;
    const c = forkContracts(rec, reg);
    assert.deepEqual(c, {
      guardian: GUARDIAN,
      simPriceFeed: "0x2222222222222222222222222222222222222222",
      pool: reg.pool,
      weth: reg.weth,
      usdc: reg.usdc,
    });
    assert.equal("guardianAaveV4" in c, false);
    assert.equal("guardianMorpho" in c, false);
    assert.equal("morpho" in c, false);
  });

  it("exposes guardianAaveV4, guardianMorpho and morpho constant when present", () => {
    const v4 = "0x4444444444444444444444444444444444444444" as const;
    const morphoGuardian = "0x5555555555555555555555555555555555555555" as const;
    const rec = {
      runtime: {
        deployment: {
          guardian: GUARDIAN,
          simPriceFeed: "0x2222222222222222222222222222222222222222",
          guardianAaveV4: v4,
          guardianMorpho: morphoGuardian,
          updater: "0x2222222222222222222222222222222222222222",
          method: "deploy-sim-script" as const,
        },
      },
    } as any;
    const c = forkContracts(rec, reg);
    assert.equal(c.guardianAaveV4, v4);
    assert.equal(c.guardianMorpho, morphoGuardian);
    assert.equal(c.morpho, MORPHO_BLUE_ARBITRUM_ONE);
  });
});

describe("feed answer", () => {
  it("uses 8 decimals", () => {
    assert.equal(toFeedAnswer(2345.6789), 234567890000n);
    assert.throws(() => toFeedAnswer(0));
  });
});

describe("sim keeper log decoding", () => {
  const user = "0x00000000000000000000000000000000000000aa" as const;
  const usdc = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" as const;
  const log = (topics: readonly `0x${string}`[], data: `0x${string}`, address = GUARDIAN): Log =>
    ({ address, topics, data, blockNumber: 42n, transactionHash: "0xabc", logIndex: 0, blockHash: "0x1", transactionIndex: 0, removed: false }) as unknown as Log;

  it("decodes Protected, LayerUsed and FeeCharged; ignores other contracts", () => {
    const logs = [
      log(
        encodeEventTopics({ abi: guardianAbi, eventName: "LayerUsed", args: { user, layer: 2 } }) as `0x${string}`[],
        encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [100n, 99n]),
      ),
      log(
        encodeEventTopics({ abi: guardianAbi, eventName: "Protected", args: { user, debtAsset: usdc, caller: user } }) as `0x${string}`[],
        encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }], [99n, 11n * 10n ** 17n, 15n * 10n ** 17n]),
      ),
      log(
        encodeEventTopics({ abi: guardianAbi, eventName: "FeeCharged", args: { user, debtAsset: usdc } }) as `0x${string}`[],
        encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [5n, 0n]),
      ),
      log(
        encodeEventTopics({ abi: guardianAbi, eventName: "LayerUsed", args: { user, layer: 1 } }) as `0x${string}`[],
        encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [1n, 1n]),
        "0x9999999999999999999999999999999999999999",
      ),
    ];
    const evs = decodeGuardianLogs(GUARDIAN, logs);
    assert.deepEqual(
      evs.map((e) => e.type),
      ["layer", "protected", "fee"],
    );
    assert.equal(evs[0]!.layer, 2);
    assert.equal(evs[0]!.amount, "99");
    assert.equal(evs[1]!.hfBefore, "1100000000000000000");
    assert.equal(evs[1]!.hfAfter, "1500000000000000000");
    assert.equal(evs[2]!.waived, "0");
    assert.equal(evs[1]!.blockNumber, 42);

    // Verify positionKey
    const expectedKey = `aave-v3:4216199:${GUARDIAN.toLowerCase()}:${usdc.toLowerCase()}`;
    assert.equal(evs[0]!.positionKey, expectedKey);
    assert.equal(evs[1]!.positionKey, expectedKey);
    assert.equal(evs[2]!.positionKey, expectedKey);
  });

  it("decodes AaveV4 logs with positionKey", () => {
    const v4Guardian = "0x4444444444444444444444444444444444444444" as const;
    const logs = [
      log(
        encodeEventTopics({ abi: guardianAaveV4Abi, eventName: "LayerUsed", args: { user, debtAsset: usdc, layer: 1 } }) as `0x${string}`[],
        encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [500n, 500n]),
        v4Guardian,
      ),
      log(
        encodeEventTopics({ abi: guardianAaveV4Abi, eventName: "Protected", args: { user, debtAsset: usdc, caller: SIM_KEEPER } }) as `0x${string}`[],
        encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }], [500n, 11n * 10n ** 17n, 15n * 10n ** 17n]),
        v4Guardian,
      ),
      log(
        encodeEventTopics({ abi: guardianAaveV4Abi, eventName: "FeeCharged", args: { user, debtAsset: usdc } }) as `0x${string}`[],
        encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [10n, 0n]),
        v4Guardian,
      ),
    ];
    const evs = decodeGuardianLogs(v4Guardian, logs);
    assert.equal(evs.length, 3);
    const expectedKey = `aave-v3:4216199:${v4Guardian.toLowerCase()}:${usdc.toLowerCase()}`;
    assert.equal(evs[0]!.positionKey, expectedKey);
    assert.equal(evs[1]!.positionKey, expectedKey);
    assert.equal(evs[2]!.positionKey, expectedKey);
  });

  it("decodes Morpho logs with positionKey", () => {
    const morphoGuardian = "0x5555555555555555555555555555555555555555" as const;
    const marketId = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef" as const;
    const logs = [
      log(
        encodeEventTopics({ abi: guardianMorphoAbi, eventName: "LayerUsed", args: { user, marketId, layer: 2 } }) as `0x${string}`[],
        encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [300n, 300n]),
        morphoGuardian,
      ),
      log(
        encodeEventTopics({ abi: guardianMorphoAbi, eventName: "Protected", args: { user, marketId, caller: SIM_KEEPER } }) as `0x${string}`[],
        encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }], [300n, 12n * 10n ** 17n, 16n * 10n ** 17n]),
        morphoGuardian,
      ),
      log(
        encodeEventTopics({ abi: guardianMorphoAbi, eventName: "FeeCharged", args: { user, marketId } }) as `0x${string}`[],
        encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [5n, 1n]),
        morphoGuardian,
      ),
    ];
    const evs = decodeGuardianLogs(morphoGuardian, logs);
    assert.equal(evs.length, 3);
    const expectedKey = `morpho-blue:4216199:${morphoGuardian.toLowerCase()}:${marketId.toLowerCase()}`;
    assert.equal(evs[0]!.positionKey, expectedKey);
    assert.equal(evs[1]!.positionKey, expectedKey);
    assert.equal(evs[2]!.positionKey, expectedKey);
  });
});

describe("sim keeper check time", () => {
  it("records keeperCheckedAt on each completed loop", async () => {
    let usersPageCalls = 0;
    const fakeFork = {
      url: "http://127.0.0.1:9999",
      read: async (_addr: any, _abi: any, fn: string) => {
        if (fn === "usersPage") {
          usersPageCalls++;
          return [];
        }
        return false;
      },
      sendAs: async () => ({ logs: [] }),
    };

    let checkedTimestamp: number | null = null;
    const handle = startKeeper(
      fakeFork as any,
      GUARDIAN,
      () => {},
      10,
      (e) => assert.fail(String(e)),
      (ts) => {
        checkedTimestamp = ts;
      },
    );

    await new Promise((r) => setTimeout(r, 35));
    handle.stop();

    assert.ok(usersPageCalls > 0, "keeper loop should have executed");
    assert.ok(typeof handle.lastCheckedAt === "number", "handle.lastCheckedAt should be set");
    assert.ok(handle.lastCheckedAt! > 0);
    assert.equal(handle.lastCheckedAt, checkedTimestamp);
    assert.equal(getKeeperCheckedAt(fakeFork.url), checkedTimestamp);
  });
});

describe("sim keeper v4 paths and priority", () => {
  const v4Guardian = "0x4444444444444444444444444444444444444444" as const;
  const morphoGuardian = "0x5555555555555555555555555555555555555555" as const;
  const userA = "0x0000000000000000000000000000000000000001" as const;
  const usdc = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" as const;
  const dai = "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1" as const;
  const marketId1 = "0x1111111111111111111111111111111111111111111111111111111111111111" as const;

  it("AaveV4: respects priority from debtAssetsOf and protects at most one debt asset per user per tick", async () => {
    const protectedCalls: { user: string; debtAsset: string }[] = [];
    const fakeFork = {
      url: "http://127.0.0.1:9998",
      chainId: 4216199,
      read: async (_addr: any, _abi: any, fn: string, _args: any[]) => {
        if (fn === "usersPage") return [];
        if (fn === "positionsPage") {
          // Returns 2 positions for userA: USDC and DAI
          return [[userA, userA], [usdc, dai]];
        }
        if (fn === "debtAssetsOf") {
          // Priority order set by user: DAI first, then USDC
          return [dai, usdc];
        }
        if (fn === "needsProtection") {
          // Both DAI and USDC need protection!
          return true;
        }
        return false;
      },
      sendAs: async (_from: any, _to: any, data: string) => {
        const call = decodeFunctionData({ abi: guardianAaveV4Abi, data: data as any });
        if (call.functionName === "protect") {
          protectedCalls.push({ user: call.args[0], debtAsset: call.args[1] });
        }
        return { logs: [] };
      },
    };

    const handle = startKeeper(
      fakeFork as any,
      { guardian: GUARDIAN, guardianAaveV4: v4Guardian },
      () => {},
      10,
      (e) => assert.fail(String(e)),
    );

    await new Promise((r) => setTimeout(r, 35));
    handle.stop();

    // In a tick, DAI was protected because it's first in priority, and USDC was NOT called for that user
    assert.ok(protectedCalls.length >= 1, "protect should have been called");
    assert.equal(protectedCalls[0]!.user, userA);
    assert.equal(protectedCalls[0]!.debtAsset, dai);
    for (const c of protectedCalls) {
      assert.equal(c.debtAsset, dai, "should only protect DAI (highest priority)");
    }
  });

  it("AaveV4: protects second priority asset when first does not need protection", async () => {
    const protectedCalls: { user: string; debtAsset: string }[] = [];
    const fakeFork = {
      url: "http://127.0.0.1:9997",
      chainId: 4216199,
      read: async (_addr: any, _abi: any, fn: string, args: any[]) => {
        if (fn === "usersPage") return [];
        if (fn === "positionsPage") return [[userA], [usdc]];
        if (fn === "debtAssetsOf") return [dai, usdc]; // DAI priority 1, USDC priority 2
        if (fn === "needsProtection") {
          // args: [user, debtAsset]
          return args[1] === usdc; // Only USDC needs protection
        }
        return false;
      },
      sendAs: async (_from: any, _to: any, data: string) => {
        const call = decodeFunctionData({ abi: guardianAaveV4Abi, data: data as any });
        if (call.functionName === "protect") {
          protectedCalls.push({ user: call.args[0], debtAsset: call.args[1] });
        }
        return { logs: [] };
      },
    };

    const handle = startKeeper(
      fakeFork as any,
      { guardian: GUARDIAN, guardianAaveV4: v4Guardian },
      () => {},
      10,
      (e) => assert.fail(String(e)),
    );

    await new Promise((r) => setTimeout(r, 35));
    handle.stop();

    assert.ok(protectedCalls.length >= 1);
    assert.equal(protectedCalls[0]!.debtAsset, usdc);
  });

  it("Morpho: checks needsProtection and protects marketId", async () => {
    const protectedCalls: { user: string; marketId: string }[] = [];
    const fakeFork = {
      url: "http://127.0.0.1:9996",
      chainId: 4216199,
      read: async (_addr: any, _abi: any, fn: string, _args: any[]) => {
        if (fn === "usersPage") return [];
        if (fn === "positionsPage") return [[userA], [marketId1]];
        if (fn === "needsProtection") return true;
        return false;
      },
      sendAs: async (_from: any, _to: any, data: string) => {
        const call = decodeFunctionData({ abi: guardianMorphoAbi, data: data as any });
        if (call.functionName === "protect") {
          protectedCalls.push({ user: call.args[0], marketId: call.args[1] });
        }
        return { logs: [] };
      },
    };

    const handle = startKeeper(
      fakeFork as any,
      { guardian: GUARDIAN, guardianMorpho: morphoGuardian },
      () => {},
      10,
      (e) => assert.fail(String(e)),
    );

    await new Promise((r) => setTimeout(r, 35));
    handle.stop();

    assert.ok(protectedCalls.length >= 1);
    assert.equal(protectedCalls[0]!.user, userA);
    assert.equal(protectedCalls[0]!.marketId, marketId1);
  });
});

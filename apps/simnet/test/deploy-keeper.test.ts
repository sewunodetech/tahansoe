import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encodeAbiParameters, encodeEventTopics, parseAbi, type Log } from "viem";
import { guardianAbi } from "../src/abis.ts";
import { guessConstructorArgs, parseDeploymentOutput, SIM_DEPLOYER } from "../src/deploy.ts";
import { decodeGuardianLogs, startKeeper, getKeeperCheckedAt } from "../src/keeper.ts";
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

  it("accepts guardianV3 as an alias and drops zero addresses", () => {
    const out = parseDeploymentOutput(
      'SIM_DEPLOYMENT {"chainId":4216199,"guardianV3":"0x1111111111111111111111111111111111111111","simPriceFeed":"0x2222222222222222222222222222222222222222","testVault":"0x0000000000000000000000000000000000000000"}',
    );
    assert.deepEqual(out, {
      guardian: "0x1111111111111111111111111111111111111111",
      simPriceFeed: "0x2222222222222222222222222222222222222222",
    });
  });

  it("treats testVault as optional and rejects bad output", () => {
    const ok = parseDeploymentOutput(
      'SIM_DEPLOYMENT {"guardian":"0x1111111111111111111111111111111111111111","simPriceFeed":"0x2222222222222222222222222222222222222222"}',
    );
    assert.ok(ok && !("testVault" in ok));
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

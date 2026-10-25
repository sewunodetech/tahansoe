import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  type Log,
} from "viem";
import { guardianAaveV4Abi, guardianAbi, guardianMorphoAbi } from "../src/abis.ts";
import {
  aavePositionKey,
  clearBandCache,
  decodeGuardianLogs,
  morphoPositionKey,
  SIM_KEEPER,
  SIM_RISK_AGENT,
  startKeeper,
  type SimEvent,
} from "../src/keeper.ts";
import { parseScenario } from "../src/scenario.ts";

describe("DynamicTriggerSet log decoding", () => {
  const user = "0x00000000000000000000000000000000000000AA" as const;
  const usdc = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" as const;
  const guardianAaveV4 = "0x4444444444444444444444444444444444444444" as const;
  const guardianMorpho = "0x5555555555555555555555555555555555555555" as const;
  const guardianV2 = "0x1111111111111111111111111111111111111111" as const;
  const marketId = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef" as const;

  const makeLog = (topics: readonly `0x${string}`[], data: `0x${string}`, address: `0x${string}`): Log =>
    ({
      address,
      topics,
      data,
      blockNumber: 100n,
      transactionHash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      logIndex: 0,
      blockHash: "0x1",
      transactionIndex: 0,
      removed: false,
    }) as unknown as Log;

  it("decodes DynamicTriggerSet for Aave V4 with positionKey and trigger details", () => {
    const triggerHF = 145n * 10n ** 16n; // 1.45
    const validUntil = 1750000000n;
    const topics = encodeEventTopics({
      abi: guardianAaveV4Abi,
      eventName: "DynamicTriggerSet",
      args: { user, debtAsset: usdc },
    }) as `0x${string}`[];
    const data = encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }, { type: "uint64" }],
      [SIM_RISK_AGENT, triggerHF, validUntil],
    );

    const logs = [makeLog(topics, data, guardianAaveV4)];
    const events = decodeGuardianLogs(guardianAaveV4, logs, { chainId: 4216199, protocol: "aave-v3" });

    assert.equal(events.length, 1);
    assert.equal(events[0]!.type, "dynamic_trigger");
    assert.equal(events[0]!.user, user);
    assert.equal(events[0]!.triggerHF, triggerHF.toString());
    assert.equal(events[0]!.validUntil, Number(validUntil));
    assert.equal(events[0]!.agent, SIM_RISK_AGENT);
    assert.equal(events[0]!.positionKey, aavePositionKey(4216199, guardianAaveV4, usdc));
  });

  it("decodes DynamicTriggerSet for Morpho Blue with market positionKey", () => {
    const triggerHF = 148n * 10n ** 16n; // 1.48
    const validUntil = 1750000000n;
    const topics = encodeEventTopics({
      abi: guardianMorphoAbi,
      eventName: "DynamicTriggerSet",
      args: { user, marketId },
    }) as `0x${string}`[];
    const data = encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }, { type: "uint64" }],
      [SIM_RISK_AGENT, triggerHF, validUntil],
    );

    const logs = [makeLog(topics, data, guardianMorpho)];
    const events = decodeGuardianLogs(guardianMorpho, logs, { chainId: 4216199, protocol: "morpho-blue" });

    assert.equal(events.length, 1);
    assert.equal(events[0]!.type, "dynamic_trigger");
    assert.equal(events[0]!.user, user);
    assert.equal(events[0]!.triggerHF, triggerHF.toString());
    assert.equal(events[0]!.validUntil, Number(validUntil));
    assert.equal(events[0]!.agent, SIM_RISK_AGENT);
    assert.equal(events[0]!.positionKey, morphoPositionKey(4216199, guardianMorpho, marketId));
  });

  it("decodes DynamicTriggerSet for V2/V3 Guardian", () => {
    const triggerHF = 135n * 10n ** 16n; // 1.35
    const validUntil = 1750000000n;
    const topics = encodeEventTopics({
      abi: guardianAbi,
      eventName: "DynamicTriggerSet",
      args: { user },
    }) as `0x${string}`[];
    const data = encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }, { type: "uint64" }],
      [SIM_RISK_AGENT, triggerHF, validUntil],
    );

    const logs = [makeLog(topics, data, guardianV2)];
    const events = decodeGuardianLogs(guardianV2, logs, { chainId: 4216199, protocol: "aave-v3", debtAsset: usdc });

    assert.equal(events.length, 1);
    assert.equal(events[0]!.type, "dynamic_trigger");
    assert.equal(events[0]!.user, user);
    assert.equal(events[0]!.triggerHF, triggerHF.toString());
    assert.equal(events[0]!.validUntil, Number(validUntil));
    assert.equal(events[0]!.agent, SIM_RISK_AGENT);
  });
});

describe("scenario replay: DynamicTriggerSet before Protected", () => {
  const user = "0x0000000000000000000000000000000000000001" as const;
  const usdc = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" as const;
  const guardianAaveV4 = "0x4444444444444444444444444444444444444444" as const;

  it("shows trigger rising (DynamicTriggerSet) before drawdown triggers protect()", async () => {
    clearBandCache();

    // Position state
    const staticTriggerHF = 125n * 10n ** 16n; // 1.25 WAD
    const targetHF = 155n * 10n ** 16n; // 1.55 WAD
    let currentDynamicTrigger = 0n;
    let bandConfigured = false;
    let hf = 140n * 10n ** 16n; // Current HF is 1.40 (above static 1.25, but below elevated/stressed)

    const capturedEvents: SimEvent[] = [];
    const calls: string[] = [];

    let currentRegime: "CALM" | "ELEVATED" | "STRESSED" | "CRISIS" = "CALM";

    const fakeFork = {
      url: "http://127.0.0.1:9995",
      chainId: 4216199,
      read: async (_addr: any, _abi: any, fn: string, args: any[]) => {
        if (fn === "usersPage") return [];
        if (fn === "positionsPage") return [[user], [usdc]];
        if (fn === "debtAssetsOf") return [usdc];
        if (fn === "policyOf") {
          return [true, staticTriggerHF, targetHF, 1000n * 10n ** 6n];
        }
        if (fn === "effectiveTrigger") {
          return currentDynamicTrigger > 0n ? currentDynamicTrigger : staticTriggerHF;
        }
        if (fn === "needsProtection") {
          const effective = currentDynamicTrigger > 0n ? currentDynamicTrigger : staticTriggerHF;
          return hf < effective;
        }
        return false;
      },
      sendAs: async (from: string, _to: any, data: string) => {
        const v4Call = decodeFunctionData({ abi: guardianAaveV4Abi, data: data as any });
        calls.push(`${from.toLowerCase()} -> ${v4Call.functionName}`);

        if (v4Call.functionName === "setTriggerBand") {
          bandConfigured = true;
          return { logs: [] };
        }

        if (v4Call.functionName === "setDynamicTrigger") {
          currentDynamicTrigger = v4Call.args[2] as bigint;
          const validUntil = v4Call.args[3] as bigint;
          // Emit DynamicTriggerSet event
          const topics = encodeEventTopics({
            abi: guardianAaveV4Abi,
            eventName: "DynamicTriggerSet",
            args: { user, debtAsset: usdc },
          }) as `0x${string}`[];
          const evtData = encodeAbiParameters(
            [{ type: "address" }, { type: "uint256" }, { type: "uint64" }],
            [SIM_RISK_AGENT, currentDynamicTrigger, validUntil],
          );
          const log: Log = {
            address: guardianAaveV4,
            topics,
            data: evtData,
            blockNumber: 101n,
            transactionHash: "0xaaaa111122223333444455556666777788889999aaaabbbbccccddddeeeeffff",
            logIndex: 0,
            blockHash: "0x1",
            transactionIndex: 0,
            removed: false,
          } as unknown as Log;
          return { logs: [log] };
        }

        if (v4Call.functionName === "protect") {
          // Repay debt and improve HF
          hf = targetHF;
          const topics = encodeEventTopics({
            abi: guardianAaveV4Abi,
            eventName: "Protected",
            args: { user, debtAsset: usdc, caller: SIM_KEEPER },
          }) as `0x${string}`[];
          const evtData = encodeAbiParameters(
            [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
            [500n * 10n ** 6n, 140n * 10n ** 16n, targetHF],
          );
          const log: Log = {
            address: guardianAaveV4,
            topics,
            data: evtData,
            blockNumber: 102n,
            transactionHash: "0xbbbb111122223333444455556666777788889999aaaabbbbccccddddeeeeffff",
            logIndex: 0,
            blockHash: "0x1",
            transactionIndex: 0,
            removed: false,
          } as unknown as Log;
          return { logs: [log] };
        }

        return { logs: [] };
      },
    };

    const handle = startKeeper(
      fakeFork as any,
      { guardian: "0x1111111111111111111111111111111111111111", guardianAaveV4 },
      (evs) => capturedEvents.push(...evs),
      10, // 10ms loop
      (e) => assert.fail(String(e)),
      undefined,
      {
        getRegime: () => currentRegime,
        riskAgent: SIM_RISK_AGENT,
      },
    );

    // Tick 1: CALM regime. Current HF 1.40. Static trigger 1.25.
    // HF (1.40) > static (1.25) -> no protection needed yet.
    await new Promise((r) => setTimeout(r, 25));
    assert.ok(bandConfigured, "default trigger band should have been configured");

    // Transition regime: Market develops stress ahead of crash!
    // STRESSED regime raises dynamic trigger from 1.25 to 1.45 (static + 0.20)!
    currentRegime = "STRESSED";
    await new Promise((r) => setTimeout(r, 35));

    handle.stop();

    // Verify events: DynamicTriggerSet happened FIRST, then Protected fired!
    const triggerEvents = capturedEvents.filter((e) => e.type === "dynamic_trigger");
    const protectedEvents = capturedEvents.filter((e) => e.type === "protected");

    assert.ok(triggerEvents.length >= 1, "DynamicTriggerSet event must have been emitted");
    assert.ok(protectedEvents.length >= 1, "Protected event must have been emitted");

    const firstTriggerIndex = capturedEvents.findIndex((e) => e.type === "dynamic_trigger");
    const firstProtectedIndex = capturedEvents.findIndex((e) => e.type === "protected");

    assert.ok(
      firstTriggerIndex < firstProtectedIndex,
      `DynamicTriggerSet (index ${firstTriggerIndex}) must occur before Protected (index ${firstProtectedIndex})`,
    );

    // Verify the raised trigger value
    const lastTrigger = triggerEvents[triggerEvents.length - 1]!;
    assert.equal(lastTrigger.triggerHF, (145n * 10n ** 16n).toString(), "Dynamic trigger raised to 1.45");

    // At HF 1.40:
    // Under static policy (1.25): position is NOT protected (1.40 >= 1.25).
    // Under Tahansoe dynamic trigger (1.45): position IS protected early (1.40 < 1.45)!
  });
});

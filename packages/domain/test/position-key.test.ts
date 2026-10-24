import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  positionKey,
  parsePositionKey,
  tahansoeGuardianAaveV4Abi,
  tahansoeGuardianMorphoAbi,
  guardianAaveV4Abi,
  guardianMorphoAbi,
} from "../src";

describe("packages/domain positionKey and parsePositionKey (spec m4 §3.6)", () => {
  const guardianAave = "0x1A5D249A8E711E2288ADD7C01E31EB7FFB05D97E";
  const debtUSDC = "0x75FAF114EAFB1BDBE2F0316DF893FD58CE46AA4D";
  const guardianMorpho = "0x6C247B1F6182318877311737BAC0844BAA518F5E";
  const marketId = "0xb323495f7e4148be5643a4ea4a8221eef163e4bccfdedc2a6f4696baacbc86cc";

  it("creates lowercase positionKey for Aave V3", () => {
    const key = positionKey({
      protocol: "aave-v3",
      chainId: 421614,
      guardian: guardianAave,
      debtAsset: debtUSDC,
    });
    assert.equal(
      key,
      `aave-v3:421614:${guardianAave.toLowerCase()}:${debtUSDC.toLowerCase()}`
    );
  });

  it("creates lowercase positionKey for Morpho Blue", () => {
    const key = positionKey({
      protocol: "morpho-blue",
      chainId: 42161,
      guardian: guardianMorpho,
      marketId: marketId.toUpperCase(),
    });
    assert.equal(
      key,
      `morpho-blue:42161:${guardianMorpho.toLowerCase()}:${marketId.toLowerCase()}`
    );
  });

  it("parses valid Aave V3 positionKey", () => {
    const rawKey = `aave-v3:421614:${guardianAave.toLowerCase()}:${debtUSDC.toLowerCase()}`;
    const parsed = parsePositionKey(rawKey);
    assert.equal(parsed.protocol, "aave-v3");
    assert.equal(parsed.chainId, 421614);
    assert.equal(parsed.guardian, guardianAave.toLowerCase());
    if (parsed.protocol === "aave-v3") {
      assert.equal(parsed.debtAsset, debtUSDC.toLowerCase());
    }
  });

  it("parses valid Morpho Blue positionKey", () => {
    const rawKey = `morpho-blue:42161:${guardianMorpho.toLowerCase()}:${marketId.toLowerCase()}`;
    const parsed = parsePositionKey(rawKey);
    assert.equal(parsed.protocol, "morpho-blue");
    assert.equal(parsed.chainId, 42161);
    assert.equal(parsed.guardian, guardianMorpho.toLowerCase());
    if (parsed.protocol === "morpho-blue") {
      assert.equal(parsed.marketId, marketId.toLowerCase());
    }
  });

  it("roundtrips between positionKey and parsePositionKey", () => {
    const aaveInput = {
      protocol: "aave-v3" as const,
      chainId: 42161,
      guardian: guardianAave,
      debtAsset: debtUSDC,
    };
    const aaveKey = positionKey(aaveInput);
    const parsedAave = parsePositionKey(aaveKey);
    assert.deepEqual(parsedAave, {
      protocol: "aave-v3",
      chainId: 42161,
      guardian: guardianAave.toLowerCase(),
      debtAsset: debtUSDC.toLowerCase(),
    });

    const morphoInput = {
      protocol: "morpho-blue" as const,
      chainId: 42161,
      guardian: guardianMorpho,
      marketId: marketId,
    };
    const morphoKey = positionKey(morphoInput);
    const parsedMorpho = parsePositionKey(morphoKey);
    assert.deepEqual(parsedMorpho, {
      protocol: "morpho-blue",
      chainId: 42161,
      guardian: guardianMorpho.toLowerCase(),
      marketId: marketId.toLowerCase(),
    });
  });

  it("validates positionKey input parameters", () => {
    // Missing debtAsset for aave-v3
    assert.throws(
      () =>
        positionKey({
          protocol: "aave-v3",
          chainId: 421614,
          guardian: guardianAave,
          debtAsset: "",
        }),
      /debtAsset is required/
    );

    // Missing marketId for morpho-blue
    assert.throws(
      () =>
        positionKey({
          protocol: "morpho-blue",
          chainId: 42161,
          guardian: guardianMorpho,
          marketId: "",
        }),
      /marketId is required/
    );

    // Invalid chainId
    assert.throws(
      () =>
        positionKey({
          protocol: "aave-v3",
          chainId: 0,
          guardian: guardianAave,
          debtAsset: debtUSDC,
        }),
      /chainId must be a positive integer/
    );

    // Missing guardian
    assert.throws(
      () =>
        positionKey({
          protocol: "aave-v3",
          chainId: 421614,
          guardian: "",
          debtAsset: debtUSDC,
        }),
      /guardian must be a non-empty string/
    );

    // Unsupported protocol
    assert.throws(
      () =>
        positionKey({
          protocol: "compound" as any,
          chainId: 42161,
          guardian: guardianAave,
          debtAsset: debtUSDC,
        }),
      /unsupported protocol/
    );
  });

  it("validates parsePositionKey input formats", () => {
    // Non-string or empty
    assert.throws(() => parsePositionKey(""), /non-empty string/);
    assert.throws(() => parsePositionKey(null as any), /non-empty string/);

    // Wrong segment count
    assert.throws(() => parsePositionKey("aave-v3:421614"), /4 colon-separated segments/);
    assert.throws(
      () => parsePositionKey("aave-v3:421614:0x123:0x456:extra"),
      /4 colon-separated segments/
    );

    // Invalid chainId
    assert.throws(
      () => parsePositionKey(`aave-v3:not-a-number:${guardianAave}:${debtUSDC}`),
      /Invalid positionKey chainId/
    );

    // Invalid protocol
    assert.throws(
      () => parsePositionKey(`compound:42161:${guardianAave}:${debtUSDC}`),
      /Unknown positionKey protocol/
    );
  });
});

describe("packages/domain guardian abi-v4 exports (spec m4 §3.6)", () => {
  it("tahansoeGuardianAaveV4Abi exports all required functions and events", () => {
    assert.ok(Array.isArray(tahansoeGuardianAaveV4Abi));
    assert.equal(guardianAaveV4Abi, tahansoeGuardianAaveV4Abi);

    const fnNames: readonly string[] = tahansoeGuardianAaveV4Abi
      .filter((item) => item.type === "function")
      .map((item) => (item as { name: string }).name);

    const expectedFns = [
      "setPolicy",
      "disablePolicy",
      "setLayer2",
      "setLayer3",
      "setTriggerBand",
      "setDynamicTrigger",
      "setDebtPriority",
      "policyOf",
      "layer2Of",
      "layer3Of",
      "debtAssetsOf",
      "healthFactor",
      "effectiveTrigger",
      "needsProtection",
      "quoteProtect",
      "quoteFee",
      "positionCount",
      "positionsPage",
      "protect",
    ];

    for (const fn of expectedFns) {
      assert.ok(fnNames.includes(fn), `Missing function ${fn} in Aave v4 ABI`);
    }

    const eventNames: readonly string[] = tahansoeGuardianAaveV4Abi
      .filter((item) => item.type === "event")
      .map((item) => (item as { name: string }).name);

    const expectedEvents = [
      "PolicySet",
      "PolicyDisabled",
      "LayerUsed",
      "Protected",
      "FeeCharged",
      "DynamicTriggerSet",
    ];

    for (const ev of expectedEvents) {
      assert.ok(eventNames.includes(ev), `Missing event ${ev} in Aave v4 ABI`);
    }
  });

  it("tahansoeGuardianMorphoAbi exports all required functions and events", () => {
    assert.ok(Array.isArray(tahansoeGuardianMorphoAbi));
    assert.equal(guardianMorphoAbi, tahansoeGuardianMorphoAbi);

    const fnNames: readonly string[] = tahansoeGuardianMorphoAbi
      .filter((item) => item.type === "function")
      .map((item) => (item as { name: string }).name);

    const expectedFns = [
      "setPolicy",
      "disablePolicy",
      "setLayer2",
      "setTriggerBand",
      "setDynamicTrigger",
      "policyOf",
      "layer2Of",
      "marketsOf",
      "healthFactor",
      "effectiveTrigger",
      "needsProtection",
      "quoteProtect",
      "quoteFee",
      "positionCount",
      "positionsPage",
      "protect",
    ];

    for (const fn of expectedFns) {
      assert.ok(fnNames.includes(fn), `Missing function ${fn} in Morpho ABI`);
    }

    const eventNames: readonly string[] = tahansoeGuardianMorphoAbi
      .filter((item) => item.type === "event")
      .map((item) => (item as { name: string }).name);

    const expectedEvents = [
      "PolicySet",
      "PolicyDisabled",
      "LayerUsed",
      "Protected",
      "FeeCharged",
      "DynamicTriggerSet",
    ];

    for (const ev of expectedEvents) {
      assert.ok(eventNames.includes(ev), `Missing event ${ev} in Morpho ABI`);
    }
  });
});

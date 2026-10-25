import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData, type Address, type Hex } from "viem";
import { ARBITRUM_SEPOLIA, ARBITRUM_ONE } from "@tahansoe/domain";
import {
  identityRegistryAbi,
  reputationRegistryAbi,
  buildRegistrationFile,
  prepareRegister,
  prepareSetAgentWallet,
  buildFeedback,
  mapOutcomeToFeedbackValues,
  getAgent,
  getReputationSummary,
  filterSybilClients,
  type ProtectionOutcomeInput,
} from "../../src/erc8004/index.ts";

describe("ERC-8004 ABI encode/decode round-trips", () => {
  it("register(string agentURI) encodes and decodes accurately", () => {
    const uri = "https://tahansoe.xyz/.well-known/agent-registration.json";
    const tx = prepareRegister({
      agentURI: uri,
      chainConfig: ARBITRUM_SEPOLIA,
    });

    assert.equal(tx.to, ARBITRUM_SEPOLIA.erc8004?.identity);

    const decoded = decodeFunctionData({
      abi: identityRegistryAbi,
      data: tx.data,
    });

    assert.equal(decoded.functionName, "register");
    assert.deepEqual(decoded.args, [uri]);
  });

  it("setAgentWallet(uint256,address,uint256,bytes) encodes and decodes accurately", () => {
    const agentId = 42n;
    const newWallet = "0x1234567890123456789012345678901234567890" as Address;
    const deadline = 1792892559n;
    const signature = "0xabcdef123456" as Hex;

    const tx = prepareSetAgentWallet({
      agentId,
      newWallet,
      deadline,
      signature,
      chainConfig: ARBITRUM_SEPOLIA,
    });

    assert.equal(tx.to, ARBITRUM_SEPOLIA.erc8004?.identity);

    const decoded = decodeFunctionData({
      abi: identityRegistryAbi,
      data: tx.data,
    });

    assert.equal(decoded.functionName, "setAgentWallet");
    assert.deepEqual(decoded.args, [agentId, newWallet, deadline, signature]);
  });

  it("giveFeedback(...) encodes and decodes accurately", () => {
    const outcome: ProtectionOutcomeInput = {
      agentId: 1n,
      tag: "preempt",
      value: 100n,
      valueDecimals: 0,
      tag2: "settlement",
      endpoint: "https://tahansoe.xyz",
      feedbackURI: "https://tahansoe.xyz/logs/run-1.json",
    };

    const call = buildFeedback(outcome, ARBITRUM_SEPOLIA);

    assert.equal(call.to, ARBITRUM_SEPOLIA.erc8004?.reputation);
    assert.equal(call.tag1, "preempt");
    assert.equal(call.tag2, "settlement");
    assert.equal(call.value, 100n);
    assert.equal(call.valueDecimals, 0);

    const decoded = decodeFunctionData({
      abi: reputationRegistryAbi,
      data: call.data,
    });

    assert.equal(decoded.functionName, "giveFeedback");
    assert.equal(decoded.args[0], 1n); // agentId
    assert.equal(decoded.args[1], 100n); // value
    assert.equal(decoded.args[2], 0); // valueDecimals
    assert.equal(decoded.args[3], "preempt"); // tag1
    assert.equal(decoded.args[4], "settlement"); // tag2
    assert.equal(decoded.args[5], "https://tahansoe.xyz"); // endpoint
    assert.equal(decoded.args[6], "https://tahansoe.xyz/logs/run-1.json"); // feedbackURI
    assert.equal(decoded.args[7], call.feedbackHash); // feedbackHash
  });
});

describe("ERC-8004 Agent Registration File", () => {
  it("builds the registration file with correct spec shape and supported guardians", () => {
    const file = buildRegistrationFile({ chainConfig: ARBITRUM_SEPOLIA });

    assert.equal(file.type, "https://eips.ethereum.org/EIPS/eip-8004#registration-v1");
    assert.equal(file.name, "Tahansoe Protection Agent");
    assert.ok(file.description.includes("borrow"));
    assert.equal(file.active, true);
    assert.equal(file.x402Support, false);
    assert.deepEqual(file.supportedTrust, ["reputation"]);
    assert.equal(file.strategyVersion, "pp-2026.11.1");

    // Services
    assert.equal(file.services.length, 2);
    assert.equal(file.services[0]?.name, "web");
    assert.equal(file.services[0]?.endpoint, "https://tahansoe.xyz");
    assert.equal(file.services[1]?.name, "scorecard");
    assert.equal(file.services[1]?.endpoint, "https://tahansoe.xyz/scorecard");

    // Guardians from chain registry
    assert.ok(file.supportedGuardians.length >= 2);
    assert.ok(file.supportedGuardians.some((g) => g.version === 1));
    assert.ok(file.supportedGuardians.some((g) => g.version === 4));
  });

  it("allows custom overrides for name, strategyVersion, and URLs", () => {
    const file = buildRegistrationFile({
      name: "Custom Agent",
      strategyVersion: "custom-v2",
      webUrl: "https://custom.tahansoe.xyz",
      scorecardUrl: "https://custom.tahansoe.xyz/score",
      chainConfig: ARBITRUM_ONE,
    });

    assert.equal(file.name, "Custom Agent");
    assert.equal(file.strategyVersion, "custom-v2");
    assert.equal(file.services[0]?.endpoint, "https://custom.tahansoe.xyz");
    assert.equal(file.services[1]?.endpoint, "https://custom.tahansoe.xyz/score");
  });
});

describe("Reputation from settlement: outcome mapping", () => {
  it("maps explicit tags: protection / preempt / false-positive / missed", () => {
    assert.deepEqual(mapOutcomeToFeedbackValues({ tag: "protection" }), {
      tag1: "protection",
      defaultValue: 100n,
      defaultDecimals: 0,
    });

    assert.deepEqual(mapOutcomeToFeedbackValues({ tag: "preempt" }), {
      tag1: "preempt",
      defaultValue: 100n,
      defaultDecimals: 0,
    });

    assert.deepEqual(mapOutcomeToFeedbackValues({ tag: "false-positive" }), {
      tag1: "false-positive",
      defaultValue: -50n,
      defaultDecimals: 0,
    });

    assert.deepEqual(mapOutcomeToFeedbackValues({ tag: "missed" }), {
      tag1: "missed",
      defaultValue: -100n,
      defaultDecimals: 0,
    });
  });

  it("maps settlement labels (spec §3.5)", () => {
    // TRUE_POSITIVE without preempt -> protection
    assert.equal(mapOutcomeToFeedbackValues({ label: "TRUE_POSITIVE" }).tag1, "protection");
    // TRUE_POSITIVE with preempt -> preempt
    assert.equal(
      mapOutcomeToFeedbackValues({ label: "TRUE_POSITIVE", isPreempt: true }).tag1,
      "preempt"
    );
    // FALSE_POSITIVE -> false-positive
    assert.equal(mapOutcomeToFeedbackValues({ label: "FALSE_POSITIVE" }).tag1, "false-positive");
    // MISSED -> missed
    assert.equal(mapOutcomeToFeedbackValues({ label: "MISSED" }).tag1, "missed");
  });

  it("buildFeedback uses outcome value override when provided", () => {
    const call = buildFeedback({
      agentId: 2n,
      tag: "preempt",
      value: 88n,
      valueDecimals: 2,
    });

    assert.equal(call.agentId, 2n);
    assert.equal(call.tag1, "preempt");
    assert.equal(call.value, 88n);
    assert.equal(call.valueDecimals, 2);
  });
});

describe("Sybil filter (ADR 0017)", () => {
  it("filters out clients that do not hold a policy on our Guardians", async () => {
    const clients: Address[] = [
      "0x1111111111111111111111111111111111111111",
      "0x2222222222222222222222222222222222222222",
      "0x3333333333333333333333333333333333333333",
    ];

    // Only 0x2222 has a policy
    const isEligible = (addr: Address) => addr.toLowerCase() === clients[1]!.toLowerCase();

    const filtered = await filterSybilClients(clients, isEligible);

    assert.equal(filtered.length, 1);
    assert.equal(filtered[0], clients[1]);
  });

  it("returns empty array when no clients have policies", async () => {
    const clients: Address[] = [
      "0x1111111111111111111111111111111111111111",
      "0x3333333333333333333333333333333333333333",
    ];

    const filtered = await filterSybilClients(clients, () => false);
    assert.equal(filtered.length, 0);
  });
});

describe("Read helpers", () => {
  it("getAgent returns parsed data on success", async () => {
    const mockClient = {
      readContract: async ({ functionName }: { functionName: string }) => {
        if (functionName === "ownerOf") return "0x1111111111111111111111111111111111111111";
        if (functionName === "getAgentWallet") return "0x2222222222222222222222222222222222222222";
        if (functionName === "tokenURI") return "https://example.com/agent.json";
        throw new Error("unknown function");
      },
    } as any;

    const agent = await getAgent(mockClient, ARBITRUM_SEPOLIA, 1n);
    assert.ok(agent);
    assert.equal(agent.agentId, 1n);
    assert.equal(agent.owner, "0x1111111111111111111111111111111111111111");
    assert.equal(agent.agentWallet, "0x2222222222222222222222222222222222222222");
    assert.equal(agent.agentURI, "https://example.com/agent.json");
  });

  it("getAgent returns null if ownerOf reverts (unregistered)", async () => {
    const mockClient = {
      readContract: async () => {
        throw new Error("ERC721NonexistentToken");
      },
    } as any;

    const agent = await getAgent(mockClient, ARBITRUM_SEPOLIA, 999n);
    assert.equal(agent, null);
  });

  it("getReputationSummary returns 0 count and avoids contract call when clientAddresses is empty", async () => {
    let contractCalled = false;
    const mockClient = {
      readContract: async () => {
        contractCalled = true;
        return [0n, 0n, 0];
      },
    } as any;

    const summary = await getReputationSummary(mockClient, ARBITRUM_SEPOLIA, 1n, []);
    assert.equal(contractCalled, false);
    assert.equal(summary.count, 0n);
    assert.equal(summary.summaryValue, 0n);
  });

  it("getReputationSummary queries contract when clientAddresses are present", async () => {
    const mockClient = {
      readContract: async () => {
        return [3n, 92n, 0];
      },
    } as any;

    const summary = await getReputationSummary(mockClient, ARBITRUM_SEPOLIA, 1n, [
      "0x1111111111111111111111111111111111111111",
    ]);
    assert.equal(summary.count, 3n);
    assert.equal(summary.summaryValue, 92n);
    assert.equal(summary.summaryValueDecimals, 0);
  });
});

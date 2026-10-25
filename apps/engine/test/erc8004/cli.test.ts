import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ARBITRUM_SEPOLIA } from "@tahansoe/domain";
import { agentCommand } from "../../src/cli/commands/agent.ts";
import { EXIT_OK, EXIT_ERROR } from "../../src/cli/commands/args.ts";

describe("CLI tahansoe agent identity", () => {
  it("help outputs AGENT_HELP and exits with code 0", async () => {
    let output = "";
    const code = await agentCommand(["--help"], {
      stdout: (m) => {
        output += m + "\n";
      },
    });

    assert.equal(code, EXIT_OK);
    assert.ok(output.includes("tahansoe agent identity"));
    assert.ok(output.includes("prepare-register"));
    assert.ok(output.includes("prepare-feedback"));
  });

  it("prepare-register dry-run prints target contract, calldata and does not submit tx", async () => {
    let output = "";
    const code = await agentCommand(["identity", "prepare-register", "--json"], {
      stdout: (m) => {
        output += m + "\n";
      },
    });

    assert.equal(code, EXIT_OK);
    const parsed = JSON.parse(output);
    assert.equal(parsed.subcommand, "prepare-register");
    assert.equal(parsed.to, ARBITRUM_SEPOLIA.erc8004?.identity);
    assert.ok(parsed.data.startsWith("0xf2c298be")); // register(string)
  });

  it("prepare-feedback dry-run prints target contract, calldata and parameters", async () => {
    let output = "";
    const code = await agentCommand(
      [
        "identity",
        "prepare-feedback",
        "--agent-id",
        "1",
        "--outcome",
        "preempt",
        "--json",
      ],
      {
        stdout: (m) => {
          output += m + "\n";
        },
      }
    );

    assert.equal(code, EXIT_OK);
    const parsed = JSON.parse(output);
    assert.equal(parsed.subcommand, "prepare-feedback");
    assert.equal(parsed.to, ARBITRUM_SEPOLIA.erc8004?.reputation);
    assert.equal(parsed.tag1, "preempt");
    assert.equal(parsed.value, "100");
    assert.ok(parsed.data.startsWith("0x3c036a7e")); // giveFeedback(...)
  });

  it("show handles unregistered agent gracefully", async () => {
    let output = "";
    const mockClient = {
      readContract: async () => {
        throw new Error("ERC721NonexistentToken");
      },
    } as any;

    const code = await agentCommand(["identity", "show", "--agent-id", "999", "--json"], {
      client: mockClient,
      stdout: (m) => {
        output += m + "\n";
      },
    });

    assert.equal(code, EXIT_OK);
    const parsed = JSON.parse(output);
    assert.equal(parsed.registered, false);
    assert.equal(parsed.agentId, "999");
  });

  it("show formats registered agent and Sybil-filtered reputation correctly", async () => {
    let output = "";
    const mockClient = {
      readContract: async ({ functionName }: { functionName: string }) => {
        if (functionName === "ownerOf") return "0x1111111111111111111111111111111111111111";
        if (functionName === "getAgentWallet") return "0x2222222222222222222222222222222222222222";
        if (functionName === "tokenURI") return "https://example.com/agent.json";
        if (functionName === "getClients") return ["0x3333333333333333333333333333333333333333"];
        if (functionName === "debtAssetsOf") return ["0xUSDC"]; // has policy!
        if (functionName === "getSummary") return [1n, 95n, 0];
        throw new Error("unknown function: " + functionName);
      },
    } as any;

    const code = await agentCommand(["identity", "show", "--agent-id", "1", "--json"], {
      client: mockClient,
      stdout: (m) => {
        output += m + "\n";
      },
    });

    assert.equal(code, EXIT_OK);
    const parsed = JSON.parse(output);
    assert.equal(parsed.registered, true);
    assert.equal(parsed.owner, "0x1111111111111111111111111111111111111111");
    assert.equal(parsed.reputation.count, "1");
    assert.equal(parsed.reputation.summaryValue, "95");
    assert.equal(parsed.reputation.filteredClientsCount, 1);
  });
});

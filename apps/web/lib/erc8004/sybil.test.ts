import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Address } from "viem";
import { filterSybilClients } from "./sybil";

describe("Web ERC-8004 Sybil filter (ADR 0017)", () => {
  it("filters client addresses retaining only those with active Guardian policies", async () => {
    const clients: Address[] = [
      "0x1111111111111111111111111111111111111111",
      "0x2222222222222222222222222222222222222222",
      "0x3333333333333333333333333333333333333333",
    ];

    const hasPolicy = async (client: Address) => {
      return client.toLowerCase() === clients[0]!.toLowerCase();
    };

    const verified = await filterSybilClients(clients, hasPolicy);
    assert.equal(verified.length, 1);
    assert.equal(verified[0], clients[0]);
  });

  it("returns an empty array when no clients have policies", async () => {
    const clients: Address[] = [
      "0x1111111111111111111111111111111111111111",
      "0x2222222222222222222222222222222222222222",
    ];

    const verified = await filterSybilClients(clients, async () => false);
    assert.equal(verified.length, 0);
  });
});

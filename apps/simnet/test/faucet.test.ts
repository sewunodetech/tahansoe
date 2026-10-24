import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encodeAbiParameters, keccak256 } from "viem";
import { TOKEN_SLOTS } from "../src/config.ts";
import { balanceSlotKey, FaucetLedger, FaucetLimitError } from "../src/faucet.ts";

describe("FaucetLedger limits", () => {
  it("allows up to 100 ETH cumulative, counting ETH and WETH together", () => {
    const l = new FaucetLedger();
    l.reserve("ETH", 10);
    l.reserve("WETH", 60);
    l.reserve("ETH", 30);
    assert.equal(l.remaining("ETH"), 0);
    assert.throws(() => l.reserve("WETH", 0.001), FaucetLimitError);
    assert.throws(() => l.reserve("ETH", 1), (e: unknown) => e instanceof FaucetLimitError && e.remaining === 0);
  });

  it("allows up to 50,000 USDC cumulative", () => {
    const l = new FaucetLedger();
    l.reserve("USDC", 5_000);
    assert.throws(() => l.reserve("USDC", 45_001), (e: unknown) => e instanceof FaucetLimitError && e.remaining === 45_000);
    l.reserve("USDC", 45_000);
    assert.equal(l.remaining("USDC"), 0);
    assert.equal(l.remaining("ETH"), 100, "USDC does not touch the ETH cap");
  });

  it("a rejected request does not consume the cap", () => {
    const l = new FaucetLedger();
    assert.throws(() => l.reserve("ETH", 101), FaucetLimitError);
    assert.equal(l.remaining("ETH"), 100);
  });

  it("release returns a reservation after a failed chain write", () => {
    const l = new FaucetLedger();
    l.reserve("USDC", 1_000);
    l.release("USDC", 1_000);
    assert.equal(l.remaining("USDC"), 50_000);
  });

  it("rejects non-positive and non-finite amounts", () => {
    const l = new FaucetLedger();
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) assert.throws(() => l.reserve("ETH", bad));
  });
});

describe("balance slot", () => {
  it("is keccak256(abi.encode(holder, slot))", () => {
    const holder = "0x000000000000000000000000000000000000dEaD" as const;
    const expected = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [holder, 51n]));
    assert.equal(balanceSlotKey(holder, 51), expected);
  });

  it("records a slot per token", () => {
    assert.equal(TOKEN_SLOTS.WETH.balanceSlot, 51);
    assert.equal(TOKEN_SLOTS.USDC.balanceSlot, 9);
    assert.equal(TOKEN_SLOTS.USDC.decimals, 6);
  });
});

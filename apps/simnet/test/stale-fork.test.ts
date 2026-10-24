import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isStaleForkError } from "../src/sessions.ts";

describe("isStaleForkError", () => {
  it("recognizes a pruned fork block from a non-archive upstream", () => {
    const e = Object.assign(new Error("RPC Request failed."), {
      details:
        "failed to get account for 0x3f26: server returned an error response: error code -32000: historical state e058181a is not available",
    });
    assert.equal(isStaleForkError(e), true);
    assert.equal(isStaleForkError(new Error("missing trie node 5a1f (path )")), true);
  });

  it("ignores ordinary failures", () => {
    assert.equal(isStaleForkError(new Error("execution reverted")), false);
    assert.equal(isStaleForkError("timeout"), false);
  });
});

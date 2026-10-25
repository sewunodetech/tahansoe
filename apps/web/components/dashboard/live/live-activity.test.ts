import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mergeActivityRows,
  type ActivityRow,
} from "./live-activity";

describe("LiveActivity row merging & ordering", () => {
  it("merges v1 and v4 activity rows ordered by block descending", () => {
    const v1Rows: ActivityRow[] = [
      {
        key: "0x1111-1",
        block: 314000000n,
        hash: "0x1111",
        version: 1,
        label: "Policy saved",
        detail: "USDC · trigger 1.30 → target 1.60",
      },
      {
        key: "0x2222-2",
        block: 314100000n,
        hash: "0x2222",
        version: 1,
        label: "Debt repaid",
        detail: "HF 1.25 → 1.62 · USDC",
      },
    ];

    const v4Rows: ActivityRow[] = [
      {
        key: "0x3333-1",
        block: 322500000n,
        hash: "0x3333",
        version: 4,
        label: "Policy saved",
        detail: "USDC · trigger 1.20 → target 1.50",
      },
      {
        key: "0x4444-1",
        block: 322600000n,
        hash: "0x4444",
        version: 4,
        label: "Fee charged",
        detail: "USDC · fee 1.50",
      },
    ];

    const merged = mergeActivityRows(v1Rows, v4Rows);

    assert.equal(merged.length, 4);
    assert.deepEqual(
      merged.map((r) => ({ version: r.version, block: r.block })),
      [
        { version: 4, block: 322600000n },
        { version: 4, block: 322500000n },
        { version: 1, block: 314100000n },
        { version: 1, block: 314000000n },
      ]
    );
  });

  it("handles identical block numbers stably", () => {
    const rowA: ActivityRow = {
      key: "0xa-1",
      block: 322500000n,
      hash: "0xa",
      version: 4,
      label: "Layer 1 executed",
      detail: "Repaid USDC via Layer 1",
    };
    const rowB: ActivityRow = {
      key: "0xb-2",
      block: 322500000n,
      hash: "0xb",
      version: 4,
      label: "Fee charged",
      detail: "USDC · fee 0.50",
    };

    const merged = mergeActivityRows([rowA], [rowB]);
    assert.equal(merged.length, 2);
    assert.equal(merged[0].block, 322500000n);
    assert.equal(merged[1].block, 322500000n);
  });

  it("handles empty lists gracefully", () => {
    const merged = mergeActivityRows([], []);
    assert.deepEqual(merged, []);
  });
});

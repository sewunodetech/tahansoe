import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLayer2Kind, calculateL2CapacityUsd } from "@/lib/reserves";

test("parseLayer2Kind - maps raw contract uint8 to typed kinds", () => {
  assert.equal(parseLayer2Kind(1), "erc4626");
  assert.equal(parseLayer2Kind(2), "atoken");
  assert.equal(parseLayer2Kind(0), null);
  assert.equal(parseLayer2Kind(null), null);
  assert.equal(parseLayer2Kind(undefined), null);
  assert.equal(parseLayer2Kind(99), null);
});

test("calculateL2CapacityUsd - min(assetsValue, capPerAction, allowance) in USD", () => {
  const priceBase = 100_000_000n; // $1.00
  const decimals = 6;

  // Case 1: assetsValue is the bottleneck
  // assetsValue: 300, cap: 500, allowance: 500 -> capacity: 300
  const cap1 = calculateL2CapacityUsd({
    assetsValue: 300_000_000n,
    capPerAction: 500_000_000n,
    allowance: 500_000_000n,
    decimals,
    priceBase,
  });
  assert.equal(cap1, 300);

  // Case 2: capPerAction is the bottleneck
  // assetsValue: 1000, cap: 400, allowance: 1000 -> capacity: 400
  const cap2 = calculateL2CapacityUsd({
    assetsValue: 1000_000_000n,
    capPerAction: 400_000_000n,
    allowance: 1000_000_000n,
    decimals,
    priceBase,
  });
  assert.equal(cap2, 400);

  // Case 3: allowance is the bottleneck
  // assetsValue: 1000, cap: 500, allowance: 200 -> capacity: 200
  const cap3 = calculateL2CapacityUsd({
    assetsValue: 1000_000_000n,
    capPerAction: 500_000_000n,
    allowance: 200_000_000n,
    decimals,
    priceBase,
  });
  assert.equal(cap3, 200);

  // Case 4: allowance is 0 -> capacity: 0
  const capZero = calculateL2CapacityUsd({
    assetsValue: 1000_000_000n,
    capPerAction: 500_000_000n,
    allowance: 0n,
    decimals,
    priceBase,
  });
  assert.equal(capZero, 0);

  // Case 5: null when any parameter is missing
  assert.equal(
    calculateL2CapacityUsd({
      assetsValue: null,
      capPerAction: 500_000_000n,
      allowance: 500_000_000n,
      decimals,
      priceBase,
    }),
    null
  );
  assert.equal(
    calculateL2CapacityUsd({
      assetsValue: 500_000_000n,
      capPerAction: null,
      allowance: 500_000_000n,
      decimals,
      priceBase,
    }),
    null
  );
  assert.equal(
    calculateL2CapacityUsd({
      assetsValue: 500_000_000n,
      capPerAction: 500_000_000n,
      allowance: null,
      decimals,
      priceBase,
    }),
    null
  );
  assert.equal(
    calculateL2CapacityUsd({
      assetsValue: 500_000_000n,
      capPerAction: 500_000_000n,
      allowance: 500_000_000n,
      decimals,
      priceBase: null,
    }),
    null
  );
});

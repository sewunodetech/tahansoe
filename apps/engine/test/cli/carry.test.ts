import { test } from "node:test";
import assert from "node:assert/strict";
import { carryCommand, getReserveStatus } from "../../src/cli/commands/carry.ts";
import type { AaveRatesResult } from "../../src/sources/aave-rates.ts";

function createMockRates(): AaveRatesResult {
  return {
    sampledAt: new Date("2026-10-09T12:00:00Z"),
    warnings: [],
    reserves: [
      {
        asset: "USDC",
        address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
        supplyApr: 0.040,
        supplyApy: 0.041,
        borrowApr: 0.055,
        borrowApy: 0.056,
        utilization: 0.88,
        curve: {
          baseRate: 0.0,
          slope1: 0.04,
          slope2: 0.60,
          optimalUtil: 0.90,
        },
      },
      {
        asset: "WETH",
        address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
        supplyApr: 0.019,
        supplyApy: 0.019,
        borrowApr: 0.027,
        borrowApy: 0.027,
        utilization: 0.71,
        curve: {
          baseRate: 0.0,
          slope1: 0.03,
          slope2: 0.80,
          optimalUtil: 0.80,
        },
      },
      {
        asset: "wstETH",
        address: "0x5979D7b546E38E414F7E9822514be443A4800529",
        supplyApr: 0.002,
        supplyApy: 0.002,
        borrowApr: 0.015,
        borrowApy: 0.015,
        utilization: 0.50,
        curve: {
          baseRate: 0.0,
          slope1: 0.03,
          slope2: 0.80,
          optimalUtil: 0.80,
        },
      },
      {
        asset: "USDT",
        address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
        supplyApr: 0.035,
        supplyApy: 0.036,
        borrowApr: 0.060,
        borrowApy: 0.062,
        utilization: 0.85,
        curve: {
          baseRate: 0.0,
          slope1: 0.04,
          slope2: 0.75,
          optimalUtil: 0.90,
        },
      },
      {
        asset: "WBTC",
        address: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f",
        supplyApr: 0.005,
        supplyApy: 0.005,
        borrowApr: 0.018,
        borrowApy: 0.018,
        utilization: 0.40,
        curve: {
          baseRate: 0.0,
          slope1: 0.02,
          slope2: 0.80,
          optimalUtil: 0.80,
        },
      },
    ],
  };
}

const PROHIBITED_WORDS = [
  "best",
  "recommend",
  "switch",
  "should buy",
  "should sell",
];

test("getReserveStatus logic", () => {
  assert.equal(getReserveStatus(0.80, 0.90), "ok");
  assert.equal(getReserveStatus(0.87, 0.90), "near kink"); // >= 0.87 (0.90 - 0.03)
  assert.equal(getReserveStatus(0.89, 0.90), "near kink");
  assert.equal(getReserveStatus(0.90, 0.90), "past kink");
  assert.equal(getReserveStatus(0.95, 0.90), "past kink");
  assert.equal(getReserveStatus(0.80, null), "ok");
});

test("tahansoe carry: renders table and footer", async () => {
  let stdout = "";
  const code = await carryCommand([], {
    fetchRates: async () => createMockRates(),
    stdout: (s) => {
      stdout += s;
    },
  });

  assert.equal(code, 0);
  assert.ok(stdout.includes("carry & interest · Aave V3 Arbitrum One"));
  assert.ok(stdout.includes("USDC"));
  assert.ok(stdout.includes("WETH"));
  assert.ok(stdout.includes("wstETH"));
  assert.ok(stdout.includes("near kink"));
  assert.ok(stdout.includes("HF 1.50 → 1.45"));
  assert.ok(stdout.includes("informational · not investment advice"));
});

test("tahansoe carry --json: emits structured JSON", async () => {
  let stdout = "";
  const code = await carryCommand(["--json"], {
    fetchRates: async () => createMockRates(),
    stdout: (s) => {
      stdout += s;
    },
  });

  assert.equal(code, 0);
  const data = JSON.parse(stdout);
  assert.equal(data.ok, true);
  assert.equal(data.chainId, 42161);
  assert.equal(data.reserves.length, 5);
  assert.equal(data.pairs.length, 5);
  assert.equal(data.footer, "informational · not investment advice");
});

test("tahansoe carry: PROHIBITED WORDS are NEVER present in text or json output", async () => {
  // 1. Text mode
  let textOut = "";
  await carryCommand([], {
    fetchRates: async () => createMockRates(),
    stdout: (s) => {
      textOut += s;
    },
  });

  const lowerText = textOut.toLowerCase();
  for (const word of PROHIBITED_WORDS) {
    const regex = new RegExp(`\\b${word}\\b`, "i");
    assert.ok(
      !regex.test(lowerText),
      `Prohibited advisory word "${word}" found in carry text output!`,
    );
  }

  // 2. JSON mode
  let jsonOut = "";
  await carryCommand(["--json"], {
    fetchRates: async () => createMockRates(),
    stdout: (s) => {
      jsonOut += s;
    },
  });

  const lowerJson = jsonOut.toLowerCase();
  for (const word of PROHIBITED_WORDS) {
    const regex = new RegExp(`\\b${word}\\b`, "i");
    assert.ok(
      !regex.test(lowerJson),
      `Prohibited advisory word "${word}" found in carry JSON output!`,
    );
  }
});

/**
 * Test unit CLI subcommand `tahansoe agent plans` (spec §3.2-3.3).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { agentCommand } from "../../src/cli/commands/agent.ts";
import { EXIT_OK, EXIT_CONFIG, EXIT_ERROR } from "../../src/cli/commands/args.ts";

test("agentCommand: --help menampilkan panduan", async () => {
  let output = "";
  const code = await agentCommand(["--help"], {
    stdout: (s) => {
      output += s;
    },
  });
  assert.equal(code, EXIT_OK);
  assert.match(output, /tahansoe agent plans/);
});

test("agentCommand: menolak subcommand yang tidak dikenal", async () => {
  let errOutput = "";
  const code = await agentCommand(["unknown-sub"], {
    stderr: (s) => {
      errOutput += s;
    },
  });
  assert.equal(code, EXIT_ERROR);
  assert.match(errOutput, /subcommand agent tidak dikenal/);
});

test("agentCommand plans: mengembalikan EXIT_CONFIG jika DATABASE_URL tidak diset", async () => {
  const origEnv = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;

  try {
    let errOutput = "";
    const code = await agentCommand(["plans"], {
      stderr: (s) => {
        errOutput += s;
      },
    });
    assert.equal(code, EXIT_CONFIG);
    assert.match(errOutput, /DATABASE_URL belum diset/);
  } finally {
    if (origEnv) process.env.DATABASE_URL = origEnv;
  }
});

test("agentCommand plans: membaca dan menampilkan plans dari DB", async () => {
  const mockRows = [
    {
      id: "plan-uuid-1",
      positionKey: "aave-v3:421614:0xguardian:0xusdc",
      strategyVersion: "pp-2026.10.0",
      action: "REPAY_WALLET",
      amount: "250000000",
      triggerHf: null,
      healthFactor: "1.2500",
      expectedHfAfter: "1.5500",
      urgency: "MEDIUM",
      regime: "STRESSED",
      drivers: ["sig-1"],
      playbookIds: ["pb-1"],
      planHash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      decision: "ACCEPTED",
      rejectReason: null,
      mode: "SHADOW",
      createdAt: new Date("2026-10-25T10:00:00.000Z"),
    },
  ];

  const fakeDb: any = {
    select: () => ({
      from: () => ({
        orderBy: () => ({
          limit: async () => mockRows,
        }),
        where: () => ({
          orderBy: () => ({
            limit: async () => mockRows,
          }),
        }),
      }),
    }),
  };

  // Test 1: format tabel
  let stdoutTable = "";
  const code1 = await agentCommand(["plans"], {
    db: fakeDb,
    stdout: (s) => {
      stdoutTable += s;
    },
  });
  assert.equal(code1, EXIT_OK);
  assert.match(stdoutTable, /REPAY_WALLET/);
  assert.match(stdoutTable, /ACCEPTED/);

  // Test 2: format JSON
  let stdoutJson = "";
  const code2 = await agentCommand(["plans", "--json"], {
    db: fakeDb,
    stdout: (s) => {
      stdoutJson += s;
    },
  });
  assert.equal(code2, EXIT_OK);
  const parsed = JSON.parse(stdoutJson);
  assert.equal(Array.isArray(parsed), true);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].action, "REPAY_WALLET");
  assert.equal(parsed[0].decision, "ACCEPTED");
});

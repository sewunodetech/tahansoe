import test from "node:test";
import assert from "node:assert/strict";
import { sentinelCommand, SENTINEL_HELP } from "../../src/cli/commands/sentinel.ts";
import { InMemorySentinelDatabase } from "../../src/sentinel/db-adapter.ts";
import { EXIT_OK, EXIT_ERROR } from "../../src/cli/commands/args.ts";

test("sentinel CLI: --help menampilkan bantuan", async () => {
  const output: string[] = [];
  const code = await sentinelCommand(["--help"], {
    stdout: (m) => output.push(m),
  });

  assert.equal(code, EXIT_OK);
  assert.equal(output.join("\n"), SENTINEL_HELP);
});

test("sentinel CLI: subcommand sync menjalankan syncEvents", async () => {
  const output: string[] = [];
  const db = new InMemorySentinelDatabase();
  let syncCalled = false;

  const code = await sentinelCommand(["sync"], {
    db,
    stdout: (m) => output.push(m),
    syncEvents: async () => {
      syncCalled = true;
      return { logsProcessed: 5, fromBlock: 100n, toBlock: 200n };
    },
  });

  assert.equal(code, EXIT_OK);
  assert.equal(syncCalled, true);
  assert.match(output.join("\n"), /Sync selesai: 5 log diproses/);
});

test("sentinel CLI: subcommand once menjalankan satu siklus tick", async () => {
  const output: string[] = [];
  const db = new InMemorySentinelDatabase();
  let tickCalled = false;

  const mockWorker: any = {
    async tick() {
      tickCalled = true;
      return {
        syncedLogs: 0,
        checkedUsers: 3,
        transitions: [],
        alertsSent: 0,
        keeperActions: [],
      };
    },
  };

  const code = await sentinelCommand(["once"], {
    db,
    stdout: (m) => output.push(m),
    worker: mockWorker,
  });

  assert.equal(code, EXIT_OK);
  assert.equal(tickCalled, true);
  assert.match(output.join("\n"), /3 user diperiksa/);
});

test("sentinel CLI: subcommand tidak dikenal mengembalikan EXIT_ERROR", async () => {
  const errors: string[] = [];
  const code = await sentinelCommand(["unknown-cmd"], {
    stderr: (m) => errors.push(m),
  });

  assert.equal(code, EXIT_ERROR);
  assert.match(errors.join("\n"), /subcommand sentinel tidak dikenal/);
});


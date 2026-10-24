import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getTableName } from "drizzle-orm";
import {
  simSessions,
  policies,
  intents,
  runMigrations,
  type SqlExecutor,
} from "../src";

describe("packages/db simulation and success fee schema (specs m1 §3.9 & m4 §3.5)", () => {
  it("sim_sessions table has exact columns and index per spec m1 §3.9", () => {
    assert.ok(simSessions);
    // Table name
    assert.equal(getTableName(simSessions), "sim_sessions");

    // Columns
    const cols = simSessions;
    assert.ok(cols.id, "id column exists");
    assert.ok(cols.address, "address column exists");
    assert.ok(cols.mode, "mode column exists");
    assert.ok(cols.scenario, "scenario column exists");
    assert.ok(cols.forkId, "forkId column exists");
    assert.ok(cols.createdAt, "createdAt column exists");
    assert.ok(cols.positionOpenedAt, "positionOpenedAt column exists");
    assert.ok(cols.firstProtectAt, "firstProtectAt column exists");
    assert.ok(cols.layersUsed, "layersUsed column exists");
    assert.ok(cols.convertedAt, "convertedAt column exists");
    assert.ok(cols.userAgentHash, "userAgentHash column exists");

    // layers_used is integer[]
    assert.equal(cols.layersUsed.getSQLType(), "integer[]");
  });

  it("intents table has nullable fee_amount and fee_waived columns", () => {
    assert.ok(intents);
    const cols = intents;
    assert.ok(cols.feeAmount, "feeAmount column exists");
    assert.ok(cols.feeWaived, "feeWaived column exists");
    assert.equal(cols.feeAmount.getSQLType(), "numeric(38, 18)");
    assert.equal(cols.feeWaived.getSQLType(), "numeric(38, 18)");
    assert.equal(cols.feeAmount.notNull, false, "fee_amount should be nullable");
    assert.equal(cols.feeWaived.notNull, false, "fee_waived should be nullable");
  });

  it("policies and intents tables have nullable position_key per spec m4 §3.6", () => {
    assert.ok(policies);
    assert.ok(policies.positionKey, "policies.positionKey column exists");
    assert.equal(policies.positionKey.getSQLType(), "text");
    assert.equal(policies.positionKey.notNull, false, "policies.position_key should be nullable");

    assert.ok(intents);
    assert.ok(intents.positionKey, "intents.positionKey column exists");
    assert.equal(intents.positionKey.getSQLType(), "text");
    assert.equal(intents.positionKey.notNull, false, "intents.position_key should be nullable");
  });

  it("runMigrations produces idempotent DDL for sim_sessions and intent fee columns", async () => {
    const executedSql: string[] = [];
    const mockExecutor: SqlExecutor = {
      async query(sql: string) {
        executedSql.push(sql);
        // Pretend enums already exist
        return { rows: [{ exists: true }] };
      },
      async exec(sql: string) {
        executedSql.push(sql);
      },
    };

    await runMigrations(mockExecutor, { quiet: true });

    const allSql = executedSql.join("\n");

    // Must create sim_sessions table with IF NOT EXISTS
    assert.ok(
      allSql.includes("CREATE TABLE IF NOT EXISTS sim_sessions"),
      "Should include CREATE TABLE IF NOT EXISTS sim_sessions"
    );
    // Must create sim_sessions_created_at_idx index
    assert.ok(
      allSql.includes("CREATE INDEX IF NOT EXISTS sim_sessions_created_at_idx ON sim_sessions (created_at)"),
      "Should create index on sim_sessions (created_at)"
    );
    // Must alter intents table for fee_amount and fee_waived with IF NOT EXISTS
    assert.ok(
      allSql.includes("ALTER TABLE intents ADD COLUMN IF NOT EXISTS fee_amount"),
      "Should alter intents for fee_amount"
    );
    assert.ok(
      allSql.includes("ALTER TABLE intents ADD COLUMN IF NOT EXISTS fee_waived"),
      "Should alter intents for fee_waived"
    );

    // Guardian v4 position_key idempotent DDL
    assert.ok(
      allSql.includes("ALTER TABLE policies ADD COLUMN IF NOT EXISTS position_key TEXT"),
      "Should alter policies for position_key"
    );
    assert.ok(
      allSql.includes("CREATE INDEX IF NOT EXISTS policies_position_key_idx ON policies (position_key)"),
      "Should create index on policies(position_key)"
    );
    assert.ok(
      allSql.includes("ALTER TABLE intents ADD COLUMN IF NOT EXISTS position_key TEXT"),
      "Should alter intents for position_key"
    );
  });
});

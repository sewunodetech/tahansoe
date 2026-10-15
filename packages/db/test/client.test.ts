import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { getDb, isDbConfigured, resetDbClient } from "../src/client";

describe("@tahansoe/db client (ADR 0011: Postgres server saja)", () => {
  const original = process.env.DATABASE_URL;
  afterEach(async () => {
    if (original === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = original;
    await resetDbClient();
  });

  it("isDbConfigured mengikuti DATABASE_URL", () => {
    assert.equal(isDbConfigured({}), false);
    assert.equal(isDbConfigured({ DATABASE_URL: "  " }), false);
    assert.equal(isDbConfigured({ DATABASE_URL: "postgres://u:p@h/db" }), true);
  });

  it("getDb melempar error jelas tanpa DATABASE_URL", async () => {
    delete process.env.DATABASE_URL;
    await resetDbClient();
    assert.throws(() => getDb(), /DATABASE_URL belum di-set/);
  });
});

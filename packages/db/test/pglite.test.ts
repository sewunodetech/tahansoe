import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { runMigrationsOnPglite } from "../src/migrate";
import {
  researchReports,
  signals,
  rateSamples,
  riskAssessments,
} from "../src/research";
import { getDb, ensureDb, resetDbClient } from "../src/client";

test("PGlite integration — migrations and CRUD operations (ADR 0010)", async (t) => {
  const client = new PGlite();
  await runMigrationsOnPglite(client);
  const db = drizzle(client);

  await t.test("inserts and selects research_reports with jsonb and enums", async () => {
    const reportData = {
      chainId: 42161,
      trigger: "SCHEDULED" as const,
      report: { summary: "Test research report", sentiment: "NEUTRAL" },
      analystReports: [{ analyst: "macro", text: "Rate cuts delayed" }],
      debate: { turns: [] },
      promptVersion: "2026.10.2",
      models: { orchestrator: "claude-3-5-sonnet" },
      usage: { totalTokens: 1250 },
      horizonEndsAt: new Date(Date.now() + 3600_000),
    };

    const [inserted] = await db.insert(researchReports).values(reportData).returning();
    assert.ok(inserted);
    assert.ok(inserted.id);
    assert.equal(inserted.chainId, 42161);
    assert.equal(inserted.trigger, "SCHEDULED");
    assert.deepEqual(inserted.report, { summary: "Test research report", sentiment: "NEUTRAL" });
    assert.equal(inserted.promptVersion, "2026.10.2");

    const [selected] = await db.select().from(researchReports).limit(1);
    assert.ok(selected);
    assert.equal(selected.id, inserted.id);
    assert.deepEqual(selected.models, { orchestrator: "claude-3-5-sonnet" });
  });

  await t.test("inserts and selects signals with jsonb paths and assets", async () => {
    const signalData = {
      chainId: 42161,
      module: "RESEARCH" as const,
      paths: ["T1", "T2"],
      assets: ["ETH", "USDC"],
      direction: "DOWN",
      severity: "0.4500",
      confidence: "0.8500",
      horizonHours: 24,
      observedAt: new Date(),
      expiresAt: new Date(Date.now() + 86400_000),
      evidence: { source: "research_agents", summary: "bearish divergence" },
    };

    const [sig] = await db.insert(signals).values(signalData).returning();
    assert.ok(sig);
    assert.ok(sig.id);
    assert.equal(sig.module, "RESEARCH");
    assert.equal(sig.direction, "DOWN");
    assert.equal(sig.severity, "0.4500");
    assert.deepEqual(sig.assets, ["ETH", "USDC"]);
    assert.deepEqual(sig.paths, ["T1", "T2"]);
  });

  await t.test("inserts and selects rate_samples", async () => {
    const rateData = {
      chainId: 42161,
      asset: "USDC",
      address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      supplyApy: "0.045000",
      borrowApr: "0.055000",
      borrowApy: "0.056000",
      utilization: "0.800000",
      optimalUtilization: "0.900000",
      slope1: "0.040000",
      slope2: "0.600000",
      baseRate: "0.000000",
    };

    const [sample] = await db.insert(rateSamples).values(rateData).returning();
    assert.ok(sample);
    assert.ok(sample.id);
    assert.equal(sample.asset, "USDC");
    assert.equal(sample.utilization, "0.800000");
  });

  await t.test("inserts and selects risk_assessments", async () => {
    const assessmentData = {
      chainId: 42161,
      asset: "ETH",
      regime: "CALM" as const,
      riskScore: "12.50",
      drawdownH4: "0.00800",
      drawdownH24: "0.01500",
      recommendedTriggerHf: "1.2500",
      recommendedTargetHf: "1.5000",
      drivers: [{ module: "RESEARCH", severity: 0.1 }],
      reasons: ["ALL-CLEAR"],
      explanation: "Market is calm across all indicators.",
      modelVersion: "1.0",
      validUntil: new Date(Date.now() + 3600_000),
    };

    const [risk] = await db.insert(riskAssessments).values(assessmentData).returning();
    assert.ok(risk);
    assert.ok(risk.id);
    assert.equal(risk.regime, "CALM");
    assert.equal(risk.asset, "ETH");
    assert.equal(risk.riskScore, "12.50");
  });

  await client.close();
});

test("PGlite client — getDb() lazy initialization and auto-migration", async () => {
  const originalEnv = { ...process.env };
  try {
    process.env.DB_DRIVER = "pglite";
    process.env.PGLITE_DATA_DIR = "memory://";
    delete process.env.DATABASE_URL;

    await resetDbClient();

    const db = await ensureDb();
    assert.ok(db, "db instance should be initialized");

    // Verify auto-migration ran by querying a table
    const result = await db.select().from(riskAssessments).limit(1);
    assert.ok(Array.isArray(result));
  } finally {
    process.env = originalEnv;
    await resetDbClient();
  }
});

test("PGlite client — first query via getDb() waits for auto-migration (no race on a fresh DB)", async () => {
  const prevDriver = process.env.DB_DRIVER;
  const prevDir = process.env.PGLITE_DATA_DIR;
  try {
    process.env.DB_DRIVER = "pglite";
    process.env.PGLITE_DATA_DIR = "memory://";
    await resetDbClient();
    // Query immediately via getDb() (not ensureDb()): must not hit "relation does not exist".
    const db = getDb();
    const rows = await db.select().from(rateSamples).limit(1);
    assert.deepEqual(rows, []);
  } finally {
    await resetDbClient();
    if (prevDriver === undefined) delete process.env.DB_DRIVER;
    else process.env.DB_DRIVER = prevDriver;
    if (prevDir === undefined) delete process.env.PGLITE_DATA_DIR;
    else process.env.PGLITE_DATA_DIR = prevDir;
  }
});

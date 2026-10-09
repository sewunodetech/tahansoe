/**
 * Unit test untuk Slash Commands REPL Tahansoe (spec m3-cli §3.5).
 *
 * Menguji:
 *  - Parsing argumen slash command (/analyze --dry, /report latest, kutip, dsb.)
 *  - Autocomplete Tab (slashCompleter)
 *  - Dispatch in-process dengan fakes (status, schedule hint, help, dsb.)
 *  - Isolasi error: kesalahan dalam satu command tidak membunuh REPL
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseSlashCommand,
  slashCompleter,
  dispatchSlashCommand,
  SCHEDULE_HINT,
  START_HINT,
  SLASH_COMMANDS,
} from "../../../src/cli/repl/repl.ts";
import { type ReplContext, createDefaultSourceFreshness } from "../../../src/cli/repl/context.ts";

const now = new Date("2026-10-09T14:06:00Z");

const dummyContext: ReplContext = {
  chainId: 42161,
  now,
  hasData: true,
  isStale: false,
  sourceFreshness: createDefaultSourceFreshness(now),
  staleSources: [],
  latestReport: {
    id: "a91f1234-5678",
    createdAt: new Date("2026-10-09T14:01:00Z"),
    report: {
      assets: ["ETH", "USDC"],
      proposedRegime: "ELEVATED",
      direction: "DOWN",
      confidence: 0.55,
      horizonHours: 24,
      paths: [],
      keyDevelopments: [],
      hawkCase: "hawk",
      doveCase: "dove",
    },
  },
  reportsLast24h: [],
  assessments: [
    {
      asset: "ETH",
      regime: "ELEVATED",
      riskScore: 50,
      recommendedTriggerHf: 1.35,
      recommendedTargetHf: 1.65,
      reasons: ["R-ONCHAIN-STRESS"],
      explanation: "ETH elevated",
      validUntil: new Date("2026-10-09T16:00:00Z"),
      createdAt: new Date("2026-10-09T14:05:00Z"),
    },
    {
      asset: "USDC",
      regime: "ELEVATED",
      riskScore: 60,
      recommendedTriggerHf: 1.25,
      recommendedTargetHf: 1.55,
      reasons: ["T11-RATE-SPIKE"],
      explanation: "USDC elevated due to rates",
      validUntil: new Date("2026-10-09T16:00:00Z"),
      createdAt: new Date("2026-10-09T14:05:00Z"),
    },
  ],
  activeSignals: [],
  rateSamples: [],
  carryPairs: [],
  priceSummaries: [],
  macroEvents: [],
};

const dummyTheme = { color: false, width: 80 };

test("parseSlashCommand: parse nama command dan flags/argumen", () => {
  assert.equal(parseSlashCommand("not a slash"), null);
  assert.equal(parseSlashCommand("   "), null);

  const res1 = parseSlashCommand("/analyze --dry --assets ETH,USDC");
  assert.ok(res1);
  assert.equal(res1.command, "analyze");
  assert.deepEqual(res1.args, ["--dry", "--assets", "ETH,USDC"]);

  const res2 = parseSlashCommand('/report "a91f1234"');
  assert.ok(res2);
  assert.equal(res2.command, "report");
  assert.deepEqual(res2.args, ["a91f1234"]);

  const res3 = parseSlashCommand("/clear");
  assert.ok(res3);
  assert.equal(res3.command, "clear");
  assert.deepEqual(res3.args, []);

  const res4 = parseSlashCommand("/fuse");
  assert.ok(res4);
  assert.equal(res4.command, "fuse");
});

test("slashCompleter: Tab completion untuk slash commands", () => {
  const [hits1] = slashCompleter("/an");
  assert.deepEqual(hits1, ["/analyze"]);

  const [hits2] = slashCompleter("/c");
  assert.ok(hits2.includes("/carry"));
  assert.ok(hits2.includes("/clear"));

  const [allHits] = slashCompleter("/");
  assert.equal(allHits.length, SLASH_COMMANDS.length);

  const [emptyHits] = slashCompleter("not-slash");
  assert.deepEqual(emptyHits, []);
});

test("dispatchSlashCommand: /status menghasilkan baris status regime", async () => {
  const originalWrite = process.stdout.write;
  const chunks: string[] = [];
  process.stdout.write = ((chunk: string) => {
    chunks.push(chunk);
    return true;
  }) as unknown as typeof process.stdout.write;

  try {
    await dispatchSlashCommand("status", [], dummyContext, dummyTheme);
    const out = chunks.join("");
    assert.match(out, /Last: ETH ELEVATED, USDC ELEVATED/);
  } finally {
    process.stdout.write = originalWrite;
  }
});

test("dispatchSlashCommand: /schedule menampilkan hint bahwa proses dijalankan terpisah", async () => {
  const originalWrite = process.stdout.write;
  const chunks: string[] = [];
  process.stdout.write = ((chunk: string) => {
    chunks.push(chunk);
    return true;
  }) as unknown as typeof process.stdout.write;

  try {
    await dispatchSlashCommand("schedule", ["run"], dummyContext, dummyTheme);
    const out = chunks.join("");
    assert.match(out, /schedule run tidak tersedia di REPL/);
  } finally {
    process.stdout.write = originalWrite;
  }
});

test("dispatchSlashCommand: /start menampilkan hint bahwa proses dijalankan terpisah", async () => {
  const originalWrite = process.stdout.write;
  const chunks: string[] = [];
  process.stdout.write = ((chunk: string) => {
    chunks.push(chunk);
    return true;
  }) as unknown as typeof process.stdout.write;

  try {
    await dispatchSlashCommand("start", [], dummyContext, dummyTheme);
    const out = chunks.join("");
    assert.match(out, /start tidak tersedia di REPL/);
    assert.match(out, /tahansoe start/);
  } finally {
    process.stdout.write = originalWrite;
  }
});

test("dispatchSlashCommand: /help menampilkan daftar perintah", async () => {
  const originalWrite = process.stdout.write;
  const chunks: string[] = [];
  process.stdout.write = ((chunk: string) => {
    chunks.push(chunk);
    return true;
  }) as unknown as typeof process.stdout.write;

  try {
    await dispatchSlashCommand("help", [], dummyContext, dummyTheme);
    const out = chunks.join("");
    assert.match(out, /\/analyze/);
    assert.match(out, /\/carry/);
    assert.match(out, /\/fuse/);
    assert.match(out, /\/history/);
  } finally {
    process.stdout.write = originalWrite;
  }
});

test("dispatchSlashCommand: perintah tidak dikenal tidak melempar error", async () => {
  const originalWrite = process.stdout.write;
  const chunks: string[] = [];
  process.stdout.write = ((chunk: string) => {
    chunks.push(chunk);
    return true;
  }) as unknown as typeof process.stdout.write;

  try {
    await dispatchSlashCommand("unknowncmd", [], dummyContext, dummyTheme);
    const out = chunks.join("");
    assert.match(out, /Perintah slash tidak dikenal: \/unknowncmd/);
  } finally {
    process.stdout.write = originalWrite;
  }
});

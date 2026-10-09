/**
 * Test settle + scorecard CLI + scheduler settlement tick (offline, mock).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.TAHANSOE_SETTINGS = "/__tahansoe_no_settings__/settle.test.json";

import { settleCommand, scorecardCommand, renderScorecardBox } from "../../src/cli/commands/scorecard-settle.ts";
import { SettleTicker, settleIntervalMs, SETTLE_ADVISORY_LOCK_KEY } from "../../src/cli/commands/schedule.ts";
import { detectTheme } from "../../src/cli/render.ts";
import type { SettleJobResult } from "../../src/reflection/settle-job.ts";
import type { DetailedScorecard } from "../../src/reflection/scorecard.ts";

const noColor = detectTheme([], { NO_COLOR: "1" }, { isTTY: false });

function fakeSettleResult(): SettleJobResult {
  return {
    totalEvaluated: 3,
    settled: [
      { reportId: "aaaaaaaa1111", label: "TRUE_POSITIVE", leadTimeMinutes: 420 },
      { reportId: "bbbbbbbb2222", label: "TRUE_NEGATIVE", leadTimeMinutes: null },
    ],
    insufficientData: [{ reportId: "cccccccc3333", reason: "price samples kurang dalam horizon" }],
  };
}

function fakeScorecard(): DetailedScorecard {
  return {
    from: new Date("2026-09-09T00:00:00Z"),
    to: new Date("2026-10-09T00:00:00Z"),
    recall: 0.75,
    precision: 0.5,
    medianLeadTimeMinutes: 420,
    timeInStressedFraction: 0.08,
    schemaPassRate: 1,
    counts: {
      truePositive: 3,
      falsePositive: 3,
      missed: 1,
      trueNegative: 5,
      medianLeadTimeMinutes: 420,
      timeInStressedFraction: 0.08,
      schemaPassRate: 1,
    },
    totalSettled: 12,
    insufficientDataCount: 2,
  };
}

// --- settle ---------------------------------------------------------------

test("settle --json → JSON valid (mock job), exit 0", async () => {
  const chunks: string[] = [];
  const code = await settleCommand(["--json"], {
    runJob: async () => fakeSettleResult(),
    stdout: (s) => chunks.push(s),
    stderr: () => {},
  });
  assert.equal(code, 0);
  const out = JSON.parse(chunks.join(""));
  assert.equal(out.ok, true);
  assert.equal(out.totalEvaluated, 3);
  assert.equal(out.settled.length, 2);
  assert.equal(out.insufficientData.length, 1);
});

test("settle (tabel, no-color) → menampilkan label + lead time + insufficient", async () => {
  const chunks: string[] = [];
  const code = await settleCommand(["--no-color"], {
    runJob: async () => fakeSettleResult(),
    stdout: (s) => chunks.push(s),
    stderr: () => {},
  });
  assert.equal(code, 0);
  const out = chunks.join("");
  assert.match(out, /settled 2 · insufficient 1/);
  assert.match(out, /TRUE_POSITIVE/);
  assert.match(out, /420m/);
  assert.match(out, /insufficient data/);
  assert.match(out, /price samples kurang/);
  assert.match(out, /aaaaaaaa…/, "report id dipendekkan");
});

test("settle: --now invalid → exit 1", async () => {
  const code = await settleCommand(["--now", "bukan-tanggal"], {
    runJob: async () => fakeSettleResult(),
    stdout: () => {},
    stderr: () => {},
  });
  assert.equal(code, 1);
});

test("settle: --now valid diteruskan ke job", async () => {
  let received: Date | undefined;
  await settleCommand(["--now", "2026-10-09T00:00:00Z", "--json"], {
    runJob: async (opts) => {
      received = opts.now;
      return fakeSettleResult();
    },
    stdout: () => {},
    stderr: () => {},
  });
  assert.ok(received instanceof Date);
  assert.equal(received!.toISOString(), "2026-10-09T00:00:00.000Z");
});

test("settle: --help → exit 0", async () => {
  let out = "";
  const code = await settleCommand(["--help"], { stdout: (s) => void (out += s), stderr: () => {} });
  assert.equal(code, 0);
  assert.match(out, /tahansoe settle/);
});

// --- scorecard ------------------------------------------------------------

test("scorecard --json → JSON valid (mock), exit 0", async () => {
  const chunks: string[] = [];
  const code = await scorecardCommand(["--json", "--days", "30"], {
    generate: async () => fakeScorecard(),
    stdout: (s) => chunks.push(s),
    stderr: () => {},
  });
  assert.equal(code, 0);
  const out = JSON.parse(chunks.join(""));
  assert.equal(out.ok, true);
  assert.equal(out.recall, 0.75);
  assert.equal(out.precision, 0.5);
  assert.equal(out.totalSettled, 12);
});

test("scorecard box render (no color) — snapshot metrik kunci", async () => {
  const chunks: string[] = [];
  const code = await scorecardCommand(["--no-color"], {
    generate: async () => fakeScorecard(),
    stdout: (s) => chunks.push(s),
    stderr: () => {},
    now: new Date("2026-10-09T00:00:00Z"),
  });
  assert.equal(code, 0);
  const out = chunks.join("");
  assert.match(out, /SCORECARD/);
  assert.match(out, /Recall \(TP\/\[TP\+MISSED\]\)\s+75\.0%/);
  assert.match(out, /Precision ≥ STRESSED\s+50\.0%/);
  assert.match(out, /Median lead time \(TP\)\s+420m/);
  assert.match(out, /TP 3 · FP 3 · MISSED 1 · TN 5/);
});

test("renderScorecardBox: fungsi murni, N/A untuk metrik null", () => {
  const sc = { ...fakeScorecard(), recall: null, precision: null, medianLeadTimeMinutes: null };
  const text = renderScorecardBox(noColor, sc);
  assert.match(text, /Recall.*N\/A/);
  assert.match(text, /Precision.*N\/A/);
});

// --- scheduler settlement tick --------------------------------------------

/** Fake clock yang menangkap callback interval tanpa timer nyata. */
function fakeIntervalClock() {
  let cb: (() => void) | null = null;
  return {
    clock: {
      setInterval: (fn: () => void, _ms: number) => {
        cb = fn;
        return 1;
      },
      clearInterval: (_id: unknown) => {
        cb = null;
      },
    },
    fire: async () => {
      if (cb) cb();
    },
    hasTimer: () => cb !== null,
  };
}

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

test("SettleTicker: lock didapat → tick pertama jalan + status terisi", async () => {
  let released = false;
  const fc = fakeIntervalClock();
  const ticker = new SettleTicker(
    async () => fakeSettleResult(),
    async () => ({ acquired: true, release: async () => void (released = true) }),
    silentLogger,
    60_000,
    fc.clock,
  );
  await ticker.start();
  assert.equal(ticker.status.heldLock, true);
  assert.equal(ticker.status.settled, 2, "tick pertama berjalan segera");
  assert.equal(ticker.status.insufficient, 1);
  assert.ok(ticker.status.lastAt instanceof Date);
  assert.match(ticker.dashboardLine(), /2 settled \/ 1 insufficient/);
  assert.ok(fc.hasTimer(), "interval terjadwal");
  await ticker.stop();
  assert.equal(released, true, "lock dilepas saat stop");
  assert.ok(!fc.hasTimer(), "interval dibersihkan");
});

test("SettleTicker: kontensi lock (acquired=false) → tick DILEWATI", async () => {
  let jobCalls = 0;
  const ticker = new SettleTicker(
    async () => {
      jobCalls++;
      return fakeSettleResult();
    },
    async () => ({ acquired: false, release: async () => {} }),
    silentLogger,
    60_000,
    fakeIntervalClock().clock,
  );
  await ticker.start();
  assert.equal(jobCalls, 0, "job tidak dijalankan saat lock dipegang instance lain");
  assert.equal(ticker.status.heldLock, false);
  assert.match(ticker.dashboardLine(), /another instance/);
});

test("SettleTicker: job melempar → tidak crash, error ter-log", async () => {
  const logs: string[] = [];
  const ticker = new SettleTicker(
    async () => {
      throw new Error("db down");
    },
    async () => ({ acquired: true, release: async () => {} }),
    { info: () => {}, warn: () => {}, error: (m) => logs.push(m) },
    60_000,
    fakeIntervalClock().clock,
  );
  await ticker.start(); // tidak boleh melempar
  assert.ok(logs.some((l) => /job gagal: db down/.test(l)));
  await ticker.stop();
});

test("settleIntervalMs: default 60m, override via SETTLE_INTERVAL_MIN", () => {
  assert.equal(settleIntervalMs({}), 60 * 60_000);
  assert.equal(settleIntervalMs({ SETTLE_INTERVAL_MIN: "15" }), 15 * 60_000);
  assert.equal(settleIntervalMs({ SETTLE_INTERVAL_MIN: "0" }), 60 * 60_000, "invalid → default");
});

test("SETTLE_ADVISORY_LOCK_KEY berbeda dari research lock (42161001)", () => {
  assert.notEqual(SETTLE_ADVISORY_LOCK_KEY, 42161001);
});

/**
 * Unit test tampilan pesan Telegram outbound (HTML aman, dwibahasa, footer wajib).
 *
 * Menguji:
 *  - Format HTML seimbang
 *  - Keberadaan footer non-saran finansial
 *  - Tampilan alert dan digest
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  escapeHtml,
  chatLang,
  footer,
  regimeBadge,
  regimeMeaning,
  dailySummaryView,
  signalAlert,
  regimeUpAlert,
  digestView,
} from "../../src/telegram/views.ts";

function assertBalancedTags(html: string): void {
  for (const tag of ["b", "i", "code"]) {
    const open = (html.match(new RegExp(`<${tag}>`, "g")) ?? []).length;
    const close = (html.match(new RegExp(`</${tag}>`, "g")) ?? []).length;
    assert.equal(open, close, `tag <${tag}> tidak seimbang: open=${open}, close=${close}`);
  }
}

test("views: footer wajib memuat disclaimer non-investasi", () => {
  const fId = footer("id");
  const fEn = footer("en");

  assert.ok(fId.includes("bukan saran investasi"));
  assert.ok(fEn.includes("not investment advice"));
  assertBalancedTags(fId);
  assertBalancedTags(fEn);
});

test("views: regimeBadge dan meaning", () => {
  const badge = regimeBadge("CRISIS");
  assert.ok(badge.includes("🔴"));
  assert.ok(badge.includes("CRISIS"));
  assertBalancedTags(badge);

  const mId = regimeMeaning("STRESSED", "id");
  const mEn = regimeMeaning("STRESSED", "en");
  assert.ok(mId.includes("tekanan nyata"));
  assert.ok(mEn.includes("real pressure"));
});

test("views: signalAlert merender sinyal dengan HTML valid & footer", () => {
  const alert = signalAlert(
    "depeg",
    {
      id: "sig_1",
      assets: ["USDC"],
      module: "ORACLE",
      direction: "DOWN",
      severity: 8,
      confidence: 0.9,
      horizonHours: 24,
      observedAt: new Date(),
      expiresAt: new Date(Date.now() + 3600000),
      evidence: [{ title: "USDC depegged below $0.98", source: "sampler" }],
    },
    new Date("2026-10-23T12:00:00Z"),
    "id",
  );

  assert.ok(alert.includes("USDC"));
  assert.ok(alert.includes("bukan saran investasi"));
  assertBalancedTags(alert);
});

test("views: regimeUpAlert merender eskalasi regime", () => {
  const alert = regimeUpAlert(
    "ETH",
    "CALM",
    "STRESSED",
    "Volatilitas tajam pada pasar derivatif",
    new Date("2026-10-23T12:00:00Z"),
    "id",
  );
  assert.ok(alert.includes("ETH"));
  assert.ok(alert.includes("CALM"));
  assert.ok(alert.includes("STRESSED"));
  assert.ok(alert.includes("bukan saran investasi"));
  assertBalancedTags(alert);
});

test("views: dailySummaryView merender ringkasan", () => {
  const summary = dailySummaryView(
    "2026-10-23",
    [
      {
        asset: "ETH",
        chainId: 42161,
        regime: "CALM",
        riskScore: 10,
        drawdownEstimate: { h4: 0.01, h24: 0.03 },
        drivers: [],
        explanation: "Stable",
        modelVersion: "v1",
        validUntil: new Date(),
        recommendedTriggerHF: 1.15,
        recommendedTargetHF: 1.30,
        createdAt: new Date(),
      },
    ],
    [],
    "en",
  );

  assert.ok(summary.includes("2026-10-23"));
  assert.ok(summary.includes("ETH"));
  assert.ok(summary.includes("CALM"));
  assert.ok(summary.includes("not investment advice"));
  assertBalancedTags(summary);
});

test("views: digestView merender gabungan assessment dan signal", () => {
  const digest = digestView({
    dateStr: "2026-10-23",
    assessments: [
      {
        asset: "USDC",
        chainId: 42161,
        regime: "ELEVATED",
        riskScore: 35,
        drawdownEstimate: { h4: 0.02, h24: 0.05 },
        drivers: [],
        explanation: "Slight deviation",
        modelVersion: "v1",
        validUntil: new Date(),
        recommendedTriggerHF: 1.10,
        recommendedTargetHF: 1.25,
        createdAt: new Date(),
      },
    ],
    signals: [],
    lang: "id",
  });

  assert.ok(digest.includes("Tahansoe Risk Digest"));
  assert.ok(digest.includes("USDC"));
  assert.ok(digest.includes("bukan saran investasi"));
  assertBalancedTags(digest);
});

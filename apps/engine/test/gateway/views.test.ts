/**
 * Tampilan pesan Telegram (gateway/views.ts): HTML aman, dwibahasa, dan selalu
 * menjelaskan arti angka. Offline, fungsi murni.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escapeHtml,
  chatLang,
  statusView,
  carryView,
  helpView,
  signalAlert,
  regimeUpAlert,
  chatAnswerView,
} from "../../src/gateway/views.ts";
import { createDefaultSourceFreshness, type ReplContext } from "../../src/chat/context.ts";
import type { CarryData } from "../../src/cli/commands/carry.ts";

/** Setiap tag dibuka & ditutup di baris yang sama (aman dipotong per baris). */
function assertBalancedPerLine(html: string): void {
  for (const line of html.split("\n")) {
    for (const tag of ["b", "i", "code"]) {
      const open = (line.match(new RegExp(`<${tag}>`, "g")) ?? []).length;
      const close = (line.match(new RegExp(`</${tag}>`, "g")) ?? []).length;
      assert.equal(open, close, `tag <${tag}> tidak seimbang di baris: ${line}`);
    }
  }
}

function ctx(partial: Partial<ReplContext> = {}): ReplContext {
  const now = new Date("2026-10-14T12:00:00Z");
  return {
    chainId: 42161,
    now,
    hasData: true,
    isStale: false,
    sourceFreshness: createDefaultSourceFreshness(now),
    staleSources: [],
    latestReport: null,
    reportsLast24h: [],
    assessments: [],
    activeSignals: [],
    rateSamples: [],
    carryPairs: [],
    priceSummaries: [],
    macroEvents: [],
    ...partial,
  };
}

test("escapeHtml & chatLang", () => {
  assert.equal(escapeHtml("<b>&x</b>"), "&lt;b&gt;&amp;x&lt;/b&gt;");
  assert.equal(chatLang({ ui: { language: "id" } }), "id");
  assert.equal(chatLang({}), "en");
});

test("statusView: regime per aset + arti + saran HF, sinyal diurutkan, bahasa Indonesia", () => {
  const html = statusView(
    ctx({
      assessments: [
        {
          asset: "USDC",
          regime: "ELEVATED",
          riskScore: 40,
          recommendedTriggerHf: 1.45,
          recommendedTargetHf: 1.6,
          reasons: [],
          explanation: "",
          validUntil: new Date(),
          createdAt: new Date("2026-10-14T11:30:00Z"),
        },
      ],
      activeSignals: [
        {
          id: "s1",
          module: "ONCHAIN",
          paths: ["T11"],
          assets: ["USDC"],
          direction: "DOWN",
          severity: 0.5,
          confidence: 0.9,
          horizonHours: 24,
          observedAt: new Date(),
          expiresAt: new Date(),
          evidence: [{ source: "aave", title: "USDC.e <util> 92% past kink" } as never],
        },
      ],
    }),
    "id",
  );
  assert.match(html, /🟡 <b>USDC<\/b> · <b>ELEVATED<\/b> — ada tekanan/);
  assert.match(html, /Saran trigger HF <b>1\.45<\/b>/);
  assert.match(html, /bunga pinjaman &amp; carry \(USDC\): sedang/);
  assert.match(html, /&lt;util&gt;/, "judul bukti harus di-escape");
  assert.match(html, /30 menit lalu/);
  assertBalancedPerLine(html);
});

test("carryView: menjelaskan carry, hari drift, kink, dan tanpa kata rekomendasi", () => {
  const data: CarryData = {
    reserves: [
      { asset: "USDC.e", address: "0x", supplyApr: 0.04, supplyApy: 0.043, borrowApr: 0.18, borrowApy: 0.202, utilization: 0.921, optimalUtil: 0.9, status: "past kink" },
      { asset: "USDC", address: "0x", supplyApr: 0.027, supplyApy: 0.027, borrowApr: 0.036, borrowApy: 0.037, utilization: 0.81, optimalUtil: 0.9, status: "ok" },
    ],
    pairs: [
      { collateral: "WETH", debt: "USDC", available: true, netCarry: -0.026, daysHf150To145: 469.2, scenario95: { targetUtil: 0.95, projectedBorrowApr: 0.09, projectedNetCarry: -0.08, projectedDays: 154 } },
    ],
  };
  for (const lang of ["id", "en"] as const) {
    const html = carryView(data, lang);
    assert.match(html, /WETH → USDC<\/b>: −2\.6%/);
    assert.match(html, lang === "id" ? /HF 1,50 → 1,45 dalam ±469 hari/ : /HF 1\.50 → 1\.45 in ~469 days/);
    assert.match(html, /USDC\.e<\/b>/, "pool past kink ditampilkan");
    assert.doesNotMatch(html, /<b>USDC<\/b>: (terpakai|used)/, "pool normal tidak ditampilkan");
    assert.match(html, /Kink/);
    assert.doesNotMatch(html, /\b(best|recommend|switch|should buy|should sell)\b/i);
    assertBalancedPerLine(html);
  }
});

test("helpView & alert: tag seimbang per baris dan memuat penjelasan istilah", () => {
  for (const lang of ["id", "en"] as const) {
    assertBalancedPerLine(helpView(lang));
    assert.match(helpView(lang), /Health Factor/);
    const up = regimeUpAlert("USDC", "CALM", "ELEVATED", "Pool <92%> past kink", new Date(), lang);
    assert.match(up, /USDC: CALM → ELEVATED/);
    assert.match(up, /&lt;92%&gt;/);
    assertBalancedPerLine(up);
  }
  const sig = signalAlert(
    "sequencer",
    { id: "x", module: "ORACLE", paths: ["T10"], assets: [], direction: "DOWN", severity: 1, confidence: 1, horizonHours: 1, observedAt: new Date(), expiresAt: new Date(), evidence: [] },
    new Date(),
    "id",
  );
  assert.match(sig, /Sequencer Arbitrum DOWN/);
  assert.match(sig, /Tidak ada yang bisa repay/);
});

test("chatAnswerView: jawaban model di-escape (tidak bisa menyuntik HTML)", () => {
  const html = chatAnswerView("Use <a href='x'>link</a> & more", "1.2k tok · Rp 1", "en");
  assert.match(html, /&lt;a href='x'&gt;link&lt;\/a&gt; &amp; more/);
  assert.doesNotMatch(html, /<a /);
});

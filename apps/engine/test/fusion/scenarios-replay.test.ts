/**
 * Replay skenario (spec §6.6): impor `scenarioCases` dari eval sebagai FIXTURE,
 * ubah inputs (marketEvents/macroEvents/signals) menjadi Signal[] domain, jalankan
 * decideRegime, dan assert regime dalam rentang `regimeAtLeast`/`regimeAtMost`.
 *
 * Menyelaraskan fusion deterministik dengan ekspektasi regime yang disepakati eval.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { REGIMES, type Regime, type Signal } from "@tahansoe/domain";
import { decideRegime } from "../../src/fusion/regime.ts";
import { scenarioCases } from "../eval/cases/scenarios.ts";
import type { ResearchInputs } from "../../src/sources/collect.ts";

// BASE waktu fixture eval (lihat test/eval/_helpers.ts). hoursAhead/hoursAgo relatif ini.
const BASE = new Date("2026-10-08T12:00:00.000Z");
const rank = (r: Regime): number => REGIMES.indexOf(r);

let seq = 0;
const nid = () => `replay-${++seq}`;

const isModule = (m: string): m is Signal["module"] =>
  ["ORACLE", "TECHNICAL", "ONCHAIN", "MACRO", "NEWS", "SOCIAL", "RESEARCH"].includes(m);

/** Ubah ResearchInputs fixture → Signal[] domain untuk fusion. */
function toSignals(inputs: ResearchInputs, now: Date): Signal[] {
  const signals: Signal[] = [];

  // Sinyal modul (ONCHAIN/ORACLE/TECHNICAL/…): bawa module/severity/confidence/paths.
  for (const s of inputs.signals) {
    if (!isModule(s.module)) continue;
    const expiresAt = s.expiresAt instanceof Date ? s.expiresAt : new Date(s.expiresAt);
    const observedAt = s.createdAt instanceof Date ? s.createdAt : new Date(s.createdAt);
    signals.push({
      id: nid(),
      module: s.module,
      paths: s.paths,
      assets: ["ETH"],
      direction: "DOWN",
      severity: s.severity,
      confidence: s.confidence,
      horizonHours: Math.max(1, (expiresAt.getTime() - now.getTime()) / 3_600_000) || 4,
      observedAt,
      expiresAt: expiresAt.getTime() > now.getTime() ? expiresAt : new Date(now.getTime() + 3_600_000),
      evidence: [{ title: s.summary, source: "signal" }],
    });
  }

  // Event makro terjadwal → MACRO signal (horizonHours = jam sampai scheduledAt).
  for (const m of inputs.macroEvents) {
    const scheduledAt = m.scheduledAt instanceof Date ? m.scheduledAt : new Date(m.scheduledAt);
    const horizonHours = (scheduledAt.getTime() - now.getTime()) / 3_600_000;
    const severity = m.importance === "HIGH" ? 0.6 : m.importance === "MEDIUM" ? 0.4 : 0.2;
    signals.push({
      id: nid(),
      module: "MACRO",
      assets: ["ETH"],
      direction: "VOLATILITY",
      severity,
      confidence: 0.6,
      horizonHours: Math.max(0, horizonHours),
      observedAt: now,
      expiresAt: scheduledAt.getTime() > now.getTime() ? scheduledAt : new Date(now.getTime() + 3_600_000),
      evidence: [{ title: m.name, source: "macro" }],
    });
  }

  // Berita → NEWS signal (konfirmasi untuk R-EXPLOIT; tak tepercaya sendirian).
  for (const e of inputs.marketEvents) {
    const observedAt = e.publishedAt instanceof Date ? e.publishedAt : new Date(e.publishedAt);
    signals.push({
      id: nid(),
      module: "NEWS",
      assets: ["ETH"],
      direction: "DOWN",
      severity: 0.4,
      confidence: 0.5,
      horizonHours: 24,
      observedAt,
      expiresAt: new Date(now.getTime() + 12 * 3_600_000),
      evidence: [{ title: e.headline, source: e.category }],
    });
  }

  return signals;
}

for (const c of scenarioCases) {
  test(`scenario replay: ${c.id} (${c.description})`, () => {
    seq = 0;
    const signals = toSignals(c.inputs, BASE);
    const r = decideRegime({ now: BASE, signals });

    if (c.expect.regimeAtLeast) {
      assert.ok(
        rank(r.regime) >= rank(c.expect.regimeAtLeast),
        `${c.id}: regime ${r.regime} < floor ${c.expect.regimeAtLeast} (reasons: ${r.reasons.join(",")})`,
      );
    }
    if (c.expect.regimeAtMost) {
      assert.ok(
        rank(r.regime) <= rank(c.expect.regimeAtMost),
        `${c.id}: regime ${r.regime} > ceiling ${c.expect.regimeAtMost} (reasons: ${r.reasons.join(",")})`,
      );
    }
  });
}

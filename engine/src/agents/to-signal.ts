/**
 * ResearchReport → ResearchSignal untuk fusion (spec §3.3).
 *
 * Fungsi murni & deterministik — DIIMPLEMENTASIKAN PENUH karena ini titik
 * penegakan invariant keamanan (cap confidence) dan mudah diuji unit.
 *
 * Aturan (spec §3.3):
 *  - module = "RESEARCH"
 *  - severity = max(paths.severity) (0 jika paths kosong)
 *  - confidence = min(report.confidence, config.confidenceCap=0.6)  ← CAP KERAS
 *  - expiresAt = createdAt + horizonHours
 *  - evidence dari keyDevelopments
 *  - proposedRegime disimpan untuk settlement, TIDAK dipakai fusion langsung.
 *
 * Sinyal RESEARCH tidak boleh sendirian menaikkan regime ke STRESSED/CRISIS;
 * itu dijaga di fusion (bukan di sini), tapi cap 0.6 adalah lapis pertama.
 */

import { config } from "../config.ts";
import type { Evidence, ResearchReport, ResearchSignal } from "./schemas.ts";

export function toSignal(
  report: ResearchReport,
  createdAt: Date = new Date(),
): ResearchSignal {
  const severity = report.paths.reduce((max, p) => Math.max(max, p.severity), 0);

  // CAP KERAS: jangan pernah lewati config.confidenceCap tanpa ADR baru.
  const confidence = Math.min(report.confidence, config.confidenceCap);

  const expiresAt = new Date(
    createdAt.getTime() + report.horizonHours * 60 * 60 * 1000,
  );

  const evidence: Evidence[] = report.keyDevelopments.flatMap((d) => d.evidence);

  return {
    module: "RESEARCH",
    assets: report.assets,
    severity,
    confidence,
    proposedRegime: report.proposedRegime,
    evidence,
    createdAt,
    expiresAt,
  };
}

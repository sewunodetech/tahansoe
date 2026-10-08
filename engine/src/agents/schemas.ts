/**
 * Schema zod untuk research layer (spec §3.3, knowledge/risk-transmission.md §1).
 *
 * Semua output LLM divalidasi dengan schema di sini. Output gagal validasi
 * DIBUANG, tidak diperbaiki (spec §3.4). Tipe TypeScript diturunkan dari schema
 * (`z.infer`) agar tidak ada duplikasi definisi.
 */

import { z } from "zod";
import { REGIMES } from "../config.ts";

/** Jalur transmisi event → likuidasi (knowledge §1). */
export const TRANSMISSION_PATHS = [
  "T1", // Harga collateral jatuh
  "T2", // Volatilitas naik
  "T3", // Leverage cascade
  "T4", // Depeg stablecoin
  "T5", // Depeg LST/LRT
  "T6", // Gas / kongesti
  "T7", // Likuiditas reserve kering
  "T8", // Oracle lag / anomali
  "T9", // Insiden protokol
  "T10", // Sequencer L2 down
] as const;

export const TransmissionPath = z.enum(TRANSMISSION_PATHS);
export type TransmissionPath = z.infer<typeof TransmissionPath>;

export const Regime = z.enum(REGIMES);

/** Bukti yang merujuk item konteks (berita/sinyal/metrik) yang diberikan ke LLM. */
export const Evidence = z.object({
  /** Ringkasan bukti (≤ 240 char). */
  summary: z.string().max(240),
  /** Jenis sumber data konteks. */
  source: z.enum(["NEWS", "MACRO", "SIGNAL", "ONCHAIN", "MARKET"]),
  /** Referensi opsional ke id item konteks (mis. signals.id, market_events.id). */
  ref: z.string().max(120).optional(),
});
export type Evidence = z.infer<typeof Evidence>;

/** Satu temuan analyst, selalu terhubung ke jalur transmisi. */
export const AnalystFinding = z.object({
  path: TransmissionPath,
  severity: z.number().min(0).max(1),
  rationale: z.string().max(400),
  evidence: z.array(Evidence).max(6),
});
export type AnalystFinding = z.infer<typeof AnalystFinding>;

/** Laporan satu analyst (geopolitics | macro | market | onchain). */
export const AnalystReport = z.object({
  domain: z.enum(["GEOPOLITICS", "MACRO", "MARKET", "ONCHAIN"]),
  findings: z.array(AnalystFinding).max(10),
  /** Ringkasan keseluruhan domain (≤ 400 char). */
  summary: z.string().max(400),
});
export type AnalystReport = z.infer<typeof AnalystReport>;

/** Satu giliran debat Hawk/Dove. */
export const DebateTurn = z.object({
  side: z.enum(["HAWK", "DOVE"]),
  argument: z.string().max(800),
  /** Jalur yang paling disoroti giliran ini. */
  pathsHighlighted: z.array(TransmissionPath).max(10),
  /** Bantahan atas giliran lawan sebelumnya, bila ada. */
  rebuttal: z.string().max(600).optional(),
});
export type DebateTurn = z.infer<typeof DebateTurn>;

/** Hasil akhir satu run (spec §3.3). */
export const ResearchReport = z.object({
  assets: z.array(z.string()).min(1),
  proposedRegime: Regime,
  direction: z.enum(["DOWN", "UP", "VOLATILITY"]),
  paths: z
    .array(
      z.object({
        path: TransmissionPath,
        severity: z.number().min(0).max(1),
        rationale: z.string().max(400),
      }),
    )
    .max(10),
  keyDevelopments: z
    .array(
      z.object({
        summary: z.string().max(300),
        evidence: z.array(Evidence),
      }),
    )
    .max(8),
  hawkCase: z.string().max(800),
  doveCase: z.string().max(800),
  confidence: z.number().min(0).max(1),
  horizonHours: z.number().int().min(1).max(72),
});
export type ResearchReport = z.infer<typeof ResearchReport>;

/** Pelajaran hasil reflection (ADR 0005, spec §3.5/§3.8). */
export const Lesson = z.object({
  paths: z.array(TransmissionPath).max(10),
  /** ≤ 600 karakter sebagai data tak tepercaya (ADR 0005 §3). */
  lesson: z.string().max(600),
});
export type Lesson = z.infer<typeof Lesson>;

/**
 * Bentuk Signal yang dipancarkan ke fusion (PRD §6.3), hasil `toSignal()`.
 * Didefinisikan di sini agar boilerplate self-contained; saat tipe kanonik
 * `Signal` ada di modul bersama (lib/ atau engine/src/fusion), impor dari sana.
 */
export const ResearchSignal = z.object({
  module: z.literal("RESEARCH"),
  assets: z.array(z.string()).min(1),
  /** severity = max(paths.severity). */
  severity: z.number().min(0).max(1),
  /** confidence = min(report.confidence, 0.6). Dijaga di to-signal.ts. */
  confidence: z.number().min(0).max(0.6),
  /** proposedRegime disimpan untuk settlement; TIDAK dipakai fusion langsung. */
  proposedRegime: Regime,
  evidence: z.array(Evidence),
  createdAt: z.date(),
  /** createdAt + horizonHours. */
  expiresAt: z.date(),
});
export type ResearchSignal = z.infer<typeof ResearchSignal>;

/** Label settlement (ADR 0005 §1, spec §3.5). */
export const SettlementLabel = z.enum([
  "TRUE_POSITIVE",
  "FALSE_POSITIVE",
  "MISSED",
  "TRUE_NEGATIVE",
]);
export type SettlementLabel = z.infer<typeof SettlementLabel>;

/**
 * Schema zod untuk research layer (spec §3.3, knowledge/risk-transmission.md §1).
 *
 * Semua output LLM divalidasi dengan schema di sini. Output gagal validasi
 * DIBUANG, tidak diperbaiki (spec §3.4). Tipe TypeScript diturunkan dari schema
 * (`z.infer`).
 *
 * ADR 0007: tipe kanonik (TransmissionPath, Regime, dan konstanta array-nya)
 * BERASAL dari @tahansoe/domain — tidak didefinisikan ulang di sini. Zod hanya
 * membungkus konstanta domain untuk validasi runtime (domain murni, tanpa zod).
 */

import { z } from "zod";
import {
  REGIMES,
  TRANSMISSION_PATHS,
  type Regime as RegimeType,
  type TransmissionPath as TransmissionPathType,
} from "@tahansoe/domain";

/** Re-export tipe kanonik agar modul engine lain cukup impor dari schemas. */
export type TransmissionPath = TransmissionPathType;
export type Regime = RegimeType;

/**
 * Zod enum dibangun dari konstanta domain (satu sumber nilai). Cast ke tuple
 * karena domain mengekspor `readonly T[]`, sedangkan `z.enum` butuh tuple non-kosong.
 */
export const TransmissionPathSchema = z.enum(
  TRANSMISSION_PATHS as readonly [TransmissionPath, ...TransmissionPath[]],
);
export const RegimeSchema = z.enum(REGIMES as readonly [Regime, ...Regime[]]);

/** Bukti yang merujuk item konteks (berita/sinyal/metrik) yang diberikan ke LLM. */
export const Evidence = z.object({
  /** Ringkasan bukti (≤ 240 char). */
  summary: z
    .string()
    .max(240)
    .describe("Short summary of the supporting evidence, in English (max 240 chars)."),
  /** Jenis sumber data konteks. */
  source: z
    .enum(["NEWS", "MACRO", "SIGNAL", "ONCHAIN", "MARKET"])
    .describe("Type of context source this evidence comes from."),
  /**
   * Referensi opsional ke item konteks. Field non-kritis (audit); batas longgar
   * karena provider yang menolak `maxLength` di wire (strict mode) kadang mengisi
   * `ref` lebih panjang — batas ketat 120 sebelumnya menyebabkan analyst gagal
   * validasi & diam-diam hilang (audit G7). Tetap dibatasi sebagai higiene data.
   */
  ref: z
    .string()
    .max(500)
    .optional()
    .describe("Optional reference to a context item id (e.g. signals.id, market_events.id)."),
});
export type Evidence = z.infer<typeof Evidence>;

/** Satu temuan analyst, selalu terhubung ke jalur transmisi. */
export const AnalystFinding = z.object({
  path: TransmissionPathSchema.describe(
    "Transmission path (T1..T10) this finding maps to; see risk-transmission knowledge.",
  ),
  severity: z
    .number()
    .min(0)
    .max(1)
    .describe("Risk severity for this path, 0 (none) to 1 (extreme)."),
  rationale: z
    .string()
    .max(400)
    .describe("Concise rationale for this finding, in English (max 400 chars)."),
  evidence: z.array(Evidence).max(6).describe("Up to 6 pieces of supporting evidence."),
});
export type AnalystFinding = z.infer<typeof AnalystFinding>;

/** Laporan satu analyst (geopolitics | macro | market | onchain). */
export const AnalystReport = z.object({
  domain: z
    .enum(["GEOPOLITICS", "MACRO", "MARKET", "ONCHAIN"])
    .describe("The analyst domain producing this report."),
  findings: z.array(AnalystFinding).max(10).describe("Up to 10 risk findings."),
  /** Ringkasan keseluruhan domain (≤ 400 char). */
  summary: z
    .string()
    .max(400)
    .describe("Overall summary for this domain, in English (max 400 chars)."),
});
export type AnalystReport = z.infer<typeof AnalystReport>;

/** Satu giliran debat Hawk/Dove. */
export const DebateTurn = z.object({
  side: z.enum(["HAWK", "DOVE"]).describe("Which side of the debate this turn argues."),
  argument: z
    .string()
    .max(800)
    .describe("The argument for this turn, in English (max 800 chars)."),
  /** Jalur yang paling disoroti giliran ini. */
  pathsHighlighted: z
    .array(TransmissionPathSchema)
    .max(10)
    .describe("Transmission paths this turn highlights most."),
  /** Bantahan atas giliran lawan sebelumnya, bila ada. */
  rebuttal: z
    .string()
    .max(600)
    .optional()
    .describe("Optional rebuttal of the opposing turn, in English (max 600 chars)."),
});
export type DebateTurn = z.infer<typeof DebateTurn>;

/** Hasil akhir satu run (spec §3.3). */
export const ResearchReport = z.object({
  assets: z
    .array(z.string())
    .min(1)
    .describe("Assets this report concerns, e.g. [\"WETH\", \"WBTC\"]."),
  proposedRegime: RegimeSchema.describe(
    "Proposed market regime; stored for settlement, not used directly by fusion.",
  ),
  direction: z
    .enum(["DOWN", "UP", "VOLATILITY"])
    .describe("Dominant risk direction being assessed."),
  paths: z
    .array(
      z.object({
        path: TransmissionPathSchema.describe("Transmission path T1..T10."),
        severity: z
          .number()
          .min(0)
          .max(1)
          .describe("Severity for this path, 0 to 1."),
        rationale: z
          .string()
          .max(400)
          .describe("Concise rationale, in English (max 400 chars)."),
      }),
    )
    .max(10)
    .describe("Up to 10 assessed transmission paths."),
  keyDevelopments: z
    .array(
      z.object({
        summary: z
          .string()
          .max(300)
          .describe("Key development summary, in English (max 300 chars)."),
        evidence: z.array(Evidence).describe("Supporting evidence for this development."),
      }),
    )
    .max(8)
    .describe("Up to 8 key developments driving the assessment."),
  hawkCase: z
    .string()
    .max(800)
    .describe("Concise summary of the Hawk (risk-rising) case, in English (max 800 chars)."),
  doveCase: z
    .string()
    .max(800)
    .describe("Concise summary of the Dove (noise/priced-in) case, in English (max 800 chars)."),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("Confidence 0 to 1; note: code caps the emitted signal confidence at 0.6."),
  horizonHours: z
    .number()
    .int()
    .min(1)
    .max(72)
    .describe("Assessment horizon in hours (1 to 72)."),
});
export type ResearchReport = z.infer<typeof ResearchReport>;

/** Pelajaran hasil reflection (ADR 0005, spec §3.5/§3.8). */
export const Lesson = z.object({
  paths: z
    .array(TransmissionPathSchema)
    .max(10)
    .describe("Transmission paths this lesson relates to."),
  /** ≤ 600 karakter sebagai data tak tepercaya (ADR 0005 §3). */
  lesson: z
    .string()
    .max(600)
    .describe("The lesson text, in English (max 600 chars); used only as context data."),
});
export type Lesson = z.infer<typeof Lesson>;

/**
 * Bentuk Signal yang dipancarkan ke fusion (PRD §6.3), hasil `toSignal()`.
 * Ini subset tervalidasi dari tipe kanonik `Signal` di @tahansoe/domain
 * (module "RESEARCH"); fusion mengonsumsinya sebagai `Signal`.
 */
export const ResearchSignal = z.object({
  module: z.literal("RESEARCH"),
  assets: z.array(z.string()).min(1),
  /** severity = max(paths.severity). */
  severity: z.number().min(0).max(1),
  /** confidence = min(report.confidence, 0.6). Dijaga di to-signal.ts. */
  confidence: z.number().min(0).max(0.6),
  /** proposedRegime disimpan untuk settlement; TIDAK dipakai fusion langsung. */
  proposedRegime: RegimeSchema,
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

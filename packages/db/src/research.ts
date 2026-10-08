/**
 * Skema DB research layer (spec §3.8, ADR 0004/0005).
 *
 * CATATAN INTEGRASI:
 *  - Tabel ini dipakai oleh @tahansoe/engine (research agents & reflection) dan
 *    dipindahkan ke sini pada Fase 2 ADR 0007 agar skema DB tunggal (tanpa duplikasi).
 *  - Tabel ini BELUM dibuat oleh `packages/db/scripts/migrate.ts`; buat migrasinya
 *    saat implementasi spec M2/M3 (bukan boilerplate). `signals`, `risk_assessments`,
 *    dan `market_events` sendiri masih (rencana) di spec lain.
 *  - Saat tabel `signals` dibuat, pakai `signalModuleEnum` di bawah (sudah memuat
 *    nilai baru `RESEARCH` dari ADR 0004) sebagai acuan nilai `signals.module`.
 *  - Setiap tabel menyimpan `chain_id` karena menyangkut data on-chain (architecture §5).
 *
 * Konvensi mengikuti schema.ts: uuid pk, timestamps withTimezone, jsonb.
 */

import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

/**
 * Nilai `module` untuk tabel `signals` (PRD §6.3). `RESEARCH` adalah nilai baru
 * dari ADR 0004. ACUAN — gabungkan ke enum signals yang sebenarnya saat dibuat.
 */
export const signalModuleEnum = pgEnum("signal_module", [
  "ORACLE",
  "TECHNICAL",
  "ONCHAIN",
  "MACRO",
  "NEWS",
  "SOCIAL",
  "RESEARCH",
]);

export const researchTriggerEnum = pgEnum("research_trigger", [
  "SCHEDULED",
  "ESCALATION",
]);

export const settlementLabelEnum = pgEnum("settlement_label", [
  "TRUE_POSITIVE",
  "FALSE_POSITIVE",
  "MISSED",
  "TRUE_NEGATIVE",
]);

/** Output research agents per run (spec §3.8). */
export const researchReports = pgTable(
  "research_reports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    chainId: integer("chain_id").notNull(),
    trigger: researchTriggerEnum("trigger").notNull(),
    /** ResearchReport tervalidasi schema (engine agents/schemas.ts). */
    report: jsonb("report").notNull(),
    /** Array AnalystReport. */
    analystReports: jsonb("analyst_reports").notNull(),
    /** DebateResult.turns. */
    debate: jsonb("debate").notNull(),
    /** config.promptVersion saat run. */
    promptVersion: text("prompt_version").notNull(),
    /** Peta peran → nama model. */
    models: jsonb("models").notNull(),
    /** Akumulasi usage per peran (untuk biaya & scorecard). */
    usage: jsonb("usage").notNull(),
    /** Diagnostik run (status per peran, model, token, durasi) — audit G7. */
    diagnostics: jsonb("diagnostics"),
    /** createdAt + horizonHours; dipakai settlement. */
    horizonEndsAt: timestamp("horizon_ends_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    horizonIdx: index("research_reports_horizon_idx").on(t.horizonEndsAt),
    chainIdx: index("research_reports_chain_idx").on(t.chainId),
  }),
);

/**
 * Sinyal risiko dari modul mana pun (PRD §6.3). Minimal untuk M-research:
 * research agents menulis satu baris `module = "RESEARCH"` per run; modul sinyal
 * lain (M2) akan ikut memakai tabel ini.
 */
export const signals = pgTable(
  "signals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    chainId: integer("chain_id").notNull(),
    module: signalModuleEnum("module").notNull(),
    /** Jalur transmisi T1..T10 (opsional). */
    paths: jsonb("paths"),
    /** Aset terkait, mis. ["ETH","USDC"]. */
    assets: jsonb("assets").notNull(),
    direction: text("direction").notNull(), // DOWN | UP | VOLATILITY
    severity: numeric("severity", { precision: 5, scale: 4 }).notNull(),
    confidence: numeric("confidence", { precision: 5, scale: 4 }).notNull(),
    horizonHours: integer("horizon_hours").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    evidence: jsonb("evidence").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    moduleIdx: index("signals_module_idx").on(t.module),
    expiresIdx: index("signals_expires_idx").on(t.expiresAt),
    chainIdx: index("signals_chain_idx").on(t.chainId),
  }),
);

/** Label TP/FP/MISSED/TN + lead time + outcome mentah (spec §3.8, ADR 0005). */
export const riskSettlements = pgTable(
  "risk_settlements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    chainId: integer("chain_id").notNull(),
    /** Salah satu dari dua ref ini terisi (RiskAssessment atau ResearchReport). */
    riskAssessmentId: uuid("risk_assessment_id"),
    researchReportId: uuid("research_report_id").references(
      () => researchReports.id,
      { onDelete: "cascade" },
    ),
    label: settlementLabelEnum("label").notNull(),
    leadTimeMinutes: integer("lead_time_minutes"),
    /** Outcome mentah (engine reflection/outcomes.ts) agar label bisa dihitung ulang. */
    outcome: jsonb("outcome").notNull(),
    /** Versi aturan/prompt saat penilaian dibuat (ADR 0005 §4). */
    modelVersion: text("model_version").notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    labelIdx: index("risk_settlements_label_idx").on(t.label),
    reportIdx: index("risk_settlements_report_idx").on(t.researchReportId),
  }),
);

/** Pelajaran hasil reflection (≤ 600 char, bisa dinonaktifkan) (spec §3.8, ADR 0005). */
export const researchLessons = pgTable(
  "research_lessons",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    settlementId: uuid("settlement_id")
      .notNull()
      .references(() => riskSettlements.id, { onDelete: "cascade" }),
    /** Jalur transmisi terkait (T1..T10) untuk seleksi berbasis irisan. */
    paths: jsonb("paths").notNull(),
    /** Teks pelajaran, dibatasi 600 char di aplikasi (data tak tepercaya). */
    lesson: text("lesson").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    activeIdx: index("research_lessons_active_idx").on(t.active),
  }),
);

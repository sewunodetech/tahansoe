/**
 * Konfigurasi Core Risk Engine (research layer).
 *
 * Semua nilai yang bersifat kebijakan/ambang terkumpul di sini supaya mudah
 * diaudit dan diubah lewat PR (ADR 0005 §4: perubahan aturan hanya lewat manusia).
 *
 * INVARIAN KEAMANAN (jangan dilanggar — security.md §2, spec §4):
 *  - Tidak ada secret yang di-hardcode. Semua dari env, server-only (tanpa NEXT_PUBLIC_).
 *  - `RESEARCH_ENABLED` default `false` (kill switch, spec §3.9).
 *  - `CONFIDENCE_CAP = 0.6` adalah batas keras di `to-signal.ts`; jangan dinaikkan
 *    tanpa ADR baru. Sinyal RESEARCH tidak boleh sendirian menaikkan regime ke
 *    STRESSED/CRISIS (dijaga di fusion, bukan di sini).
 */

/**
 * Regime pasar — tipe kanonik dari @tahansoe/domain (ADR 0007: satu sumber tipe).
 * Di-re-export agar modul engine lain tetap bisa `import { REGIMES, Regime }` dari config.
 */
export { REGIMES } from "@tahansoe/domain";
export type { Regime } from "@tahansoe/domain";

/** Pemicu satu run riset (spec §3.2). */
export type ResearchTrigger = "SCHEDULED" | "ESCALATION";

/**
 * Membaca env server-only. Melempar jika variabel wajib hilang supaya kegagalan
 * konfigurasi terlihat lebih awal, bukan diam-diam.
 */
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`[engine/config] env wajib tidak ada: ${name}`);
  return v;
}

function optionalEnv(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

/** Peringatan deprecated LLM_BASE_URL dicetak sekali per proses. */
let warnedLlmBaseUrlAlias = false;

/**
 * Konfigurasi env. Dipanggil malas (lazy) oleh pemanggil yang butuh LLM/DB,
 * supaya modul yang tidak butuh (mis. test unit murni) tidak gagal karena env.
 *
 * LLM (ADR 0009 — satu pintu): hanya DUA secret, `LLM_API_URL` + `LLM_API_KEY`.
 * Model/pricing non-rahasia ada di settings.json. `LLM_BASE_URL` masih dibaca
 * sebagai alias usang `LLM_API_URL` (satu rilis, dengan peringatan sekali).
 */
export const env = {
  /** Koneksi Neon Postgres. Dipakai context builder, settlement, reflection. */
  databaseUrl: () => requireEnv("DATABASE_URL"),
  /** Batas biaya LLM harian (USD). Jika terlampaui, lapis riset berhenti sampai besok. */
  llmDailyBudgetUsd: () => Number(optionalEnv("LLM_DAILY_BUDGET_USD", "5")),
  /** Kill switch research agents. Default false (spec §3.9). */
  researchEnabled: () => optionalEnv("RESEARCH_ENABLED", "false") === "true",
  /** Sumber makro (FRED). Opsional di R&D; verifikasi lisensi komersial sebelum produksi (spec §3.10). */
  fredApiKey: () => optionalEnv("FRED_API_KEY", ""),
  /** Sumber berita/sentimen (Alpha Vantage). Opsional (spec §3.10). */
  alphaVantageApiKey: () => optionalEnv("ALPHA_VANTAGE_API_KEY", ""),
  /** RPC Arbitrum untuk data teknikal on-chain (AaveOracle, reserve, perp DEX). */
  arbitrumRpcUrl: () => optionalEnv("ARBITRUM_RPC_URL", ""),

  // --- Gateway LLM OpenAI-compatible TUNGGAL (ADR 0009). Server-only (security.md I8).
  /**
   * URL gateway OpenAI-compatible. Boleh ditulis sampai ".../v1" atau
   * ".../v1/chat/completions" (dinormalisasi di registry). KOSONG = LLM tidak
   * tersedia (registry memberi error jelas). Alias usang: `LLM_BASE_URL`.
   */
  llmApiUrl: () => {
    const primary = process.env.LLM_API_URL?.trim();
    if (primary) return primary;
    const legacy = process.env.LLM_BASE_URL?.trim();
    if (legacy) {
      if (!warnedLlmBaseUrlAlias) {
        warnedLlmBaseUrlAlias = true;
        console.warn(
          "[engine/config] deprecated: LLM_BASE_URL dibaca sebagai alias LLM_API_URL — pindahkan ke LLM_API_URL di apps/engine/.env.",
        );
      }
      return legacy;
    }
    return "";
  },
  /** API key gateway. KOSONG = tidak tersedia. JANGAN pernah di-log (I8). */
  llmApiKey: () => optionalEnv("LLM_API_KEY", ""),
} as const;

/**
 * Parameter kebijakan research layer. Berversi lewat `PROMPT_VERSION` dan nama
 * model; perubahan dilakukan di PR + backtest/eval (ADR 0005 §4).
 */
export const config = {
  /** Versi prompt gabungan; disimpan di research_reports.prompt_version. */
  promptVersion: "2026.10.1",

  /** Batas keras confidence sinyal RESEARCH (spec §3.3). JANGAN naikkan tanpa ADR. */
  confidenceCap: 0.6,

  /** Jumlah ronde debat Hawk ⇄ Dove (ADR 0004: default 1, maks 2). */
  debateRounds: 1,
  debateRoundsMax: 2,

  /** Minimal analyst yang harus sukses agar run dilanjutkan (spec §3.2). */
  minAnalystsRequired: 3,

  /** Maksimal lesson yang disisipkan ke Risk Assessor per run (ADR 0005 §3). */
  maxLessonsPerRun: 5,
  /** Batas panjang lesson sebagai data tak tepercaya (ADR 0005 §3). */
  maxLessonChars: 600,

  /** Jadwal run (menit) per regime (spec §3.2, architecture §3.3). */
  schedule: {
    calmIntervalMin: 120,
    elevatedIntervalMin: 60,
    /** Cooldown run ESCALATION setelah fusion menaikkan regime. */
    escalationCooldownMin: 30,
  },

  /**
   * Placeholder nama model pada LlmRequest (ADR 0009). Model NYATA dipilih per
   * peran oleh RoleRouter dari settings.json (gateway tunggal) dan menimpa field
   * ini; nilai di sini hanya muncul bila provider dipanggil langsung tanpa router
   * (mis. mode --fake). JANGAN mengandung nama vendor spesifik.
   */
  requestModelPlaceholder: "(gateway)",

  /** Reasoning effort per peran (spec §3.4). */
  effort: {
    analyst: "low",
    hawkDove: "medium",
    assessor: "high",
    reflector: "medium",
  },
} as const;

export type EngineConfig = typeof config;

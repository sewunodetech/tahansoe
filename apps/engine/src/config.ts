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

/**
 * Konfigurasi env. Dipanggil malas (lazy) oleh pemanggil yang butuh LLM/DB,
 * supaya modul yang tidak butuh (mis. test unit murni) tidak gagal karena env.
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

  // --- Kunci LLM per provider (ADR 0008). KOSONG = provider dianggap tidak tersedia.
  // Server-only; JANGAN pernah di-log (security.md I8).
  anthropicApiKey: () => optionalEnv("ANTHROPIC_API_KEY", ""),
  geminiApiKey: () => optionalEnv("GEMINI_API_KEY", ""),
  openrouterApiKey: () => optionalEnv("OPENROUTER_API_KEY", ""),
  groqApiKey: () => optionalEnv("GROQ_API_KEY", ""),
  /**
   * Ollama lokal: tanpa API key. KOSONG jika tak diset → provider dianggap TIDAK
   * tersedia (server lokal mungkin tidak berjalan). Set eksplisit untuk mengaktifkan,
   * mis. OLLAMA_BASE_URL=http://localhost:11434/v1
   */
  ollamaBaseUrl: () => optionalEnv("OLLAMA_BASE_URL", ""),

  // --- Provider OpenAI-compatible GENERIK (endpoint apa pun, mis. router pihak ketiga).
  // LLM_BASE_URL boleh ditulis sampai ".../v1" atau ".../v1/chat/completions"
  // (dinormalisasi). Provider tambahan: LLM_PROVIDER_<NAMA>_BASE_URL + _API_KEY.
  llmBaseUrl: () => optionalEnv("LLM_BASE_URL", ""),
  llmApiKey: () => optionalEnv("LLM_API_KEY", ""),
  /** Nama provider untuk LLM_BASE_URL (dipakai di "nama:model"). Default "custom". */
  llmProviderName: () => optionalEnv("LLM_PROVIDER_NAME", "custom").trim().toLowerCase() || "custom",
  /** Model default untuk SEMUA peran bila LLM_<PERAN> kosong. */
  llmModel: () => optionalEnv("LLM_MODEL", ""),
  /**
   * URL daftar harga opsional. Format yang dikenali: Bynara (`/api/pricing`,
   * credit per 1k token + usd_to_idr) dan OpenRouter (`/api/v1/models`, USD per token).
   */
  llmPricingUrl: () => optionalEnv("LLM_PRICING_URL", ""),
  /** Harga manual (JSON): {"model":{"inputPerM":0.3,"outputPerM":1.2}} dalam USD per 1 juta token. */
  llmModelPricesJson: () => optionalEnv("LLM_MODEL_PRICES", ""),

  // --- Pemilihan provider:model per peran (ADR 0008 §2–§3). Format:
  // "provider:model,provider:model" (daftar fallback dipisah koma). Kosong = default.
  llmAnalyst: () => optionalEnv("LLM_ANALYST", ""),
  llmDebate: () => optionalEnv("LLM_DEBATE", ""),
  llmAssessor: () => optionalEnv("LLM_ASSESSOR", ""),
  llmReflector: () => optionalEnv("LLM_REFLECTOR", ""),
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
   * Model per peran (spec §3.4). PRINSIP: "termurah yang lolos eval".
   * Semua peran MULAI dari haiku; naikkan tier per peran HANYA jika set eval
   * gagal (akurasi path/severity < 80% news-labeled, ada kegagalan injection,
   * atau < 70% kesesuaian regime scenarios), dan catat kenaikannya di PR + eval.
   * Jangan default ke opus tanpa bukti eval.
   */
  models: {
    analyst: "claude-haiku-5-5",
    hawkDove: "claude-haiku-5-5",
    assessor: "claude-haiku-5-5",
    reflector: "claude-haiku-5-5",
  },

  /** Tangga eskalasi tier per peran (dipakai saat eval gagal). */
  modelTiers: {
    analyst: ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"],
    hawkDove: ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"],
    assessor: ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"],
    reflector: ["claude-haiku-5-5", "claude-sonnet-5-5"],
  },

  /** Reasoning effort per peran (spec §3.4). */
  effort: {
    analyst: "low",
    hawkDove: "medium",
    assessor: "high",
    reflector: "medium",
  },
} as const;

export type EngineConfig = typeof config;

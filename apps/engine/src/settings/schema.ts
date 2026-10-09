/**
 * Skema settings NON-RAHASIA Core Risk Engine (ADR 0008; keputusan: konfigurasi
 * provider/model/pricing di file settings, SECRET tetap di .env).
 *
 * File: apps/engine/settings.json (per mesin, di-gitignore) atau path dari env
 * TAHANSOE_SETTINGS. Contoh commit: apps/engine/settings.example.json.
 *
 * INVARIAN KEAMANAN (security.md I8): API key TIDAK PERNAH disimpan di settings —
 * hanya NAMA env var-nya (`apiKeyEnv`). Validasi zod menolak bentuk yang salah dan
 * memberi pesan error jelas (bukan crash diam-diam).
 */

import { z } from "zod";

/** Versi skema settings. Naikkan bila bentuk berubah (migrasi di loader). */
export const SETTINGS_VERSION = 1 as const;

/** Satu provider OpenAI-compatible. API key dirujuk lewat NAMA env var, bukan nilainya. */
export const providerSchema = z
  .object({
    /** Base URL OpenAI-compatible (".../v1" atau ".../v1/chat/completions"). */
    baseUrl: z.string().min(1, "baseUrl wajib"),
    /**
     * NAMA env var yang memuat API key (mis. "LLM_API_KEY"). Opsional untuk
     * provider lokal tanpa auth (mis. Ollama). JANGAN isi nilai key di sini.
     */
    apiKeyEnv: z.string().min(1).optional(),
    /** URL daftar harga opsional (Bynara `/api/pricing` atau OpenRouter `/api/v1/models`). */
    pricingUrl: z.string().min(1).optional(),
    /** True untuk provider lokal (Ollama): tersedia walau tanpa apiKeyEnv. */
    local: z.boolean().optional(),
  })
  .strict();

export type ProviderSettings = z.infer<typeof providerSchema>;

/** Daftar fallback "provider:model" per peran. */
const roleListSchema = z.array(z.string().min(1));

export const rolesSchema = z
  .object({
    analyst: roleListSchema.optional(),
    debate: roleListSchema.optional(),
    assessor: roleListSchema.optional(),
    reflector: roleListSchema.optional(),
  })
  .strict();

export type RolesSettings = z.infer<typeof rolesSchema>;

/** Harga manual satu model (USD per 1 juta token). */
export const modelPriceSchema = z
  .object({
    inputPerM: z.number().nonnegative(),
    outputPerM: z.number().nonnegative(),
    reasoning: z.boolean().optional(),
    maxContextTokens: z.number().positive().optional(),
  })
  .strict();

export const estimateSchema = z
  .object({
    /** Jumlah run per hari (jadwal worker CALM = 12). */
    runsPerDay: z.number().int().positive().optional(),
  })
  .strict();

/** Skema utama settings.json (version 1). */
export const settingsSchema = z
  .object({
    version: z.literal(SETTINGS_VERSION),
    providers: z.record(z.string(), providerSchema).default({}),
    roles: rolesSchema.default({}),
    /** Harga manual opsional per model, menimpa pricing remote. */
    modelPrices: z.record(z.string(), modelPriceSchema).default({}),
    estimate: estimateSchema.default({}),
  })
  .strict();

export type Settings = z.infer<typeof settingsSchema>;

/** Settings kosong valid (dipakai saat file tidak ada). */
export function emptySettings(): Settings {
  return { version: SETTINGS_VERSION, providers: {}, roles: {}, modelPrices: {}, estimate: {} };
}

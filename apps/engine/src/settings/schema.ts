/**
 * Skema settings NON-RAHASIA Core Risk Engine v2 (ADR 0009 — satu gateway).
 *
 * File: apps/engine/settings.json (per mesin, di-gitignore) atau path dari env
 * TAHANSOE_SETTINGS. Contoh commit: apps/engine/settings.example.json.
 *
 * v2 TIDAK memuat daftar provider dan TIDAK memuat nama env key: gateway dan key
 * ada di .env (`LLM_API_URL`, `LLM_API_KEY`). Settings hanya menyimpan:
 *  - roles: daftar NAMA MODEL (tanpa awalan provider) per peran, berurutan fallback;
 *  - pricingUrl: URL harga opsional (Bynara/OpenRouter);
 *  - modelPrices: harga manual opsional (USD/1M token), menimpa remote;
 *  - estimate: parameter estimasi biaya.
 *
 * INVARIAN KEAMANAN (security.md I8): API key TIDAK PERNAH disimpan di settings.
 * Validasi zod menolak bentuk salah dengan pesan jelas.
 */

import { z } from "zod";

/** Versi skema settings saat ini. v1 dimigrasikan ke v2 saat dibaca. */
export const SETTINGS_VERSION = 2 as const;

/** Daftar fallback NAMA MODEL (tanpa awalan provider) per peran. */
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

/** Skema utama settings.json (version 2). */
export const settingsSchema = z
  .object({
    version: z.literal(SETTINGS_VERSION),
    roles: rolesSchema.default({}),
    /** URL daftar harga gateway (Bynara `/api/pricing` atau OpenRouter `/api/v1/models`). */
    pricingUrl: z.string().min(1).optional(),
    /** Harga manual opsional per model, menimpa pricing remote. */
    modelPrices: z.record(z.string(), modelPriceSchema).default({}),
    estimate: estimateSchema.default({}),
  })
  .strict();

export type Settings = z.infer<typeof settingsSchema>;

/** Settings kosong valid (dipakai saat file tidak ada). */
export function emptySettings(): Settings {
  return { version: SETTINGS_VERSION, roles: {}, modelPrices: {}, estimate: {} };
}

/** Nama provider lama (ADR 0008) yang awalannya di-strip saat migrasi/baca. */
export const KNOWN_OLD_PROVIDERS = new Set([
  "bynara",
  "gemini",
  "openrouter",
  "groq",
  "anthropic",
  "ollama",
  "custom",
]);

/**
 * Buang awalan "provider:" dari sebuah spec model HANYA jika awalannya cocok
 * dengan nama provider lama yang dikenal. Model id yang sah mengandung ":"
 * (mis. "meta-llama/x:free") TIDAK diubah karena "meta-llama/x" bukan provider.
 */
export function stripProviderPrefix(spec: string): string {
  const idx = spec.indexOf(":");
  if (idx <= 0) return spec.trim();
  const prefix = spec.slice(0, idx).trim().toLowerCase();
  if (KNOWN_OLD_PROVIDERS.has(prefix)) return spec.slice(idx + 1).trim();
  return spec.trim();
}

/**
 * Loader, resolver, dan writer settings NON-RAHASIA (ADR 0008).
 *
 * PRIORITAS (tinggi → rendah):
 *   1. settings.json (atau TAHANSOE_SETTINGS)       — sumber utama
 *   2. env lama (LLM_BASE_URL, LLM_MODEL, LLM_ANALYST, …) — DEPRECATED, dengan peringatan
 *   3. default bawaan (registry.ts)
 *
 * SECRET tetap dari .env: provider menyimpan `apiKeyEnv` (NAMA env), nilai key
 * diambil dari process.env saat resolusi. Settings TIDAK PERNAH memuat key (I8).
 *
 * Semua I/O di sini; validasi lewat schema.ts. Penulisan atomik (tulis file
 * sementara lalu rename) agar file tidak pernah setengah tertulis.
 */

import { readFileSync } from "node:fs";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  settingsSchema,
  emptySettings,
  type Settings,
  type ProviderSettings,
} from "./schema.ts";

/** Root paket engine (apps/engine), dari lokasi file ini (src/settings). */
function engineRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url)); // src/settings
  return join(here, "..", ".."); // apps/engine
}

/** Path file settings efektif: env TAHANSOE_SETTINGS, atau apps/engine/settings.json. */
export function settingsPath(envVars: Record<string, string | undefined> = process.env): string {
  const override = envVars.TAHANSOE_SETTINGS?.trim();
  if (override) return resolve(override);
  return join(engineRoot(), "settings.json");
}

/** Path contoh (di-commit) untuk `init`. */
export function settingsExamplePath(): string {
  return join(engineRoot(), "settings.example.json");
}

/** Hasil load: settings efektif, apakah file ada, dan peringatan (mis. deprecated env). */
export interface LoadResult {
  settings: Settings;
  exists: boolean;
  path: string;
  warnings: string[];
}

/**
 * Baca & validasi settings dari disk (sinkron agar bisa dipakai resolver registry
 * yang sinkron). File tidak ada → settings kosong valid (perilaku lama tetap jalan).
 * JSON/schema rusak → melempar Error dengan pesan jelas (bukan diam-diam).
 */
export function loadSettingsSync(
  path: string = settingsPath(),
): LoadResult {
  const warnings: string[] = [];
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return { settings: emptySettings(), exists: false, path, warnings };
  }
  return { settings: parseSettings(raw, path), exists: true, path, warnings };
}

/** Versi async (dipakai CLI). */
export async function loadSettings(path: string = settingsPath()): Promise<LoadResult> {
  const warnings: string[] = [];
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return { settings: emptySettings(), exists: false, path, warnings };
  }
  return { settings: parseSettings(raw, path), exists: true, path, warnings };
}

/** Parse + validasi string JSON settings. Melempar Error jelas bila gagal. */
export function parseSettings(raw: string, path = "<memory>"): Settings {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `[engine/settings] ${path} bukan JSON valid: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  // Cek versi lebih dulu agar pesannya jelas.
  if (json && typeof json === "object" && "version" in json) {
    const v = (json as { version: unknown }).version;
    if (v !== 1) {
      throw new Error(
        `[engine/settings] ${path}: versi skema ${String(v)} tidak didukung (harap "version": 1).`,
      );
    }
  }
  const parsed = settingsSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`[engine/settings] ${path} tidak valid:\n${issues}`);
  }
  return parsed.data;
}

/** Tulis settings ke disk secara atomik (tmp lalu rename), JSON rapi 2 spasi. */
export async function writeSettings(
  settings: Settings,
  path: string = settingsPath(),
): Promise<void> {
  // Validasi sebelum menulis agar file di disk selalu valid.
  const checked = settingsSchema.parse(settings);
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  const body = JSON.stringify(checked, null, 2) + "\n";
  await writeFile(tmp, body, "utf8");
  await rename(tmp, path);
}

// ---------------------------------------------------------------------------
// Resolver: gabungkan settings + env (deprecated) → bentuk yang dipakai registry.
// ---------------------------------------------------------------------------

/** Provider yang sudah teresolusi: baseURL, apiKey (dari env), pricingUrl, local, sumber. */
export interface ResolvedProvider {
  name: string;
  baseURL: string;
  /** Nilai API key hasil resolusi apiKeyEnv (kosong = tidak tersedia, kecuali local). */
  apiKey: string;
  /** NAMA env var key (untuk ditampilkan, tanpa nilai). */
  apiKeyEnv?: string;
  pricingUrl?: string;
  local?: boolean;
  /** "settings" | "env" (deprecated). */
  source: "settings" | "env";
}

/** Normalisasi base URL: buang "/chat/completions" & trailing slash. */
function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").replace(/\/chat\/completions$/i, "").replace(/\/+$/, "");
}

/**
 * Resolusi provider dari settings + env lama. Settings menang; env yang masih
 * dipakai memunculkan peringatan "deprecated". Nilai key diambil dari env via
 * apiKeyEnv (tidak pernah dari settings).
 */
export function resolveProviders(
  settings: Settings,
  envVars: Record<string, string | undefined> = process.env,
): { providers: Record<string, ResolvedProvider>; warnings: string[] } {
  const providers: Record<string, ResolvedProvider> = {};
  const warnings: string[] = [];

  // 1. Dari settings (sumber utama).
  for (const [name, p] of Object.entries(settings.providers)) {
    providers[name.toLowerCase()] = {
      name: name.toLowerCase(),
      baseURL: normalizeBaseUrl(p.baseUrl),
      apiKey: p.apiKeyEnv ? (envVars[p.apiKeyEnv]?.trim() ?? "") : "",
      apiKeyEnv: p.apiKeyEnv,
      pricingUrl: p.pricingUrl,
      local: p.local,
      source: "settings",
    };
  }

  // 2. Dari env lama (DEPRECATED). Hanya mengisi provider yang BELUM ada di settings.
  const base = envVars.LLM_BASE_URL?.trim();
  if (base) {
    const name = (envVars.LLM_PROVIDER_NAME ?? "custom").trim().toLowerCase() || "custom";
    if (!providers[name]) {
      providers[name] = {
        name,
        baseURL: normalizeBaseUrl(base),
        apiKey: envVars.LLM_API_KEY?.trim() ?? "",
        apiKeyEnv: "LLM_API_KEY",
        pricingUrl: envVars.LLM_PRICING_URL?.trim() || undefined,
        source: "env",
      };
      warnings.push(
        `[engine/settings] deprecated: LLM_BASE_URL/LLM_API_KEY/LLM_PROVIDER_NAME dari .env — pindahkan ke settings.json (providers.${name}).`,
      );
    }
  }
  for (const [key, value] of Object.entries(envVars)) {
    const m = /^LLM_PROVIDER_([A-Z0-9_]+)_BASE_URL$/.exec(key);
    if (!m || !value?.trim()) continue;
    const name = m[1]!.toLowerCase();
    if (providers[name]) continue;
    providers[name] = {
      name,
      baseURL: normalizeBaseUrl(value),
      apiKey: envVars[`LLM_PROVIDER_${m[1]}_API_KEY`]?.trim() ?? "",
      apiKeyEnv: `LLM_PROVIDER_${m[1]}_API_KEY`,
      source: "env",
    };
    warnings.push(
      `[engine/settings] deprecated: LLM_PROVIDER_${m[1]}_BASE_URL dari .env — pindahkan ke settings.json (providers.${name}).`,
    );
  }

  return { providers, warnings };
}

/**
 * Spec peran "provider:model,…" dari settings → env lama (deprecated) → null.
 * Mengembalikan daftar string (satu per entri fallback) + peringatan.
 */
export function resolveRoleSpecList(
  role: "analyst" | "debate" | "assessor" | "reflector",
  settings: Settings,
  envVars: Record<string, string | undefined> = process.env,
): { list: string[] | null; warnings: string[] } {
  const warnings: string[] = [];
  const fromSettings = settings.roles[role];
  if (fromSettings && fromSettings.length > 0) return { list: fromSettings, warnings };

  const envName =
    role === "analyst" ? "LLM_ANALYST" : role === "debate" ? "LLM_DEBATE" : role === "assessor" ? "LLM_ASSESSOR" : "LLM_REFLECTOR";
  const envVal = envVars[envName]?.trim();
  if (envVal) {
    warnings.push(`[engine/settings] deprecated: ${envName} dari .env — pindahkan ke settings.json (roles.${role}).`);
    return { list: envVal.split(",").map((s) => s.trim()).filter(Boolean), warnings };
  }
  // Juga dukung LLM_MODEL lama (satu model untuk semua peran) sebagai fallback.
  const legacyModel = envVars.LLM_MODEL?.trim();
  const legacyBase = envVars.LLM_BASE_URL?.trim();
  if (legacyModel && legacyBase) {
    const name = (envVars.LLM_PROVIDER_NAME ?? "custom").trim().toLowerCase() || "custom";
    warnings.push(`[engine/settings] deprecated: LLM_MODEL dari .env — pindahkan ke settings.json (roles.${role}).`);
    return { list: [`${name}:${legacyModel}`], warnings };
  }
  return { list: null, warnings };
}

/** Default model lokasi tidak diset: dipakai registry untuk "provider:model" tanpa prefix. */
export function defaultProviderName(settings: Settings, envVars: Record<string, string | undefined> = process.env): string | null {
  // Provider pertama di settings yang punya baseURL dianggap default generik.
  const names = Object.keys(settings.providers);
  if (names.length > 0) return names[0]!.toLowerCase();
  const base = envVars.LLM_BASE_URL?.trim();
  if (base) return (envVars.LLM_PROVIDER_NAME ?? "custom").trim().toLowerCase() || "custom";
  return null;
}

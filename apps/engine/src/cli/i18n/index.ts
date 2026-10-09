/**
 * Internationalization (i18n) untuk CLI Tahansoe (spec m3-cli §3.6).
 *
 * Mendukung Bahasa Indonesia (id) dan Bahasa Inggris (en).
 *
 * Prioritas resolusi bahasa:
 *  1. Argumen CLI eksplisit (--lang id|en)
 *  2. Pengaturan di settings.json (ui.language)
 *  3. Environment variable TAHANSOE_LANG
 *  4. Locale sistem via Intl.DateTimeFormat().resolvedOptions().locale (jika berawalan "id" -> "id")
 *  5. Default: "en"
 */

import { idCatalog } from "./id.ts";
import { enCatalog } from "./en.ts";
import type { SupportedLanguage, TranslationCatalog, TranslationKey } from "./keys.ts";

export type { SupportedLanguage, TranslationCatalog, TranslationKey } from "./keys.ts";
export { idCatalog } from "./id.ts";
export { enCatalog } from "./en.ts";

export const CATALOGS: Record<SupportedLanguage, TranslationCatalog> = {
  id: idCatalog,
  en: enCatalog,
};

export interface ResolveLanguageOptions {
  cliFlag?: string | null;
  settingsLang?: string | null;
  envLang?: string | null;
  systemLocale?: string | null;
}

/**
 * Resolusi bahasa deterministik berdasarkan urutan prioritas:
 * 1) CLI flag
 * 2) settings.json ui.language
 * 3) env TAHANSOE_LANG
 * 4) system locale (jika diawali "id" -> "id")
 * 5) "en"
 */
export function resolveLanguage(options: ResolveLanguageOptions = {}): SupportedLanguage {
  // 1. Explicit CLI flag
  const cli = options.cliFlag?.trim().toLowerCase();
  if (cli === "id" || cli === "en") {
    return cli;
  }

  // 2. settings.json ui.language
  const settings = options.settingsLang?.trim().toLowerCase();
  if (settings === "id" || settings === "en") {
    return settings;
  }

  // 3. Environment variable TAHANSOE_LANG
  const env = (options.envLang ?? process.env.TAHANSOE_LANG)?.trim().toLowerCase();
  if (env === "id" || env === "en") {
    return env;
  }

  // 4. System locale
  try {
    const locale = (
      options.systemLocale ??
      (typeof Intl !== "undefined" && typeof Intl.DateTimeFormat === "function"
        ? Intl.DateTimeFormat().resolvedOptions().locale
        : undefined)
    )?.toLowerCase();
    if (locale && locale.startsWith("id")) {
      return "id";
    }
  } catch {
    /* fallback to en */
  }

  // 5. Default
  return "en";
}

let activeLanguage: SupportedLanguage = "en";

/** Dapatkan bahasa antarmuka aktif saat ini. */
export function getLanguage(): SupportedLanguage {
  return activeLanguage;
}

/** Setel bahasa antarmuka aktif saat ini secara in-memory. */
export function setLanguage(lang: SupportedLanguage): void {
  activeLanguage = lang;
}

/**
 * Inisialisasi bahasa antarmuka aktif berdasarkan opsi resolusi.
 */
export function initLanguage(options: ResolveLanguageOptions = {}): SupportedLanguage {
  activeLanguage = resolveLanguage(options);
  return activeLanguage;
}

/** Dapatkan katalog terjemahan aktif (atau katalog untuk bahasa tertentu). */
export function getCatalog(lang?: SupportedLanguage): TranslationCatalog {
  return CATALOGS[lang ?? activeLanguage] ?? CATALOGS.en;
}

/**
 * Ambil string terjemahan berdasarkan kunci, dengan substitusi parameter opsional `{param}`.
 */
export function t(
  key: TranslationKey,
  params?: Record<string, string | number>,
  overrideLang?: SupportedLanguage,
): string {
  const catalog = getCatalog(overrideLang);
  const template = catalog[key] ?? CATALOGS.en[key] ?? String(key);

  if (!params) {
    return template;
  }

  return template.replace(/\{(\w+)\}/g, (match, pName) => {
    if (pName in params) {
      return String(params[pName]);
    }
    return match;
  });
}

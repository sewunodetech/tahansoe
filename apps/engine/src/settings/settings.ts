/**
 * Loader, migrasi, dan writer settings NON-RAHASIA v2 (ADR 0009 — satu gateway).
 *
 * PRIORITAS peran (tinggi → rendah):
 *   1. settings.json (roles.<peran> = daftar NAMA MODEL)
 *   2. default bawaan (registry.ts) bila kosong
 *
 * Gateway (`LLM_API_URL`) dan key (`LLM_API_KEY`) ada di .env, BUKAN di settings.
 * File v1 (punya `providers`) otomatis dimigrasikan ke v2 saat dibaca: ambil roles,
 * strip awalan provider, bawa pricingUrl dari provider pertama yang punya.
 *
 * Semua I/O di sini; validasi lewat schema.ts. Penulisan atomik (tmp lalu rename).
 */

import { readFileSync } from "node:fs";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  settingsSchema,
  emptySettings,
  stripProviderPrefix,
  SETTINGS_VERSION,
  type Settings,
  type GatewayAlertPreferences,
  type GatewayAllowedChat,
  type GatewaySettings,
} from "./schema.ts";

export type {
  Settings,
  GatewayAlertPreferences,
  GatewayAllowedChat,
  GatewaySettings,
};

export { emptySettings };

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

export interface LoadResult {
  settings: Settings;
  exists: boolean;
  path: string;
  warnings: string[];
}

/** Baca & validasi settings (sinkron). File tidak ada → settings kosong valid. */
export function loadSettingsSync(path: string = settingsPath()): LoadResult {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return { settings: emptySettings(), exists: false, path, warnings: [] };
  }
  const { settings, warnings } = parseSettings(raw, path);
  return { settings, exists: true, path, warnings };
}

/** Versi async (dipakai CLI). */
export async function loadSettings(path: string = settingsPath()): Promise<LoadResult> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return { settings: emptySettings(), exists: false, path, warnings: [] };
  }
  const { settings, warnings } = parseSettings(raw, path);
  return { settings, exists: true, path, warnings };
}

/** Hasil parse: settings v2 + peringatan (mis. migrasi dari v1). */
export interface ParseResult {
  settings: Settings;
  warnings: string[];
}

/**
 * Parse + validasi string JSON settings. v1 dimigrasikan ke v2. Melempar Error
 * jelas bila JSON rusak atau versi tak dikenal.
 */
export function parseSettings(raw: string, path = "<memory>"): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `[engine/settings] ${path} bukan JSON valid: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const version = json && typeof json === "object" ? (json as { version?: unknown }).version : undefined;
  const warnings: string[] = [];

  let candidate: unknown = json;
  if (version === 1) {
    candidate = migrateV1toV2(json as Record<string, unknown>, warnings);
  } else if (version !== SETTINGS_VERSION) {
    throw new Error(
      `[engine/settings] ${path}: versi skema ${String(version)} tidak didukung (harap "version": ${SETTINGS_VERSION} atau 1 untuk migrasi).`,
    );
  }

  const parsed = settingsSchema.safeParse(candidate);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`[engine/settings] ${path} tidak valid:\n${issues}`);
  }
  return { settings: parsed.data, warnings };
}

/**
 * Migrasi settings v1 (punya `providers`) → v2. Ambil roles & strip awalan
 * provider dari tiap entri; bawa pricingUrl dari provider PERTAMA yang punya.
 */
export function migrateV1toV2(v1: Record<string, unknown>, warnings: string[] = []): Settings {
  const rolesIn = (v1.roles ?? {}) as Record<string, unknown>;
  const roles: Settings["roles"] = {};
  for (const role of ["analyst", "debate", "assessor", "reflector", "chat"] as const) {
    const list = rolesIn[role];
    if (Array.isArray(list)) {
      const cleaned = list
        .filter((x): x is string => typeof x === "string")
        .map((x) => stripProviderPrefix(x))
        .filter(Boolean);
      if (cleaned.length > 0) roles[role] = cleaned;
    }
  }

  // pricingUrl: dari provider pertama yang punya (urutan Object.entries stabil).
  let pricingUrl: string | undefined;
  const providers = (v1.providers ?? {}) as Record<string, { pricingUrl?: unknown }>;
  for (const p of Object.values(providers)) {
    if (typeof p?.pricingUrl === "string" && p.pricingUrl.trim()) {
      pricingUrl = p.pricingUrl.trim();
      break;
    }
  }

  const modelPrices = (v1.modelPrices ?? {}) as Settings["modelPrices"];
  const estimate = (v1.estimate ?? {}) as Settings["estimate"];

  warnings.push(
    "[engine/settings] settings.json v1 dimigrasikan ke v2 (providers dibuang; awalan provider pada roles di-strip). Simpan ulang untuk permanen.",
  );

  return {
    version: SETTINGS_VERSION,
    roles,
    ...(pricingUrl ? { pricingUrl } : {}),
    modelPrices,
    estimate,
  };
}

/** Tulis settings ke disk secara atomik (tmp lalu rename), JSON rapi 2 spasi. */
export async function writeSettings(settings: Settings, path: string = settingsPath()): Promise<void> {
  const checked = settingsSchema.parse(settings);
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  const body = JSON.stringify(checked, null, 2) + "\n";
  await writeFile(tmp, body, "utf8");
  await rename(tmp, path);
}

// ---------------------------------------------------------------------------
// Resolver peran (dari settings v2). Tidak ada lagi provider di settings.
// ---------------------------------------------------------------------------

export type RoleName = "analyst" | "debate" | "assessor" | "reflector" | "chat";

/**
 * Daftar NAMA MODEL untuk sebuah peran dari settings (sudah tanpa awalan provider;
 * strip defensif tetap diterapkan untuk kompat bila file belum ditulis ulang).
 * null bila peran tidak diset (registry pakai default).
 */
export function resolveRoleSpecList(role: RoleName, settings: Settings): string[] | null {
  const list = settings.roles[role];
  if (!list || list.length === 0) return null;
  return list.map((s) => stripProviderPrefix(s)).filter(Boolean);
}

/** URL harga gateway dari settings (atau undefined). */
export function gatewayPricingUrl(settings: Settings): string | undefined {
  return settings.pricingUrl;
}

// ---------------------------------------------------------------------------
// Helper Konfigurasi Gateway (Telegram allowlist, subscription, alerts).
// ---------------------------------------------------------------------------

export type AlertType = "regime" | "sequencer" | "depeg" | "pool" | "oracle" | "daily";

/**
 * Periksa apakah chatId diizinkan berdasarkan allowedChats di settings
 * atau TELEGRAM_ALLOWED_CHAT_IDS dari environment.
 */
export function isChatAllowed(
  chatId: string | number,
  settings: Settings,
  envAllowed: string | undefined = process.env.TELEGRAM_ALLOWED_CHAT_IDS,
): boolean {
  const idStr = String(chatId).trim();
  if (!idStr) return false;

  // 1. Cek env TELEGRAM_ALLOWED_CHAT_IDS (koma-terpisah)
  if (envAllowed) {
    const envIds = envAllowed
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (envIds.includes(idStr)) return true;
  }

  // 2. Cek settings.gateway.channels.telegram.allowedChats
  const allowed = settings.gateway?.channels?.telegram?.allowedChats;
  if (Array.isArray(allowed)) {
    return allowed.some((c) => String(c.id).trim() === idStr);
  }

  return false;
}

/**
 * Cek apakah chat berlangganan notifikasi/alert (default true untuk chat yang allowed).
 */
export function isChatSubscribed(chatId: string | number, settings: Settings): boolean {
  const idStr = String(chatId).trim();
  const allowed = settings.gateway?.channels?.telegram?.allowedChats;
  if (!Array.isArray(allowed)) return true;
  const chat = allowed.find((c) => String(c.id).trim() === idStr);
  if (!chat) return true;
  return chat.subscribed !== false;
}

/**
 * Dapatkan preferensi alert efektif untuk sebuah chat (memperhitungkan mute sementara).
 * Default: regime, sequencer, depeg, pool, oracle = true; daily = false.
 */
export function getChatAlertPreferences(
  chatId: string | number,
  settings: Settings,
  nowMs: number = Date.now(),
): Record<AlertType, boolean> {
  const idStr = String(chatId).trim();
  const allowed = settings.gateway?.channels?.telegram?.allowedChats;
  const chat = allowed?.find((c) => String(c.id).trim() === idStr);
  const prefs = chat?.alerts;

  const isMuted = (type: string) => {
    const until = prefs?.mutedUntil?.[type];
    return typeof until === "number" && nowMs < until;
  };

  return {
    regime: !isMuted("regime") && (prefs?.regime ?? true),
    sequencer: !isMuted("sequencer") && (prefs?.sequencer ?? true),
    depeg: !isMuted("depeg") && (prefs?.depeg ?? true),
    pool: !isMuted("pool") && (prefs?.pool ?? true),
    oracle: !isMuted("oracle") && (prefs?.oracle ?? true),
    daily: !isMuted("daily") && (prefs?.daily ?? false),
  };
}

/**
 * Bisukan alert jenis tertentu selama durationHours (default 6 jam) untuk sebuah chat di settings.json.
 */
export async function muteChatAlert(
  chatId: string | number,
  alertType: AlertType,
  durationHours = 6,
  path: string = settingsPath(),
): Promise<Settings> {
  const { settings } = await loadSettings(path);
  const idStr = String(chatId).trim();

  const currentGateway = settings.gateway ?? {
    channels: {},
    alertPollSec: 60,
    qaPerDay: 20,
    dailySummary: false,
  };
  const telegram = currentGateway.channels.telegram ?? {
    enabled: true,
    allowedChats: [],
  };

  const existingIdx = telegram.allowedChats.findIndex((c) => String(c.id).trim() === idStr);
  const nextAllowedChats = [...telegram.allowedChats];
  const mutedUntilMs = Date.now() + durationHours * 3600_000;

  if (existingIdx >= 0) {
    const existing = nextAllowedChats[existingIdx]!;
    nextAllowedChats[existingIdx] = {
      ...existing,
      alerts: {
        ...existing.alerts,
        mutedUntil: {
          ...(existing.alerts?.mutedUntil ?? {}),
          [alertType]: mutedUntilMs,
        },
      },
    };
  } else {
    nextAllowedChats.push({
      id: idStr,
      subscribed: true,
      alerts: {
        mutedUntil: {
          [alertType]: mutedUntilMs,
        },
      },
      pairedAt: new Date().toISOString(),
    });
  }

  const updatedSettings: Settings = {
    ...settings,
    gateway: {
      ...currentGateway,
      channels: {
        ...currentGateway.channels,
        telegram: {
          ...telegram,
          allowedChats: nextAllowedChats,
        },
      },
    },
  };

  await writeSettings(updatedSettings, path);
  return updatedSettings;
}

/**
 * Tambahkan atau perbarui allowed chat di settings.json (dipanggil saat pairing sukses).
 */
export async function addAllowedChat(
  chatId: string | number,
  label?: string,
  options: { subscribed?: boolean; alerts?: GatewayAlertPreferences } = {},
  path: string = settingsPath(),
): Promise<Settings> {
  const { settings } = await loadSettings(path);
  const idStr = String(chatId).trim();

  const currentGateway = settings.gateway ?? {
    channels: {},
    alertPollSec: 60,
    qaPerDay: 20,
    dailySummary: false,
  };

  const telegram = currentGateway.channels.telegram ?? {
    enabled: true,
    allowedChats: [],
  };

  const existingIdx = telegram.allowedChats.findIndex((c) => String(c.id).trim() === idStr);
  const updatedChat: GatewayAllowedChat = {
    id: idStr,
    label: label ?? (existingIdx >= 0 ? telegram.allowedChats[existingIdx]!.label : undefined),
    subscribed: options.subscribed ?? (existingIdx >= 0 ? telegram.allowedChats[existingIdx]!.subscribed : true),
    alerts: {
      ...(existingIdx >= 0 ? telegram.allowedChats[existingIdx]!.alerts : {}),
      ...(options.alerts ?? {}),
    },
    pairedAt: new Date().toISOString(),
  };

  const nextAllowedChats = [...telegram.allowedChats];
  if (existingIdx >= 0) {
    nextAllowedChats[existingIdx] = updatedChat;
  } else {
    nextAllowedChats.push(updatedChat);
  }

  const updatedSettings: Settings = {
    ...settings,
    gateway: {
      ...currentGateway,
      channels: {
        ...currentGateway.channels,
        telegram: {
          ...telegram,
          allowedChats: nextAllowedChats,
        },
      },
    },
  };

  await writeSettings(updatedSettings, path);
  return updatedSettings;
}

/**
 * Perbarui status langganan chat di settings.json.
 */
export async function updateChatSubscription(
  chatId: string | number,
  subscribed: boolean,
  path: string = settingsPath(),
): Promise<Settings> {
  const { settings } = await loadSettings(path);
  const idStr = String(chatId).trim();

  const currentGateway = settings.gateway ?? {
    channels: {},
    alertPollSec: 60,
    qaPerDay: 20,
    dailySummary: false,
  };
  const telegram = currentGateway.channels.telegram ?? {
    enabled: true,
    allowedChats: [],
  };

  const existingIdx = telegram.allowedChats.findIndex((c) => String(c.id).trim() === idStr);
  const nextAllowedChats = [...telegram.allowedChats];

  if (existingIdx >= 0) {
    nextAllowedChats[existingIdx] = {
      ...nextAllowedChats[existingIdx]!,
      subscribed,
    };
  } else {
    nextAllowedChats.push({
      id: idStr,
      subscribed,
      alerts: {},
      pairedAt: new Date().toISOString(),
    });
  }

  const updatedSettings: Settings = {
    ...settings,
    gateway: {
      ...currentGateway,
      channels: {
        ...currentGateway.channels,
        telegram: {
          ...telegram,
          allowedChats: nextAllowedChats,
        },
      },
    },
  };

  await writeSettings(updatedSettings, path);
  return updatedSettings;
}

/**
 * Perbarui preferensi jenis alert per chat di settings.json.
 */
export async function updateChatAlertPreference(
  chatId: string | number,
  alertType: AlertType,
  enabled: boolean,
  path: string = settingsPath(),
): Promise<Settings> {
  const { settings } = await loadSettings(path);
  const idStr = String(chatId).trim();

  const currentGateway = settings.gateway ?? {
    channels: {},
    alertPollSec: 60,
    qaPerDay: 20,
    dailySummary: false,
  };
  const telegram = currentGateway.channels.telegram ?? {
    enabled: true,
    allowedChats: [],
  };

  const existingIdx = telegram.allowedChats.findIndex((c) => String(c.id).trim() === idStr);
  const nextAllowedChats = [...telegram.allowedChats];

  if (existingIdx >= 0) {
    nextAllowedChats[existingIdx] = {
      ...nextAllowedChats[existingIdx]!,
      alerts: {
        ...nextAllowedChats[existingIdx]!.alerts,
        [alertType]: enabled,
      },
    };
  } else {
    nextAllowedChats.push({
      id: idStr,
      subscribed: true,
      alerts: {
        [alertType]: enabled,
      },
      pairedAt: new Date().toISOString(),
    });
  }

  const updatedSettings: Settings = {
    ...settings,
    gateway: {
      ...currentGateway,
      channels: {
        ...currentGateway.channels,
        telegram: {
          ...telegram,
          allowedChats: nextAllowedChats,
        },
      },
    },
  };

  await writeSettings(updatedSettings, path);
  return updatedSettings;
}


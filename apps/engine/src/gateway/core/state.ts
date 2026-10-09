/**
 * State runtime Core Risk Engine Gateway (spec m3-channel-gateway-telegram §7).
 *
 * File: apps/engine/.data/gateway-state.json (gitignored).
 * Invarian:
 *  - Penulisan atomik (tmp lalu rename);
 *  - Hilang = aman (hanya dapat mengulang alert satu kali);
 *  - Menyimpan: offset getUpdates, dedupe alert 6 jam (kecuali severity naik),
 *    hitungan Q&A harian per chat, catatan percobaan pairing gagal, dan riwayat regime aset.
 */

import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { readFileSync, writeFileSync, renameSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface SentAlertRecord {
  /** Timestamp pesan dikirim (ms epoch). */
  timestamp: number;
  /** Nilai severity saat alert dikirim. */
  severity: number;
}

export interface AssetRegimeRecord {
  regime: string;
  /** Timestamp awal aset memasuki regime ini (ms epoch). */
  since: number;
  /** Terakhir kali regime ini teramati (ms epoch). */
  lastObserved: number;
}

export interface PairingStateRecord {
  /** SHA-256 hash dari kode pairing uppercase. */
  codeHash: string;
  /** Alias hash untuk kompatibilitas. */
  hash?: string;
  /** Nama kanal (mis. 'telegram'). */
  channel: string;
  /** Timestamp kedaluwarsa (epoch ms). */
  expiresAt: number;
  /** Jumlah percobaan gagal verifikasi untuk kode ini. */
  attempts: number;
  /** Apakah kode sudah berhasil diverifikasi & dipasangkan. */
  paired?: boolean;
  /** ID chat yang berhasil dipasangkan. */
  chatId?: string;
  /** Timestamp saat pairing berhasil (epoch ms). */
  pairedAt?: number;
}

export interface GatewayRuntimeState {
  /** Offset Telegram getUpdates polling. */
  offset?: number;
  /** Record alert yang sudah terkirim: alertKey -> { timestamp, severity }. */
  sentAlerts: Record<string, SentAlertRecord>;
  /** Hitungan Q&A harian: YYYY-MM-DD -> chatId -> count. */
  qaCounters: Record<string, Record<string, number>>;
  /** Timestamp percobaan pairing gagal: chatId -> [timestampMs, ...]. */
  failedPairingAttempts: Record<string, number[]>;
  /** Kode pairing tertunda: codeHash -> PairingStateRecord. */
  pendingPairings?: Record<string, PairingStateRecord>;
  /** Riwayat regime per aset untuk evaluasi hysteresis (turun setelah bertahan >= 1h). */
  assetRegimes: Record<string, AssetRegimeRecord>;
  /** Tanggal ringkasan harian terakhir dikirim (YYYY-MM-DD). */
  lastDailySummaryDate?: string;
}

export const DEFAULT_DEDUPE_HOURS = 6;
export const PAIRING_WINDOW_MS = 60 * 60 * 1000; // 1 jam
export const MAX_FAILED_PAIRING_ATTEMPTS = 5;

export function defaultDataDir(): string {
  const here = dirname(fileURLToPath(import.meta.url)); // src/gateway/core
  return join(here, "..", "..", "..", ".data"); // apps/engine/.data
}

export function defaultRealStatePath(): string {
  return join(defaultDataDir(), "gateway-state.json");
}

export function isTestEnvironment(): boolean {
  return Boolean(
    process.env.NODE_TEST_CONTEXT ||
    process.env.NODE_ENV === "test" ||
    process.execArgv.some((a) => a.includes("test")) ||
    process.argv.some((a) => a.includes("test") || a.includes("test/all.test.ts")) ||
    (globalThis as any).__TAHANSOE_TEST__,
  );
}

export function assertNotProductionPathInTest(path: string): void {
  if (isTestEnvironment() && !(globalThis as any).__ALLOW_REAL_STATE_PATH_IN_TEST__) {
    const normalized = path.replace(/\\/g, "/");
    const realNormalized = defaultRealStatePath().replace(/\\/g, "/");
    if (normalized === realNormalized || normalized.endsWith("/.data/gateway-state.json")) {
      throw new Error(
        `Test pollution guard: Attempted to access/write production state path (${path}) in test environment! Tests must provide an isolated temporary state file.`,
      );
    }
  }
}

export function defaultStatePath(): string {
  if (isTestEnvironment() && !(globalThis as any).__ALLOW_REAL_STATE_PATH_IN_TEST__) {
    throw new Error(
      "Test pollution guard: defaultStatePath() called in test environment without explicit statePath. Tests must provide an isolated temporary state file.",
    );
  }
  return defaultRealStatePath();
}

export function createEmptyGatewayState(): GatewayRuntimeState {
  return {
    sentAlerts: {},
    qaCounters: {},
    failedPairingAttempts: {},
    pendingPairings: {},
    assetRegimes: {},
  };
}

/**
 * Muat state runtime dari disk. Jika file tidak ada atau rusak, kembalikan state kosong aman.
 */
export async function loadGatewayState(path: string = defaultStatePath()): Promise<GatewayRuntimeState> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw);
    return {
      offset: typeof parsed.offset === "number" ? parsed.offset : undefined,
      sentAlerts: parsed.sentAlerts && typeof parsed.sentAlerts === "object" ? parsed.sentAlerts : {},
      qaCounters: parsed.qaCounters && typeof parsed.qaCounters === "object" ? parsed.qaCounters : {},
      failedPairingAttempts:
        parsed.failedPairingAttempts && typeof parsed.failedPairingAttempts === "object"
          ? parsed.failedPairingAttempts
          : {},
      pendingPairings:
        parsed.pendingPairings && typeof parsed.pendingPairings === "object"
          ? parsed.pendingPairings
          : {},
      assetRegimes: parsed.assetRegimes && typeof parsed.assetRegimes === "object" ? parsed.assetRegimes : {},
      lastDailySummaryDate: typeof parsed.lastDailySummaryDate === "string" ? parsed.lastDailySummaryDate : undefined,
    };
  } catch {
    return createEmptyGatewayState();
  }
}

/**
 * Muat state runtime secara sinkron dari disk.
 */
export function loadGatewayStateSync(path: string = defaultStatePath()): GatewayRuntimeState {
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw);
    return {
      offset: typeof parsed.offset === "number" ? parsed.offset : undefined,
      sentAlerts: parsed.sentAlerts && typeof parsed.sentAlerts === "object" ? parsed.sentAlerts : {},
      qaCounters: parsed.qaCounters && typeof parsed.qaCounters === "object" ? parsed.qaCounters : {},
      failedPairingAttempts:
        parsed.failedPairingAttempts && typeof parsed.failedPairingAttempts === "object"
          ? parsed.failedPairingAttempts
          : {},
      pendingPairings:
        parsed.pendingPairings && typeof parsed.pendingPairings === "object"
          ? parsed.pendingPairings
          : {},
      assetRegimes: parsed.assetRegimes && typeof parsed.assetRegimes === "object" ? parsed.assetRegimes : {},
      lastDailySummaryDate: typeof parsed.lastDailySummaryDate === "string" ? parsed.lastDailySummaryDate : undefined,
    };
  } catch {
    return createEmptyGatewayState();
  }
}

/**
 * Tulis state runtime secara atomik (tmp lalu rename).
 */
export async function saveGatewayState(
  state: GatewayRuntimeState,
  path: string = defaultStatePath(),
): Promise<void> {
  assertNotProductionPathInTest(path);
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  const body = JSON.stringify(state, null, 2) + "\n";
  await writeFile(tmp, body, "utf8");
  try {
    await rename(tmp, path);
  } catch {
    await writeFile(path, body, "utf8");
    try {
      const { unlink } = await import("node:fs/promises");
      await unlink(tmp);
    } catch {}
  }
}

/**
 * Tulis state runtime secara atomik & sinkron (tmp lalu rename).
 */
export function saveGatewayStateSync(
  state: GatewayRuntimeState,
  path: string = defaultStatePath(),
): void {
  assertNotProductionPathInTest(path);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  const body = JSON.stringify(state, null, 2) + "\n";
  writeFileSync(tmp, body, "utf8");
  try {
    renameSync(tmp, path);
  } catch {
    writeFileSync(path, body, "utf8");
    try {
      unlinkSync(tmp);
    } catch {}
  }
}

/**
 * Pangkas kode pairing yang sudah kedaluwarsa.
 * Mengembalikan true jika ada record yang dipangkas.
 */
export function pruneExpiredPairings(
  state: GatewayRuntimeState,
  nowMs: number = Date.now(),
): boolean {
  if (!state.pendingPairings) {
    state.pendingPairings = {};
    return false;
  }
  let changed = false;
  for (const [hash, record] of Object.entries(state.pendingPairings)) {
    if (!record) {
      delete state.pendingPairings[hash];
      changed = true;
      continue;
    }
    const exp = typeof record.expiresAt === "number" ? record.expiresAt : new Date(record.expiresAt).getTime();
    if (nowMs > exp) {
      delete state.pendingPairings[hash];
      changed = true;
    }
  }
  return changed;
}

/**
 * Dapatkan string tanggal UTC saat ini (YYYY-MM-DD).
 */
export function getUtcDateString(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Hitung jumlah Q&A hari ini untuk chat tertentu.
 */
export function getDailyQaCount(
  state: GatewayRuntimeState,
  chatId: string | number,
  dateStr: string = getUtcDateString(),
): number {
  const idStr = String(chatId).trim();
  const dayRecord = state.qaCounters[dateStr];
  if (!dayRecord) return 0;
  return dayRecord[idStr] ?? 0;
}

/**
 * Tambah hitungan Q&A hari ini untuk chat tertentu.
 */
export function incrementDailyQaCount(
  state: GatewayRuntimeState,
  chatId: string | number,
  dateStr: string = getUtcDateString(),
): number {
  const idStr = String(chatId).trim();
  if (!state.qaCounters[dateStr]) {
    state.qaCounters[dateStr] = {};
  }
  const next = (state.qaCounters[dateStr][idStr] ?? 0) + 1;
  state.qaCounters[dateStr][idStr] = next;
  return next;
}

/**
 * Periksa apakah alert dideduplikasi (masih dalam jendela dedupe dan severity tidak naik).
 * Mengembalikan true bila alert HARUS DIBATALKAN (sudah terkirim sebelumnya).
 */
export function isAlertDeduped(
  state: GatewayRuntimeState,
  alertKey: string,
  severity: number,
  nowMs: number = Date.now(),
  dedupeHours: number = DEFAULT_DEDUPE_HOURS,
): boolean {
  const record = state.sentAlerts[alertKey];
  if (!record) return false;

  const ageMs = nowMs - record.timestamp;
  const maxAgeMs = dedupeHours * 60 * 60 * 1000;

  // Jika sudah melewati jendela dedupe (6 jam), jangan dibatalkan (kirim ulang)
  if (ageMs >= maxAgeMs) {
    return false;
  }

  // Jika masih dalam jendela dedupe, HANYA kirim jika severity naik
  if (severity > record.severity) {
    return false;
  }

  return true;
}

/**
 * Rekam alert yang baru saja dikirim ke state runtime.
 */
export function recordSentAlert(
  state: GatewayRuntimeState,
  alertKey: string,
  severity: number,
  nowMs: number = Date.now(),
): void {
  state.sentAlerts[alertKey] = {
    timestamp: nowMs,
    severity,
  };
}

/**
 * Hitung jumlah kegagalan pairing dalam 1 jam terakhir untuk chat tertentu.
 */
export function getFailedPairingAttemptsCount(
  state: GatewayRuntimeState,
  chatId: string | number,
  nowMs: number = Date.now(),
): number {
  const idStr = String(chatId).trim();
  const list = state.failedPairingAttempts[idStr];
  if (!Array.isArray(list)) return 0;
  const recent = list.filter((ts) => nowMs - ts < PAIRING_WINDOW_MS);
  state.failedPairingAttempts[idStr] = recent;
  return recent.length;
}

/**
 * Rekam satu kegagalan pairing untuk sebuah chat.
 */
export function recordFailedPairingAttempt(
  state: GatewayRuntimeState,
  chatId: string | number,
  nowMs: number = Date.now(),
): number {
  const idStr = String(chatId).trim();
  const list = state.failedPairingAttempts[idStr] ?? [];
  const recent = list.filter((ts) => nowMs - ts < PAIRING_WINDOW_MS);
  recent.push(nowMs);
  state.failedPairingAttempts[idStr] = recent;
  return recent.length;
}

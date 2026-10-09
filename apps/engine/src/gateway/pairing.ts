/**
 * Manajer Pairing Kode Satu Kali Pakai untuk Gateway Kanal (spec §3.5, §6, §7).
 *
 * Invarian:
 *  - Kode acak kriptografis (>= 8 karakter, hex uppercase);
 *  - Hash SHA-256 dan metadata disimpan di file state runtime (.data/gateway-state.json);
 *  - Kedaluwarsa 10 menit;
 *  - Maksimal 5 percobaan gagal per chat per jam (mencegah brute force);
 *  - Mendukung cross-process pairing (setup / pair CLI terpisah dari agent running).
 */

import { randomBytes, createHash } from "node:crypto";
import {
  type GatewayRuntimeState,
  getFailedPairingAttemptsCount,
  recordFailedPairingAttempt,
  MAX_FAILED_PAIRING_ATTEMPTS,
  defaultStatePath,
  loadGatewayStateSync,
  saveGatewayStateSync,
  pruneExpiredPairings,
} from "./core/state.ts";

export interface PairingApi {
  createPairingCode(channel: string): { code: string; expiresAt: Date };
  pairingStatus(code: string): { status: "pending" | "paired" | "expired"; chatId?: string };
}

export interface PairingRecord {
  codeHash: string;
  channel: string;
  expiresAt: Date;
  paired: boolean;
  chatId?: string;
}

export const PAIRING_EXPIRY_MS = 10 * 60 * 1000; // 10 menit

export function hashCode(code: string): string {
  return createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
}

/**
 * Buat kode pairing baru acak (>= 8 karakter) dan simpan ke file state runtime.
 * Standalone helper: tidak memerlukan gateway yang sedang berjalan.
 */
export function createPairingCode(
  channel: string,
  statePath: string = defaultStatePath(),
): { code: string; expiresAt: Date } {
  // 6 byte hex = 12 karakter alphanumeric uppercase (>= 8 char)
  const code = randomBytes(6).toString("hex").toUpperCase();
  const codeHash = hashCode(code);
  const now = Date.now();
  const expiresAt = new Date(now + PAIRING_EXPIRY_MS);

  const state = loadGatewayStateSync(statePath);
  pruneExpiredPairings(state, now);

  if (!state.pendingPairings) {
    state.pendingPairings = {};
  }

  state.pendingPairings[codeHash] = {
    codeHash,
    hash: codeHash,
    channel,
    expiresAt: expiresAt.getTime(),
    attempts: 0,
    paired: false,
  };

  saveGatewayStateSync(state, statePath);

  return { code, expiresAt };
}

/**
 * Cek status kode pairing dari file state runtime.
 * Standalone helper: tidak memerlukan gateway yang sedang berjalan.
 */
export function pairingStatus(
  code: string,
  statePath: string = defaultStatePath(),
): { status: "pending" | "paired" | "expired"; chatId?: string } {
  const codeHash = hashCode(code);
  const now = Date.now();

  const state = loadGatewayStateSync(statePath);
  const pruned = pruneExpiredPairings(state, now);
  if (pruned) {
    try {
      saveGatewayStateSync(state, statePath);
    } catch {
      // Abaikan error saat save pasif
    }
  }

  const item = state.pendingPairings?.[codeHash];
  if (!item) {
    return { status: "expired" };
  }

  const expMs = typeof item.expiresAt === "number" ? item.expiresAt : new Date(item.expiresAt).getTime();
  if (now > expMs) {
    return { status: "expired" };
  }

  if (item.paired) {
    return { status: "paired", chatId: item.chatId };
  }

  return { status: "pending" };
}

export class PairingManager implements PairingApi {
  public readonly statePath: string;
  private state?: GatewayRuntimeState;
  private lastReloadMs = 0;

  constructor(statePath?: string, state?: GatewayRuntimeState) {
    this.statePath = statePath ?? defaultStatePath();
    this.state = state;
  }

  /**
   * Muat ulang kode pairing dari file state (paling sering tiap 5 detik sekali, kecuali force).
   */
  public reloadPendingCodes(nowMs: number = Date.now(), force = false): void {
    if (!force && nowMs - this.lastReloadMs < 5000) return;
    this.lastReloadMs = nowMs;

    try {
      const fresh = loadGatewayStateSync(this.statePath);
      pruneExpiredPairings(fresh, nowMs);
      if (this.state) {
        this.state.pendingPairings = fresh.pendingPairings;
      }
    } catch {
      // Abaikan
    }
  }

  /**
   * Buat kode pairing baru acak (>= 8 karakter), simpan hash ke state file.
   */
  public createPairingCode(channel: string): { code: string; expiresAt: Date } {
    const res = createPairingCode(channel, this.statePath);
    if (this.state) {
      const fresh = loadGatewayStateSync(this.statePath);
      this.state.pendingPairings = fresh.pendingPairings;
    }
    return res;
  }

  /**
   * Cek status kode pairing dari file state runtime.
   */
  public pairingStatus(code: string): { status: "pending" | "paired" | "expired"; chatId?: string } {
    return pairingStatus(code, this.statePath);
  }

  /**
   * Tangani percobaan pairing oleh user chat (/start <code>).
   */
  public async handlePairingAttempt(
    code: string,
    chatId: string,
    state?: GatewayRuntimeState,
    onSuccess?: (chatId: string) => Promise<void>,
    nowMs: number = Date.now(),
  ): Promise<{ ok: boolean; error?: string }> {
    // 1. Muat ulang state segar dari disk (cross-process sync)
    const activeState = loadGatewayStateSync(this.statePath);
    pruneExpiredPairings(activeState, nowMs);

    // 2. Periksa limit percobaan gagal per chat (maks 5 per jam)
    const failed = getFailedPairingAttemptsCount(activeState, chatId, nowMs);
    if (failed >= MAX_FAILED_PAIRING_ATTEMPTS) {
      saveGatewayStateSync(activeState, this.statePath);
      if (state) Object.assign(state, activeState);
      if (this.state) Object.assign(this.state, activeState);
      return {
        ok: false,
        error: "Too many failed pairing attempts. Please try again later.",
      };
    }

    const codeHash = hashCode(code);
    const item = activeState.pendingPairings?.[codeHash];

    if (item && nowMs <= item.expiresAt && !item.paired) {
      // Pairing berhasil
      item.paired = true;
      item.chatId = chatId;
      item.pairedAt = nowMs;

      saveGatewayStateSync(activeState, this.statePath);
      if (state) Object.assign(state, activeState);
      if (this.state) Object.assign(this.state, activeState);

      if (onSuccess) {
        await onSuccess(chatId);
      }
      return { ok: true };
    }

    // Gagal: rekam percobaan gagal
    if (item) {
      item.attempts = (item.attempts ?? 0) + 1;
    }
    recordFailedPairingAttempt(activeState, chatId, nowMs);
    saveGatewayStateSync(activeState, this.statePath);
    if (state) Object.assign(state, activeState);
    if (this.state) Object.assign(this.state, activeState);

    return {
      ok: false,
      error: "Pairing code is invalid or has expired.",
    };
  }
}

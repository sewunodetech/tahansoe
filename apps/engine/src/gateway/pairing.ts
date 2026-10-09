/**
 * Manajer Pairing Kode Satu Kali Pakai untuk Gateway Kanal (spec §3.5, §6, §7).
 *
 * Invarian:
 *  - Kode acak kriptografis (>= 8 karakter, hex uppercase);
 *  - Hash SHA-256 HANYA disimpan di memori proses gateway (tidak ke DB/disk);
 *  - Kedaluwarsa 10 menit;
 *  - Maksimal 5 percobaan gagal per chat per jam (mencegah brute force).
 */

import { randomBytes, createHash } from "node:crypto";
import {
  type GatewayRuntimeState,
  getFailedPairingAttemptsCount,
  recordFailedPairingAttempt,
  MAX_FAILED_PAIRING_ATTEMPTS,
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

export class PairingManager implements PairingApi {
  // Hash SHA-256 -> Record
  private pairings: Map<string, PairingRecord> = new Map();

  /**
   * Buat kode pairing baru acak (>= 8 karakter), simpan hash di memori.
   */
  public createPairingCode(channel: string): { code: string; expiresAt: Date } {
    // 6 byte hex = 12 karakter alphanumeric uppercase (>= 8 char)
    const code = randomBytes(6).toString("hex").toUpperCase();
    const codeHash = hashCode(code);
    const expiresAt = new Date(Date.now() + PAIRING_EXPIRY_MS);

    this.pairings.set(codeHash, {
      codeHash,
      channel,
      expiresAt,
      paired: false,
    });

    return { code, expiresAt };
  }

  /**
   * Cek status kode pairing.
   */
  public pairingStatus(code: string): { status: "pending" | "paired" | "expired"; chatId?: string } {
    const codeHash = hashCode(code);
    const item = this.pairings.get(codeHash);
    if (!item) {
      return { status: "expired" };
    }

    if (Date.now() > item.expiresAt.getTime()) {
      return { status: "expired" };
    }

    if (item.paired) {
      return { status: "paired", chatId: item.chatId };
    }

    return { status: "pending" };
  }

  /**
   * Tangani percobaan pairing oleh user chat (/start <code>).
   */
  public async handlePairingAttempt(
    code: string,
    chatId: string,
    state: GatewayRuntimeState,
    onSuccess: (chatId: string) => Promise<void>,
    nowMs: number = Date.now(),
  ): Promise<{ ok: boolean; error?: string }> {
    const failed = getFailedPairingAttemptsCount(state, chatId, nowMs);
    if (failed >= MAX_FAILED_PAIRING_ATTEMPTS) {
      return {
        ok: false,
        error: "Too many failed pairing attempts. Please try again later.",
      };
    }

    const codeHash = hashCode(code);
    const item = this.pairings.get(codeHash);

    if (item && nowMs <= item.expiresAt.getTime() && !item.paired) {
      // Pairing berhasil
      item.paired = true;
      item.chatId = chatId;
      await onSuccess(chatId);
      return { ok: true };
    }

    // Gagal: rekam percobaan gagal
    recordFailedPairingAttempt(state, chatId, nowMs);
    return {
      ok: false,
      error: "Pairing code is invalid or has expired.",
    };
  }
}

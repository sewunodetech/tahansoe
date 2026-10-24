/**
 * Burner wallet for Simulation Mode (spec m1-simulation-mode §3.5).
 * The key lives only in this browser's localStorage and is never sent to the server; the server
 * only ever sees the address. It holds fake funds on a chain id no real network uses.
 */

import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type { Hex } from "viem";

export const SIM_KEY_STORAGE = "tahansoe:sim-key";

function read(): Hex | null {
  try {
    const raw = localStorage.getItem(SIM_KEY_STORAGE);
    return raw && /^0x[0-9a-fA-F]{64}$/.test(raw) ? (raw as Hex) : null;
  } catch {
    return null;
  }
}

export function hasBurnerKey(): boolean {
  return read() !== null;
}

/** Returns the stored burner account, creating one on first use. */
export function getOrCreateBurner(): PrivateKeyAccount {
  let key = read();
  if (!key) {
    key = generatePrivateKey();
    try {
      localStorage.setItem(SIM_KEY_STORAGE, key);
    } catch { /* storage blocked — the burner lasts for this page only */ }
  }
  return privateKeyToAccount(key);
}

/** Stored burner account, or null when none exists yet. */
export function getBurner(): PrivateKeyAccount | null {
  const key = read();
  return key ? privateKeyToAccount(key) : null;
}

export function clearBurner(): void {
  try {
    localStorage.removeItem(SIM_KEY_STORAGE);
  } catch { /* nothing to clear */ }
}

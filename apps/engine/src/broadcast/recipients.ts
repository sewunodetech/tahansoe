/**
 * Pengelolaan penerima broadcast (spec m3-research-broadcast §3 T4).
 *
 * Mengambil telegram_accounts aktif secara distinct berdasarkan telegram_user_id.
 * Menandai isActive = false saat terjadi error 403 atau chat not found.
 */

import { getDb, telegramAccounts } from "@tahansoe/db";
import { eq } from "drizzle-orm";

export interface Recipient {
  telegramUserId: bigint;
  telegramUsername?: string | null;
  userId?: string;
}

export interface RecipientsOptions {
  db?: any;
  loadRecipients?: () => Promise<Recipient[]>;
  deactivateRecipient?: (telegramUserId: bigint | string) => Promise<void>;
}

/**
 * Dapatkan daftar akun Telegram aktif (distinct telegram_user_id).
 */
export async function getActiveRecipients(
  options: RecipientsOptions = {},
): Promise<Recipient[]> {
  if (options.loadRecipients) {
    return await options.loadRecipients();
  }

  const db = options.db ?? (process.env.DATABASE_URL ? getDb() : null);
  if (!db) return [];

  try {
    const rows = await db
      .select({
        telegramUserId: telegramAccounts.telegramUserId,
        telegramUsername: telegramAccounts.telegramUsername,
        userId: telegramAccounts.userId,
      })
      .from(telegramAccounts)
      .where(eq(telegramAccounts.isActive, true));

    const seen = new Set<string>();
    const result: Recipient[] = [];
    for (const r of rows) {
      const idStr = String(r.telegramUserId);
      if (!seen.has(idStr)) {
        seen.add(idStr);
        result.push({
          telegramUserId: BigInt(r.telegramUserId),
          telegramUsername: r.telegramUsername,
          userId: r.userId,
        });
      }
    }
    return result;
  } catch {
    return [];
  }
}

/**
 * Nonaktifkan akun Telegram (is_active = false) saat bot diblokir atau chat tidak ditemukan (403).
 */
export async function deactivateRecipient(
  telegramUserId: bigint | string,
  options: RecipientsOptions = {},
): Promise<void> {
  if (options.deactivateRecipient) {
    await options.deactivateRecipient(telegramUserId);
    return;
  }

  const db = options.db ?? (process.env.DATABASE_URL ? getDb() : null);
  if (!db) return;

  try {
    await db
      .update(telegramAccounts)
      .set({ isActive: false })
      .where(eq(telegramAccounts.telegramUserId, BigInt(telegramUserId)));
  } catch {
    // abaikan kegagalan DB
  }
}

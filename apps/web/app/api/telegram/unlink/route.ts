import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, telegramAccounts } from "@tahansoe/db";
import { getSession } from "@/lib/session";

export async function POST() {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  await db
    .update(telegramAccounts)
    .set({ isActive: false })
    .where(eq(telegramAccounts.userId, session.userId));

  return NextResponse.json({ ok: true });
}

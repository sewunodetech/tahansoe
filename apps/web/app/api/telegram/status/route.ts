import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, telegramAccounts } from "@tahansoe/db";
import { getSession } from "@/lib/session";

export async function GET() {
  const session = await getSession();

  if (!session.userId) {
    return NextResponse.json({ linked: false }, { status: 401 });
  }

  const [account] = await db
    .select({
      id: telegramAccounts.id,
      telegramUsername: telegramAccounts.telegramUsername,
      linkedAt: telegramAccounts.linkedAt,
      isActive: telegramAccounts.isActive,
    })
    .from(telegramAccounts)
    .where(eq(telegramAccounts.userId, session.userId))
    .limit(1);

  if (!account) {
    return NextResponse.json({ linked: false });
  }

  return NextResponse.json({
    linked: true,
    telegramUsername: account.telegramUsername,
    linkedAt: account.linkedAt,
    isActive: account.isActive,
  });
}
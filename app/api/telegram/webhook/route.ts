import { NextRequest, NextResponse } from "next/server";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { linkNonces, telegramAccounts } from "@/lib/schema";

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-telegram-bot-api-secret-token");
  if (secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const message = body.message;

    if (!message?.text?.startsWith("/start ")) {
      return NextResponse.json({ ok: true });
    }

    const code = message.text.slice(7).trim();
    const telegramUserId = BigInt(message.from.id);
    const telegramUsername = message.from.username ?? null;

    const now = new Date();

    const [link] = await db
      .select()
      .from(linkNonces)
      .where(
        and(
          eq(linkNonces.code, code),
          isNull(linkNonces.usedAt)
        )
      );

    if (!link) {
      await sendTelegramMessage(
        message.chat.id,
        "Invalid or already used link code. Please generate a new one from the app."
      );
      return NextResponse.json({ ok: true });
    }

    if (new Date(link.expiresAt) < now) {
      await sendTelegramMessage(
        message.chat.id,
        "Link code has expired. Please generate a new one from the app."
      );
      return NextResponse.json({ ok: true });
    }

    await db
      .update(linkNonces)
      .set({ usedAt: now })
      .where(eq(linkNonces.id, link.id));

    await db
      .insert(telegramAccounts)
      .values({
        userId: link.userId,
        telegramUserId,
        telegramUsername,
      })
      .onConflictDoUpdate({
        target: [telegramAccounts.telegramUserId],
        set: {
          userId: link.userId,
          telegramUsername,
          isActive: true,
          linkedAt: now,
        },
      });

    await sendTelegramMessage(
      message.chat.id,
      "Your Tahansoe account has been linked successfully. You will now receive liquidation risk notifications here."
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Webhook error:", error);
    return NextResponse.json({ ok: true });
  }
}

async function sendTelegramMessage(chatId: number, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}
import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { eq, and, isNull } from "drizzle-orm";
import { db, linkNonces, telegramAccounts } from "@tahansoe/db";

interface TelegramUser {
  id: number;
  username?: string;
  first_name?: string;
}

interface TelegramChat {
  id: number | string;
  type?: string;
}

interface TelegramMessage {
  text?: string;
  chat?: TelegramChat;
  from?: TelegramUser;
}

interface TelegramUpdate {
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
}

export interface WebhookContext {
  db?: typeof db;
  sendTelegramMessage?: (
    chatId: number | string | bigint,
    text: string
  ) => Promise<void>;
  now?: () => Date;
}

export async function sendTelegramMessage(
  chatId: number | string | bigint,
  text: string
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn("TELEGRAM_BOT_TOKEN is not configured; skipping outbound message");
    return;
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: typeof chatId === "bigint" ? chatId.toString() : chatId,
        text,
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error(`Telegram API error (${res.status}):`, errText);
    }
  } catch (err) {
    console.error("Failed to send Telegram message:", err);
  }
}

export async function processTelegramWebhook(
  body: unknown,
  context: WebhookContext = {}
): Promise<{ handled: boolean; action?: string; detail?: string }> {
  const update = body as TelegramUpdate | null | undefined;
  const message = update?.message ?? update?.edited_message;
  if (!message || typeof message.text !== "string") {
    return { handled: false, detail: "No text message in update" };
  }

  const chatId = message.chat?.id;
  const fromId = message.from?.id;
  if (!chatId || !fromId) {
    return { handled: false, detail: "Missing chat or sender ID" };
  }

  const dbClient = context.db ?? db;
  const sendFn = context.sendTelegramMessage ?? sendTelegramMessage;
  const getNow = context.now ?? (() => new Date());

  const telegramUserId = BigInt(fromId);
  const telegramUsername = message.from?.username ?? null;
  const text = message.text.trim();

  const [rawCmd, ...argParts] = text.split(/\s+/);
  const command = (rawCmd ?? "").toLowerCase().split("@")[0];
  const argument = argParts.join(" ").trim();

  if (command === "/start") {
    if (!argument) {
      // /start without code: welcome + guide to link from dashboard
      await sendFn(
        chatId,
        "Welcome to Tahansoe! 🛡️\n\n" +
          "To connect your account and receive risk intelligence:\n" +
          "1. Open your Tahansoe dashboard at /dashboard/telegram\n" +
          "2. Generate a secure one-time link code\n" +
          "3. Send /start <code> or click the direct link from your dashboard\n\n" +
          "Once connected, you will receive:\n" +
          "• Scheduled risk research digests (2x daily)\n" +
          "• Real-time risk alerts and immediate execution notifications\n\n" +
          "Note: Tahansoe provides defensive risk automation to reduce liquidation risk. It does not provide trading advice, price predictions, or guaranteed anti-liquidation."
      );
      return { handled: true, action: "start_welcome" };
    }

    // /start <code>
    const code = argument;
    const now = getNow();

    const [link] = await dbClient
      .select()
      .from(linkNonces)
      .where(and(eq(linkNonces.code, code), isNull(linkNonces.usedAt)));

    if (!link) {
      await sendFn(
        chatId,
        "Invalid or already used link code. Please generate a new link code from your Tahansoe dashboard at /dashboard/telegram."
      );
      return { handled: true, action: "link_invalid" };
    }

    if (new Date(link.expiresAt) < now) {
      await sendFn(
        chatId,
        "Link code has expired. Please generate a fresh link code from your Tahansoe dashboard at /dashboard/telegram."
      );
      return { handled: true, action: "link_expired" };
    }

    // Klaim kode secara atomik: dua /start <code> bersamaan tidak boleh sama-sama menautkan.
    const claimed = await dbClient
      .update(linkNonces)
      .set({ usedAt: now })
      .where(and(eq(linkNonces.id, link.id), isNull(linkNonces.usedAt)))
      .returning({ id: linkNonces.id });

    if (claimed.length === 0) {
      await sendFn(
        chatId,
        "Invalid or already used link code. Please generate a new link code from your Tahansoe dashboard at /dashboard/telegram."
      );
      return { handled: true, action: "link_invalid" };
    }

    await dbClient
      .insert(telegramAccounts)
      .values({
        userId: link.userId,
        telegramUserId,
        telegramUsername,
        isActive: true,
        linkedAt: now,
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

    await sendFn(
      chatId,
      "Your Tahansoe account has been linked successfully! 🛡️\n\n" +
        "You are now subscribed to:\n" +
        "• Scheduled risk research digests (2x daily)\n" +
        "• Real-time risk alerts and immediate execution notifications\n\n" +
        "Send /stop at any time to pause notifications.\n\n" +
        "Note: Tahansoe provides defensive risk automation to reduce liquidation risk. It does not provide trading advice, price predictions, or guaranteed anti-liquidation."
    );

    return { handled: true, action: "link_success" };
  }

  if (command === "/stop") {
    await dbClient
      .update(telegramAccounts)
      .set({ isActive: false })
      .where(eq(telegramAccounts.telegramUserId, telegramUserId));

    await sendFn(
      chatId,
      "Tahansoe notifications have been paused. 🔕\n\n" +
        "You will no longer receive scheduled risk research digests or immediate risk alerts.\n\n" +
        "To reactivate notifications at any time:\n" +
        "Visit your Tahansoe dashboard at /dashboard/telegram to generate a new link code and re-link your account."
    );

    return { handled: true, action: "stop_success" };
  }

  return { handled: false, detail: "Unhandled command or message" };
}

function isAuthorizedWebhook(header: string | null): boolean {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  if (!isAuthorizedWebhook(req.headers.get("x-telegram-bot-api-secret-token"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body: unknown = await req.json();
    await processTelegramWebhook(body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Webhook error:", error);
    return NextResponse.json({ ok: true });
  }
}

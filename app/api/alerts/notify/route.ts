/**
 * POST /api/alerts/notify
 *
 * Called by the client-side SimulationEngine when a position crosses a threshold.
 * Looks up the authenticated user's linked Telegram account and sends a formatted
 * message via the bot.
 *
 * This is best-effort: always returns 200 so the client never retries in a loop.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { telegramAccounts } from "@/lib/schema";
import { getSession } from "@/lib/session";

type AlertType =
  | "hf_warning"
  | "trigger_fired"
  | "execution_success"
  | "execution_failed";

interface NotifyPayload {
  type:       AlertType;
  positionId: string;
  protocol:   string;
  chain:      string;
  hf:         number;
  triggerAt?: number;
  targetHf?:  number;
  amount?:    number;
  asset?:     string;
}

function buildMessage(p: NotifyPayload): string {
  const pos = `${p.protocol} · ${p.chain}`;

  switch (p.type) {
    case "hf_warning":
      return (
        `⚠️ *Health Factor Warning*\n\n` +
        `Position: *${pos}*\n` +
        `Current HF: *${p.hf.toFixed(2)}*\n` +
        `Trigger at: *${p.triggerAt?.toFixed(2) ?? "—"}*\n\n` +
        `HF is approaching your trigger threshold. Tahansoe is monitoring every block.`
      );

    case "trigger_fired":
      return (
        `🚨 *Trigger Fired*\n\n` +
        `Position: *${pos}*\n` +
        `HF dropped to *${p.hf.toFixed(2)}* ≤ trigger *${p.triggerAt?.toFixed(2) ?? "—"}*\n\n` +
        `Tahansoe is executing automatic remediation via flash loan now.`
      );

    case "execution_success":
      return (
        `✅ *Remediation Successful*\n\n` +
        `Position: *${pos}*\n` +
        `Action: Repay *${p.amount ?? 0} ${p.asset ?? "USDC"}* via flash loan\n` +
        `HF restored: *${p.hf.toFixed(2)} → ${p.targetHf?.toFixed(2) ?? "—"}*\n\n` +
        `Your position is safe again. No further action needed.`
      );

    case "execution_failed":
      return (
        `❌ *Execution Failed*\n\n` +
        `Position: *${pos}*\n` +
        `Current HF: *${p.hf.toFixed(2)}*\n\n` +
        `Tahansoe could not execute the remediation transaction ` +
        `(possible causes: gas spike, slippage exceeded, flash loan reverted). ` +
        `*Manual review required immediately.*`
      );
  }
}

export async function POST(req: NextRequest) {
  try {
    /* Auth check */
    const session = await getSession();
    if (!session.userId) {
      return NextResponse.json({ ok: false, reason: "unauthenticated" }, { status: 200 });
    }

    /* Find linked telegram account */
    const [account] = await db
      .select({ telegramUserId: telegramAccounts.telegramUserId, isActive: telegramAccounts.isActive })
      .from(telegramAccounts)
      .where(eq(telegramAccounts.userId, session.userId))
      .limit(1);

    if (!account || !account.isActive) {
      return NextResponse.json({ ok: false, reason: "no_telegram" }, { status: 200 });
    }

    /* Build and send message */
    const payload: NotifyPayload = await req.json();
    const text = buildMessage(payload);

    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      return NextResponse.json({ ok: false, reason: "no_token" }, { status: 200 });
    }

    const tgRes = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          chat_id:    account.telegramUserId.toString(),
          text,
          parse_mode: "Markdown",
        }),
      }
    );

    const tgJson = await tgRes.json().catch(() => ({}));
    return NextResponse.json({ ok: tgJson.ok ?? false });

  } catch (err) {
    console.error("[alerts/notify] error:", err);
    // Always 200 — never let the client retry-loop
    return NextResponse.json({ ok: false, reason: "internal" }, { status: 200 });
  }
}

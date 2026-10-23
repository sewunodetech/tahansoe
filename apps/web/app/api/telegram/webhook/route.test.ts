import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { POST, processTelegramWebhook, type WebhookContext } from "./route";

test("POST /api/telegram/webhook - rejects unauthorized requests when secret token is wrong", async () => {
  process.env.TELEGRAM_WEBHOOK_SECRET = "correct-secret-123";

  const req = new NextRequest("http://localhost:3000/api/telegram/webhook", {
    method: "POST",
    headers: {
      "x-telegram-bot-api-secret-token": "wrong-secret",
    },
    body: JSON.stringify({ message: { text: "/start" } }),
  });

  const res = await POST(req);
  assert.equal(res.status, 401);
  const json = await res.json();
  assert.equal(json.error, "Unauthorized");
});

test("POST /api/telegram/webhook - accepts request with valid secret token", async () => {
  process.env.TELEGRAM_WEBHOOK_SECRET = "correct-secret-123";

  const req = new NextRequest("http://localhost:3000/api/telegram/webhook", {
    method: "POST",
    headers: {
      "x-telegram-bot-api-secret-token": "correct-secret-123",
    },
    body: JSON.stringify({
      message: {
        message_id: 1,
        chat: { id: 12345 },
        from: { id: 12345, username: "alice" },
        text: "/start",
      },
    }),
  });

  const res = await POST(req);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.ok, true);
});

test("processTelegramWebhook - handles /start without code (welcome & link guidance)", async () => {
  const sentMessages: Array<{ chatId: number | string | bigint; text: string }> = [];
  const fakeSend = async (chatId: number | string | bigint, text: string) => {
    sentMessages.push({ chatId, text });
  };

  const body = {
    message: {
      chat: { id: 98765 },
      from: { id: 98765, username: "bob_trader" },
      text: "/start",
    },
  };

  const res = await processTelegramWebhook(body, {
    sendTelegramMessage: fakeSend,
  });

  assert.equal(res.handled, true);
  assert.equal(res.action, "start_welcome");
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].chatId, 98765);
  assert.match(sentMessages[0].text, /Welcome to Tahansoe/);
  assert.match(sentMessages[0].text, /\/dashboard\/telegram/);
  assert.match(sentMessages[0].text, /2x daily/);
  assert.match(sentMessages[0].text, /guaranteed anti-liquidation/);
});

test("processTelegramWebhook - handles /start@bot without arguments", async () => {
  const sentMessages: Array<{ chatId: number | string | bigint; text: string }> = [];
  const fakeSend = async (chatId: number | string | bigint, text: string) => {
    sentMessages.push({ chatId, text });
  };

  const body = {
    message: {
      chat: { id: 98765 },
      from: { id: 98765, username: "bob_trader" },
      text: "/start@cuustos_bot",
    },
  };

  const res = await processTelegramWebhook(body, {
    sendTelegramMessage: fakeSend,
  });

  assert.equal(res.handled, true);
  assert.equal(res.action, "start_welcome");
  assert.equal(sentMessages.length, 1);
});

test("processTelegramWebhook - handles /stop by deactivating telegram account (is_active=false)", async () => {
  const sentMessages: Array<{ chatId: number | string | bigint; text: string }> = [];
  const fakeSend = async (chatId: number | string | bigint, text: string) => {
    sentMessages.push({ chatId, text });
  };

  let updateCalled = false;
  const updatedValues: { isActive?: boolean } = {};

  const fakeDb = {
    update: () => ({
      set: (values: Record<string, unknown>) => {
        Object.assign(updatedValues, values);
        return {
          where: () => {
            updateCalled = true;
            return Promise.resolve();
          },
        };
      },
    }),
  } as unknown as NonNullable<WebhookContext["db"]>;

  const body = {
    message: {
      chat: { id: 55555 },
      from: { id: 55555, username: "charlie" },
      text: "/stop",
    },
  };

  const res = await processTelegramWebhook(body, {
    db: fakeDb,
    sendTelegramMessage: fakeSend,
  });

  assert.equal(res.handled, true);
  assert.equal(res.action, "stop_success");
  assert.equal(updateCalled, true);
  assert.equal(updatedValues.isActive, false);

  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0].text, /notifications have been paused/i);
  assert.match(sentMessages[0].text, /\/dashboard\/telegram/);
});

test("processTelegramWebhook - handles /start <code> with invalid code", async () => {
  const sentMessages: Array<{ chatId: number | string | bigint; text: string }> = [];
  const fakeSend = async (chatId: number | string | bigint, text: string) => {
    sentMessages.push({ chatId, text });
  };

  const fakeDb = {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([]),
      }),
    }),
  } as unknown as NonNullable<WebhookContext["db"]>;

  const body = {
    message: {
      chat: { id: 11111 },
      from: { id: 11111, username: "dave" },
      text: "/start invalidcode123",
    },
  };

  const res = await processTelegramWebhook(body, {
    db: fakeDb,
    sendTelegramMessage: fakeSend,
  });

  assert.equal(res.handled, true);
  assert.equal(res.action, "link_invalid");
  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0].text, /Invalid or already used link code/i);
});

test("processTelegramWebhook - handles /start <code> with expired code", async () => {
  const sentMessages: Array<{ chatId: number | string | bigint; text: string }> = [];
  const fakeSend = async (chatId: number | string | bigint, text: string) => {
    sentMessages.push({ chatId, text });
  };

  const now = new Date("2026-10-23T12:00:00Z");
  const expiredTime = new Date("2026-10-23T11:50:00Z");

  const fakeDb = {
    select: () => ({
      from: () => ({
        where: () =>
          Promise.resolve([
            {
              id: "nonce-1",
              userId: "user-1",
              code: "expired123",
              expiresAt: expiredTime,
              usedAt: null,
            },
          ]),
      }),
    }),
  } as unknown as NonNullable<WebhookContext["db"]>;

  const body = {
    message: {
      chat: { id: 22222 },
      from: { id: 22222, username: "eve" },
      text: "/start expired123",
    },
  };

  const res = await processTelegramWebhook(body, {
    db: fakeDb,
    sendTelegramMessage: fakeSend,
    now: () => now,
  });

  assert.equal(res.handled, true);
  assert.equal(res.action, "link_expired");
  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0].text, /Link code has expired/i);
});

test("processTelegramWebhook - handles /start <code> success: links account and activates is_active", async () => {
  const sentMessages: Array<{ chatId: number | string | bigint; text: string }> = [];
  const fakeSend = async (chatId: number | string | bigint, text: string) => {
    sentMessages.push({ chatId, text });
  };

  const now = new Date("2026-10-23T12:00:00Z");
  const validExpiry = new Date("2026-10-23T12:10:00Z");

  let nonceUpdated = false;
  const insertedAccount: { isActive?: boolean; userId?: string; telegramUserId?: bigint } = {};
  const upsertSet: { isActive?: boolean } = {};

  const fakeDb = {
    select: () => ({
      from: () => ({
        where: () =>
          Promise.resolve([
            {
              id: "nonce-valid",
              userId: "user-42",
              code: "valid456",
              expiresAt: validExpiry,
              usedAt: null,
            },
          ]),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => {
          nonceUpdated = true;
          return { returning: () => Promise.resolve([{ id: "nonce-valid" }]) };
        },
      }),
    }),
    insert: () => ({
      values: (val: Record<string, unknown>) => {
        Object.assign(insertedAccount, val);
        return {
          onConflictDoUpdate: (config: { set: Record<string, unknown> }) => {
            Object.assign(upsertSet, config.set);
            return Promise.resolve();
          },
        };
      },
    }),
  } as unknown as NonNullable<WebhookContext["db"]>;

  const body = {
    message: {
      chat: { id: 33333 },
      from: { id: 33333, username: "frank" },
      text: "/start valid456",
    },
  };

  const res = await processTelegramWebhook(body, {
    db: fakeDb,
    sendTelegramMessage: fakeSend,
    now: () => now,
  });

  assert.equal(res.handled, true);
  assert.equal(res.action, "link_success");
  assert.equal(nonceUpdated, true);
  assert.equal(insertedAccount.isActive, true);
  assert.equal(insertedAccount.userId, "user-42");
  assert.equal(insertedAccount.telegramUserId, BigInt(33333));
  assert.equal(upsertSet.isActive, true);

  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0].text, /linked successfully/i);
  assert.match(sentMessages[0].text, /Scheduled risk research digests \(2x daily\)/);
  assert.match(sentMessages[0].text, /Real-time risk alerts/i);
  assert.match(sentMessages[0].text, /immediate execution notifications/i);
  assert.match(sentMessages[0].text, /\/stop/);
  assert.match(sentMessages[0].text, /guaranteed anti-liquidation/);
});

test("POST /api/telegram/webhook - rejects when TELEGRAM_WEBHOOK_SECRET is empty", async () => {
  process.env.TELEGRAM_WEBHOOK_SECRET = "";

  const req = new NextRequest("http://localhost:3000/api/telegram/webhook", {
    method: "POST",
    headers: { "x-telegram-bot-api-secret-token": "" },
    body: JSON.stringify({ message: { text: "/start" } }),
  });

  const res = await POST(req);
  assert.equal(res.status, 401);
});

test("processTelegramWebhook - concurrent /start <code> loses the claim and does not link", async () => {
  const sentMessages: { chatId: number | string | bigint; text: string }[] = [];
  let inserted = false;

  const fakeDb = {
    select: () => ({
      from: () => ({
        where: () =>
          Promise.resolve([
            {
              id: "nonce-race",
              userId: "user-7",
              code: "race789",
              expiresAt: new Date("2026-10-23T12:10:00Z"),
              usedAt: null,
            },
          ]),
      }),
    }),
    update: () => ({
      set: () => ({
        // Another request already claimed the code: no row matches `used_at IS NULL`.
        where: () => ({ returning: () => Promise.resolve([]) }),
      }),
    }),
    insert: () => {
      inserted = true;
      throw new Error("must not link when the claim was lost");
    },
  } as unknown as NonNullable<WebhookContext["db"]>;

  const res = await processTelegramWebhook(
    { message: { chat: { id: 7 }, from: { id: 7 }, text: "/start race789" } },
    {
      db: fakeDb,
      sendTelegramMessage: async (chatId, text) => {
        sentMessages.push({ chatId, text });
      },
      now: () => new Date("2026-10-23T12:00:00Z"),
    }
  );

  assert.equal(res.action, "link_invalid");
  assert.equal(inserted, false);
  assert.match(sentMessages[0].text, /already used/i);
});

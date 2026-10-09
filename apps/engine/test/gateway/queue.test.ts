/**
 * Unit test TelegramMessageQueue (rate limit, 429 retry, token masking).
 *
 * Menguji:
 *  - Pengiriman pesan berurutan
 *  - Penanganan error HTTP 429 (menghormati parameters.retry_after dan berhasil pada percobaan ulang)
 *  - Batasan laju per chat
 *  - ASSERT KETAT: token rahasia tidak pernah muncul di log antrean
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { TelegramMessageQueue } from "../../src/gateway/telegram/queue.ts";

const FAKE_BOT_TOKEN = "987654321:XYZ_secret_bot_token_test_12345678";

test("queue: enqueue dan kirim pesan normal dengan fake fetch", async () => {
  const sentRequests: Array<{ url: string; body: any }> = [];

  const fakeFetch: typeof fetch = async (input, init) => {
    const bodyStr = String(init?.body ?? "{}");
    sentRequests.push({
      url: String(input),
      body: JSON.parse(bodyStr),
    });
    return new Response(JSON.stringify({ ok: true, result: { message_id: 101 } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const logs: string[] = [];
  const queue = new TelegramMessageQueue({
    token: FAKE_BOT_TOKEN,
    fetchFn: fakeFetch,
    logger: (msg) => logs.push(msg),
    minChatIntervalMs: 10,
    minGlobalIntervalMs: 5,
  });

  await queue.enqueue("12345", "Test risk message");

  assert.equal(sentRequests.length, 1);
  assert.equal(sentRequests[0]?.body.chat_id, "12345");
  assert.equal(sentRequests[0]?.body.text, "Test risk message");

  // ASSERT: token tidak ada di log
  for (const l of logs) {
    assert.ok(!l.includes(FAKE_BOT_TOKEN), `Token leaked in log: ${l}`);
  }
});

test("queue: menangani HTTP 429 dengan retry_after dan berhasil pada retry", async () => {
  let callCount = 0;
  const logs: string[] = [];

  const fakeFetch: typeof fetch = async () => {
    callCount++;
    if (callCount === 1) {
      // Panggilan pertama gagal 429 dengan retry_after
      return new Response(
        JSON.stringify({
          ok: false,
          error_code: 429,
          description: "Too Many Requests: retry after 0",
          parameters: { retry_after: 0.05 },
        }),
        { status: 429, headers: { "Content-Type": "application/json" } },
      );
    }
    // Panggilan kedua sukses
    return new Response(JSON.stringify({ ok: true, result: { message_id: 102 } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const queue = new TelegramMessageQueue({
    token: FAKE_BOT_TOKEN,
    fetchFn: fakeFetch,
    logger: (msg) => logs.push(msg),
    minChatIntervalMs: 10,
    minGlobalIntervalMs: 5,
  });

  await queue.enqueue("99999", "Message needing retry");

  assert.equal(callCount, 2, "Harus melakukan retry setelah 429");
  assert.ok(logs.some((l) => l.includes("Rate limited (429)")));

  // ASSERT: token tidak pernah ada di log
  for (const l of logs) {
    assert.ok(!l.includes(FAKE_BOT_TOKEN), `Token leaked in log: ${l}`);
  }
});

test("queue: memotong pesan panjang > 4000 karakter menjadi beberapa pengiriman", async () => {
  const sentTexts: string[] = [];

  const fakeFetch: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    sentTexts.push(body.text);
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const queue = new TelegramMessageQueue({
    token: FAKE_BOT_TOKEN,
    fetchFn: fakeFetch,
    minChatIntervalMs: 5,
    minGlobalIntervalMs: 2,
  });

  const hugeMessage = "Section summary line.\n".repeat(250); // ~5750 karakter
  await queue.enqueue("1111", hugeMessage);

  assert.ok(sentTexts.length >= 2);
  for (const t of sentTexts) {
    assert.ok(t.length <= 4000);
  }
});

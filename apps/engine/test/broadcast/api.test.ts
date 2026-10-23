/**
 * Unit test API Telegram outbound-only & keamanan token masking (spec m3-research-broadcast).
 *
 * Invarian:
 *  - Token rahasia TIDAK PERNAH muncul di log atau error (assert ketat).
 *  - URL Bot API disamarkan.
 *  - OUTBOUND ONLY: tidak ada getUpdates, setWebhook, deleteWebhook.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  maskToken,
  maskUrl,
  sanitizeError,
  telegramGetMe,
  telegramSendMessage,
} from "../../src/telegram/api.ts";

const FAKE_SECRET_TOKEN = "123456789:ABCdefGHIjklMNOpqrSTUvwxYZ_987654";

test("api: maskToken menyamarkan token rahasia", () => {
  const masked = maskToken(FAKE_SECRET_TOKEN);
  assert.equal(masked, "1234...654");
  assert.ok(!masked.includes("ABCdefGHI"));

  assert.equal(maskToken(""), "(empty token)");
  assert.equal(maskToken("short"), "[REDACTED]");
});

test("api: maskUrl mengganti pola /bot<token>/ menjadi /bot[REDACTED]/", () => {
  const url = `https://api.telegram.org/bot${FAKE_SECRET_TOKEN}/getMe`;
  const masked = maskUrl(url, FAKE_SECRET_TOKEN);

  assert.equal(masked, "https://api.telegram.org/bot[REDACTED]/getMe");
  assert.ok(!masked.includes(FAKE_SECRET_TOKEN));
});

test("api: sanitizeError membersihkan token dari pesan error exception", () => {
  const rawErr = new Error(`Connection failed to https://api.telegram.org/bot${FAKE_SECRET_TOKEN}/sendMessage: 500`);
  const sanitized = sanitizeError(rawErr, FAKE_SECRET_TOKEN);

  assert.ok(!sanitized.includes(FAKE_SECRET_TOKEN));
  assert.ok(sanitized.includes("/bot[REDACTED]/sendMessage"));
});

test("api: telegramGetMe sukses mengembalikan ok true dan username bot", async () => {
  const fakeFetch: typeof fetch = async (input) => {
    const urlStr = String(input);
    assert.ok(urlStr.includes("getMe"));
    return new Response(
      JSON.stringify({
        ok: true,
        result: {
          id: 123456789,
          is_bot: true,
          first_name: "Tahansoe Bot",
          username: "TahansoeRiskBot",
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  const res = await telegramGetMe(FAKE_SECRET_TOKEN, { fetchFn: fakeFetch });
  assert.equal(res.ok, true);
  assert.equal(res.username, "TahansoeRiskBot");
  assert.equal(res.error, undefined);
});

test("api: telegramGetMe menangani error HTTP dan TIDAK PERNAH membocorkan token", async () => {
  const fakeFetch: typeof fetch = async () => {
    return new Response(
      JSON.stringify({
        ok: false,
        error_code: 401,
        description: `Unauthorized: token ${FAKE_SECRET_TOKEN} is invalid`,
      }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  };

  const res = await telegramGetMe(FAKE_SECRET_TOKEN, { fetchFn: fakeFetch });
  assert.equal(res.ok, false);
  assert.ok(res.error);
  // ASSERT KETAT: token rahasia TIDAK BOLEH ada di string error
  assert.ok(!res.error.includes(FAKE_SECRET_TOKEN), `Token leaked in error: ${res.error}`);
  assert.ok(res.error.includes("[REDACTED_TOKEN]"));
});

test("api: telegramGetMe menangani exception jaringan dan menyamarkan token", async () => {
  const fakeFetch: typeof fetch = async () => {
    throw new Error(`fetch failed at https://api.telegram.org/bot${FAKE_SECRET_TOKEN}/getMe`);
  };

  const res = await telegramGetMe(FAKE_SECRET_TOKEN, { fetchFn: fakeFetch });
  assert.equal(res.ok, false);
  assert.ok(res.error);
  // ASSERT KETAT: token rahasia TIDAK BOLEH ada di string error
  assert.ok(!res.error.includes(FAKE_SECRET_TOKEN), `Token leaked in error: ${res.error}`);
  assert.ok(res.error.includes("/bot[REDACTED]/getMe"));
});

test("api: telegramSendMessage mengirim pesan dengan opsi HTML dan menangkap messageId", async () => {
  let capturedBody: any;
  const fakeFetch: typeof fetch = async (_input, init) => {
    capturedBody = JSON.parse(String(init?.body ?? "{}"));
    return new Response(
      JSON.stringify({
        ok: true,
        result: { message_id: 888 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  const res = await telegramSendMessage(
    FAKE_SECRET_TOKEN,
    "123456",
    "<b>Risk Alert</b>",
    { parseMode: "HTML" },
    { fetchFn: fakeFetch },
  );

  assert.equal(res.ok, true);
  assert.equal(res.messageId, 888);
  assert.equal(capturedBody.chat_id, "123456");
  assert.equal(capturedBody.text, "<b>Risk Alert</b>");
  assert.equal(capturedBody.parse_mode, "HTML");
});

test("api: telegramSendMessage mendeteksi 403 / bot blocked", async () => {
  const fakeFetch: typeof fetch = async () => {
    return new Response(
      JSON.stringify({
        ok: false,
        error_code: 403,
        description: "Forbidden: bot was blocked by the user",
      }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  };

  const res = await telegramSendMessage(
    FAKE_SECRET_TOKEN,
    "123456",
    "alert",
    {},
    { fetchFn: fakeFetch },
  );

  assert.equal(res.ok, false);
  assert.equal(res.isBlockedOrNotFound, true);
});

test("api: telegramSendMessage mendeteksi 429 rate limit dan membaca retryAfter", async () => {
  const fakeFetch: typeof fetch = async () => {
    return new Response(
      JSON.stringify({
        ok: false,
        error_code: 429,
        description: "Too Many Requests: retry after 5",
        parameters: { retry_after: 5 },
      }),
      { status: 429, headers: { "Content-Type": "application/json" } },
    );
  };

  const res = await telegramSendMessage(
    FAKE_SECRET_TOKEN,
    "123456",
    "alert",
    {},
    { fetchFn: fakeFetch },
  );

  assert.equal(res.ok, false);
  assert.equal(res.errorCode, 429);
  assert.equal(res.retryAfter, 5);
});

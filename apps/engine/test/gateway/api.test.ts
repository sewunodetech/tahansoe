/**
 * Unit test API Telegram & keamanan token masking (spec m3-channel-gateway §2, §3.5).
 *
 * Invarian:
 *  - Token rahasia TIDAK PERNAH muncul di log atau error (assert ketat).
 *  - URL Bot API disamarkan.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  maskToken,
  maskUrl,
  sanitizeError,
  telegramGetMe,
  telegramSetMyCommands,
  telegramSetChatMenuButton,
  telegramAnswerCallbackQuery,
} from "../../src/gateway/telegram/api.ts";

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

test("api: telegramSetMyCommands mengirim daftar perintah yang benar dengan dan tanpa language_code", async () => {
  const sentPayloads: Array<{ url: string; body: any }> = [];

  const fakeFetch: typeof fetch = async (input, init) => {
    sentPayloads.push({
      url: String(input),
      body: JSON.parse(String(init?.body ?? "{}")),
    });
    return new Response(JSON.stringify({ ok: true, result: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  // 1. Default (Indonesian)
  const res1 = await telegramSetMyCommands(FAKE_SECRET_TOKEN, { fetchFn: fakeFetch });
  assert.equal(res1.ok, true);
  assert.equal(sentPayloads[0]?.body.commands?.length, 9);
  assert.equal(sentPayloads[0]?.body.commands[0].command, "status");
  assert.equal(sentPayloads[0]?.body.language_code, undefined);

  // 2. English (language_code: "en")
  const res2 = await telegramSetMyCommands(FAKE_SECRET_TOKEN, {
    fetchFn: fakeFetch,
    languageCode: "en",
  });
  assert.equal(res2.ok, true);
  assert.equal(sentPayloads[1]?.body.language_code, "en");

  // ASSERT: token tidak ada di payload bodies
  for (const p of sentPayloads) {
    assert.ok(!JSON.stringify(p.body).includes(FAKE_SECRET_TOKEN));
  }
});

test("api: telegramSetChatMenuButton mengirim payload type: commands", async () => {
  let capturedBody: any;

  const fakeFetch: typeof fetch = async (_input, init) => {
    capturedBody = JSON.parse(String(init?.body ?? "{}"));
    return new Response(JSON.stringify({ ok: true, result: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const res = await telegramSetChatMenuButton(FAKE_SECRET_TOKEN, { fetchFn: fakeFetch });
  assert.equal(res.ok, true);
  assert.deepEqual(capturedBody, { menu_button: { type: "commands" } });
});

test("api: telegramAnswerCallbackQuery mengirim callback_query_id dan text", async () => {
  let capturedBody: any;

  const fakeFetch: typeof fetch = async (_input, init) => {
    capturedBody = JSON.parse(String(init?.body ?? "{}"));
    return new Response(JSON.stringify({ ok: true, result: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const res = await telegramAnswerCallbackQuery(FAKE_SECRET_TOKEN, "cq_999", "Alert muted", {
    fetchFn: fakeFetch,
  });
  assert.equal(res.ok, true);
  assert.equal(capturedBody.callback_query_id, "cq_999");
  assert.equal(capturedBody.text, "Alert muted");
});

/**
 * Unit test TelegramAdapter (getUpdates flow, message handler, stop lifecycle).
 *
 * Menguji:
 *  - Polling getUpdates mengalirkan pesan ke onMessage handler
 *  - Offset getUpdates diperbarui
 *  - Penghentian adapter (stop) secara anggun
 *  - ASSERT: token bot tidak pernah muncul di log
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { TelegramAdapter } from "../../src/gateway/telegram/adapter.ts";
import type { InboundMessage } from "../../src/gateway/core/adapter.ts";
import { createEmptyGatewayState } from "../../src/gateway/core/state.ts";

const FAKE_BOT_TOKEN = "555555:Secret_Adapter_Token_12345678";

test("adapter: long polling getUpdates mengalirkan pesan ke handler dan memperbarui offset", async () => {
  const state = createEmptyGatewayState();
  let pollCount = 0;
  const receivedMessages: InboundMessage[] = [];
  const logs: string[] = [];

  const fakeFetch: typeof fetch = async (input, init) => {
    const urlStr = String(input);

    if (urlStr.includes("getUpdates")) {
      pollCount++;
      if (pollCount === 1) {
        return new Response(
          JSON.stringify({
            ok: true,
            result: [
              {
                update_id: 1001,
                message: {
                  message_id: 50,
                  from: { id: 777, username: "alice_user", first_name: "Alice" },
                  chat: { id: 777, type: "private", first_name: "Alice" },
                  date: 1700000000,
                  text: "/status",
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      // Polling berikutnya kirim update kosong dengan jeda agar tidak starve event loop
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 10);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          resolve(null);
        });
      });

      return new Response(
        JSON.stringify({
          ok: true,
          result: [],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    if (urlStr.includes("sendMessage")) {
      return new Response(
        JSON.stringify({ ok: true, result: { message_id: 51 } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  const adapter = new TelegramAdapter({
    token: FAKE_BOT_TOKEN,
    fetchFn: fakeFetch,
    logger: (msg) => logs.push(msg),
    pollTimeoutSec: 1,
    state,
    minChatIntervalMs: 5,
    minGlobalIntervalMs: 2,
  });

  adapter.onMessage(async (msg) => {
    receivedMessages.push(msg);
  });

  await adapter.start();

  // Tunggu sejenak agar polling loop memproses update pertama
  await new Promise((r) => setTimeout(r, 100));

  await adapter.stop();

  assert.equal(receivedMessages.length, 1);
  assert.equal(receivedMessages[0]?.chatId, "777");
  assert.equal(receivedMessages[0]?.text, "/status");
  assert.equal(receivedMessages[0]?.from?.username, "alice_user");
  assert.equal(state.offset, 1002, "Offset harus bertambah update_id + 1");

  // ASSERT KETAT: token tidak pernah muncul di log
  for (const l of logs) {
    assert.ok(!l.includes(FAKE_BOT_TOKEN), `Token leaked in log: ${l}`);
  }
});

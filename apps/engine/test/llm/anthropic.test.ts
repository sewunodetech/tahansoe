/**
 * Unit test AnthropicProvider.structured dengan client mock (tanpa API/env).
 * Memverifikasi pemetaan stop_reason, validasi schema, dan pencatatan usage.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  AnthropicProvider,
  type MessagesParseClient,
  type ParsedLike,
} from "../../src/llm/anthropic.ts";
import { Budget } from "../../src/llm/budget.ts";
import type { LlmRequest } from "../../src/llm/provider.ts";

const Schema = z.object({ answer: z.number() });

function mockClient(resp: ParsedLike): MessagesParseClient {
  return {
    messages: {
      parse: async () => resp,
    },
  };
}

function req(): LlmRequest<z.infer<typeof Schema>> {
  return {
    model: "claude-haiku-5-5",
    effort: "low",
    system: "system",
    messages: [{ role: "user", content: "data" }],
    output: Schema,
    outputName: "Answer",
  };
}

const usage = {
  input_tokens: 1000,
  output_tokens: 200,
  cache_read_input_tokens: 50,
};

test("sukses: parsed_output valid → data terisi, stopReason ok", async () => {
  const p = new AnthropicProvider(new Budget(100), mockClient({
    stop_reason: "end_turn",
    parsed_output: { answer: 4 },
    usage,
  }));
  const r = await p.structured(req());
  assert.equal(r.stopReason, "ok");
  assert.deepEqual(r.data, { answer: 4 });
  assert.equal(r.usage.inputTokens, 1000);
  assert.equal(r.usage.cacheReadTokens, 50);
});

test("refusal → data null + kategori dicatat", async () => {
  const p = new AnthropicProvider(new Budget(100), mockClient({
    stop_reason: "refusal",
    stop_details: { category: "cyber" },
    usage,
  }));
  const r = await p.structured(req());
  assert.equal(r.stopReason, "refusal");
  assert.equal(r.data, null);
  assert.match(r.error ?? "", /cyber/);
});

test("max_tokens → data null + error", async () => {
  const p = new AnthropicProvider(new Budget(100), mockClient({
    stop_reason: "max_tokens",
    usage,
  }));
  const r = await p.structured(req());
  assert.equal(r.stopReason, "max_tokens");
  assert.equal(r.data, null);
  assert.match(r.error ?? "", /max_tokens/);
});

test("schema invalid → data null, stopReason ok, error schema", async () => {
  const p = new AnthropicProvider(new Budget(100), mockClient({
    stop_reason: "end_turn",
    parsed_output: { answer: "not-a-number" },
    usage,
  }));
  const r = await p.structured(req());
  assert.equal(r.stopReason, "ok");
  assert.equal(r.data, null);
  assert.match(r.error ?? "", /schema invalid/);
});

test("budget.record dipanggil dengan usage dari respons", async () => {
  const b = new Budget(100);
  const p = new AnthropicProvider(b, mockClient({
    stop_reason: "end_turn",
    parsed_output: { answer: 1 },
    usage,
  }));
  await p.structured(req());
  assert.ok(b.spentToday() > 0, "biaya tercatat setelah call sukses");
});

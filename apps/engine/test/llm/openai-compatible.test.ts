/**
 * Unit test OpenAICompatibleProvider dengan mock fetch (offline, tanpa jaringan).
 * Kasus: sukses, JSON invalid, finish_reason length, HTTP 429 (retryable),
 * HTTP 400 (non-retryable).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  OpenAICompatibleProvider,
  type FetchLike,
} from "../../src/llm/openai-compatible.ts";
import { Budget } from "../../src/llm/budget.ts";
import type { LlmRequest } from "../../src/llm/provider.ts";

const Schema = z.object({ answer: z.number() });

function makeFetch(resp: {
  ok?: boolean;
  status?: number;
  json?: unknown;
  text?: string;
}): FetchLike {
  return async () => ({
    ok: resp.ok ?? true,
    status: resp.status ?? 200,
    json: async () => resp.json,
    text: async () => resp.text ?? "",
  });
}

function provider(fetchImpl: FetchLike) {
  return new OpenAICompatibleProvider(
    { name: "gemini", baseURL: "https://example/v1", apiKey: "k", model: "gemini-2.5-flash" },
    new Budget(100),
    fetchImpl,
  );
}

function req(): LlmRequest<z.infer<typeof Schema>> {
  return {
    model: "",
    effort: "low",
    system: "system",
    messages: [{ role: "user", content: "data" }],
    output: Schema,
    outputName: "Answer",
  };
}

function completion(content: string, finish = "stop") {
  return {
    choices: [{ finish_reason: finish, message: { content } }],
    usage: { prompt_tokens: 100, completion_tokens: 20 },
  };
}

test("sukses: content JSON valid → data terisi + usage dari prompt/completion tokens", async () => {
  const p = provider(makeFetch({ json: completion(JSON.stringify({ answer: 4 })) }));
  const r = await p.structured(req());
  assert.equal(r.stopReason, "ok");
  assert.deepEqual(r.data, { answer: 4 });
  assert.equal(r.usage.inputTokens, 100);
  assert.equal(r.usage.outputTokens, 20);
});

test("JSON invalid (schema) → data null, stopReason ok, error schema", async () => {
  const p = provider(makeFetch({ json: completion(JSON.stringify({ answer: "x" })) }));
  const r = await p.structured(req());
  assert.equal(r.stopReason, "ok");
  assert.equal(r.data, null);
  assert.match(r.error ?? "", /schema invalid/);
});

test("content bukan JSON → data null + error", async () => {
  const p = provider(makeFetch({ json: completion("not json") }));
  const r = await p.structured(req());
  assert.equal(r.data, null);
  assert.match(r.error ?? "", /not valid JSON/);
});

test("finish_reason length → max_tokens", async () => {
  const p = provider(makeFetch({ json: completion("", "length") }));
  const r = await p.structured(req());
  assert.equal(r.stopReason, "max_tokens");
  assert.equal(r.data, null);
});

test("finish_reason content_filter → refusal", async () => {
  const p = provider(makeFetch({ json: completion("", "content_filter") }));
  const r = await p.structured(req());
  assert.equal(r.stopReason, "refusal");
});

test("HTTP 429 → error retryable dengan status 429", async () => {
  const p = provider(makeFetch({ ok: false, status: 429, text: "rate limited" }));
  const r = await p.structured(req());
  assert.equal(r.stopReason, "error");
  assert.equal(r.status, 429);
  assert.match(r.error ?? "", /HTTP 429/);
});

test("HTTP 400 → error non-retryable dengan status 400", async () => {
  const p = provider(makeFetch({ ok: false, status: 400, text: "credit balance too low" }));
  const r = await p.structured(req());
  assert.equal(r.stopReason, "error");
  assert.equal(r.status, 400);
  assert.match(r.error ?? "", /credit balance too low/);
});

// --- Schema repair retry (cli-fix §1) --------------------------------------

/** Fetch yang merespons beda per panggilan (urutan). */
function makeSeqFetch(responses: Array<{ ok?: boolean; status?: number; json?: unknown }>): { fetch: FetchLike; calls: () => number } {
  let n = 0;
  const fetch: FetchLike = async () => {
    const r = responses[Math.min(n, responses.length - 1)]!;
    n += 1;
    return { ok: r.ok ?? true, status: r.status ?? 200, json: async () => r.json, text: async () => "" };
  };
  return { fetch, calls: () => n };
}

test("schema invalid lalu REPAIR berhasil pada panggilan kedua (model sama)", async () => {
  const seq = makeSeqFetch([
    { json: completion(JSON.stringify({ answer: "bad" })) }, // invalid
    { json: completion(JSON.stringify({ answer: 7 })) }, // repaired
  ]);
  const p = provider(seq.fetch);
  const r = await p.structured(req());
  assert.equal(r.stopReason, "ok");
  assert.deepEqual(r.data, { answer: 7 });
  assert.equal(seq.calls(), 2, "satu repair retry pada model yang sama");
  // Usage diakumulasi lintas percobaan (100+100 in, 20+20 out).
  assert.equal(r.usage.inputTokens, 200);
  assert.equal(r.usage.outputTokens, 40);
  assert.ok(!r.schemaInvalid, "sukses setelah repair → tidak ditandai schemaInvalid");
});

test("schema invalid tetap gagal setelah repair → schemaInvalid true (untuk fallback)", async () => {
  const seq = makeSeqFetch([
    { json: completion(JSON.stringify({ answer: "x" })) },
    { json: completion(JSON.stringify({ answer: "still-bad" })) },
  ]);
  const p = provider(seq.fetch);
  const r = await p.structured(req());
  assert.equal(r.data, null);
  assert.equal(r.schemaInvalid, true);
  assert.equal(seq.calls(), 2, "hanya SATU repair retry (tidak lebih)");
  assert.match(r.error ?? "", /schema invalid/);
});

test("repair message hanya memuat path+pesan validasi (tanpa konten eksternal)", async () => {
  // Tangkap body panggilan kedua untuk memeriksa pesan repair.
  const bodies: string[] = [];
  let n = 0;
  const fetchImpl: FetchLike = async (_url, init) => {
    bodies.push(init.body);
    const content = n === 0 ? JSON.stringify({ answer: "bad" }) : JSON.stringify({ answer: 1 });
    n += 1;
    return { ok: true, status: 200, json: async () => completion(content), text: async () => "" };
  };
  const p = provider(fetchImpl);
  const SECRET_EXTERNAL = "SENSITIVE-NEWS-HEADLINE-XYZ";
  await p.structured({ ...req(), messages: [{ role: "user", content: SECRET_EXTERNAL }] });
  assert.equal(bodies.length, 2);
  const repairBody = bodies[1]!;
  assert.match(repairBody, /failed schema validation/i, "ada instruksi repair");
  // Pesan repair user TIDAK boleh menyalin konten eksternal sebagai instruksi baru;
  // (konten eksternal asli tetap ada sebagai data di messages, itu wajar — yang
  // penting instruksi repair hanya berisi path+message validasi).
  const repair = JSON.parse(repairBody) as { messages: Array<{ role: string; content: string }> };
  const lastUser = repair.messages[repair.messages.length - 1]!;
  assert.match(lastUser.content, /Validation errors:/);
  assert.doesNotMatch(lastUser.content, new RegExp(SECRET_EXTERNAL));
});

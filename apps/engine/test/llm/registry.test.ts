/**
 * Unit test registry: parseRoleSpec + RoleRouter fallback berantai.
 * Offline: RoleRouter diberi provider yang sudah dibuat (FakeProvider), tanpa env.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { parseRoleSpec, RoleRouter, isProviderAvailable, type RoleEntry } from "../../src/llm/registry.ts";
import { FakeProvider } from "../fake-provider.ts";
import { Budget } from "../../src/llm/budget.ts";
import type { LlmRequest } from "../../src/llm/provider.ts";

const Schema = z.object({ answer: z.number() });

function req(): LlmRequest<z.infer<typeof Schema>> {
  return {
    model: "ignored",
    effort: "low",
    system: "s",
    messages: [{ role: "user", content: "d" }],
    output: Schema,
    outputName: "Answer",
  };
}

test("parseRoleSpec: parse daftar provider:model", () => {
  const out = parseRoleSpec("gemini:gemini-flash-lite-latest, openrouter:x/y");
  assert.deepEqual(out, [
    { provider: "gemini", model: "gemini-flash-lite-latest" },
    { provider: "openrouter", model: "x/y" },
  ]);
});

test("parseRoleSpec: entri tak valid dilewati", () => {
  const out = parseRoleSpec("unknownprov:m, gemini:, :m, groq:llama");
  assert.deepEqual(out, [{ provider: "groq", model: "llama" }]);
});

test("parseRoleSpec: string kosong → []", () => {
  assert.deepEqual(parseRoleSpec(""), []);
});

const entries: RoleEntry[] = [
  { provider: "gemini", model: "m1" },
  { provider: "groq", model: "m2" },
];

test("RoleRouter: entri pertama sukses → tidak fallback", async () => {
  const p1 = new FakeProvider([{ data: { answer: 1 } }]);
  const p2 = new FakeProvider([{ data: { answer: 2 } }]);
  const router = new RoleRouter(entries, new Budget(100), undefined, [p1, p2]);
  const r = await router.structured(req());
  assert.deepEqual(r.data, { answer: 1 });
  assert.equal(p2.calls.length, 0, "provider kedua tidak dipanggil");
});

test("RoleRouter: 429 retryable → retry 1x entri sama lalu fallback ke entri berikutnya", async () => {
  // Dua respons 429 (percobaan 1 & retry) agar p1 benar-benar dicoba 2x.
  const p1 = new FakeProvider(
    [
      { stopReason: "error", error: "HTTP 429", status: 429 },
      { stopReason: "error", error: "HTTP 429", status: 429 },
    ],
    { stopReason: "error", error: "HTTP 429", status: 429 },
  );
  const p2 = new FakeProvider([{ data: { answer: 2 } }]);
  const router = new RoleRouter(entries, new Budget(100), undefined, [p1, p2], 0);
  const r = await router.structured(req());
  assert.deepEqual(r.data, { answer: 2 });
  assert.equal(p1.calls.length, 2, "entri pertama dicoba 2x (retry sekali)");
  assert.equal(p2.calls.length, 1, "lalu fallback ke entri kedua");
});

test("RoleRouter: 400 non-retryable → TANPA retry, langsung fallback", async () => {
  const p1 = new FakeProvider(
    [{ stopReason: "error", error: "HTTP 400 credit", status: 400 }],
    { stopReason: "error", error: "HTTP 400 credit", status: 400 },
  );
  const p2 = new FakeProvider([{ data: { answer: 2 } }]);
  const router = new RoleRouter(entries, new Budget(100), undefined, [p1, p2], 0);
  const r = await router.structured(req());
  assert.deepEqual(r.data, { answer: 2 });
  assert.equal(p1.calls.length, 1, "non-retryable tidak diulang pada entri sama");
});

test("RoleRouter: semua gagal → error gabungan", async () => {
  const p1 = new FakeProvider(
    [{ stopReason: "error", error: "HTTP 500", status: 500 }],
    { stopReason: "error", error: "HTTP 500", status: 500 },
  );
  const p2 = new FakeProvider(
    [{ stopReason: "error", error: "HTTP 400", status: 400 }],
    { stopReason: "error", error: "HTTP 400", status: 400 },
  );
  const router = new RoleRouter(entries, new Budget(100), undefined, [p1, p2], 0);
  const r = await router.structured(req());
  assert.equal(r.data, null);
  assert.equal(r.stopReason, "error");
  assert.match(r.error ?? "", /semua provider gagal/);
  assert.match(r.error ?? "", /gemini:m1/);
  assert.match(r.error ?? "", /groq:m2/);
});

test("RoleRouter: refusal tidak memicu fallback", async () => {
  const p1 = new FakeProvider([{ stopReason: "refusal", error: "refusal" }]);
  const p2 = new FakeProvider([{ data: { answer: 2 } }]);
  const router = new RoleRouter(entries, new Budget(100), undefined, [p1, p2]);
  const r = await router.structured(req());
  assert.equal(r.stopReason, "refusal");
  assert.equal(p2.calls.length, 0, "refusal tidak fallback");
});

test("RoleRouter: tanpa provider → error jelas", async () => {
  const router = new RoleRouter([], new Budget(100), undefined, []);
  const r = await router.structured(req());
  assert.equal(r.data, null);
  assert.match(r.error ?? "", /tidak ada provider LLM tersedia/);
});

test("RoleRouter: 503 lalu sukses pada retry (entri sama, tanpa fallback)", async () => {
  const p1 = new FakeProvider([
    { stopReason: "error", error: "HTTP 503 high demand", status: 503 },
    { data: { answer: 9 } },
  ]);
  const p2 = new FakeProvider([{ data: { answer: 2 } }]);
  const router = new RoleRouter(entries, new Budget(100), undefined, [p1, p2], 0);
  const r = await router.structured(req());
  assert.deepEqual(r.data, { answer: 9 }, "retry pada entri sama berhasil");
  assert.equal(p1.calls.length, 2);
  assert.equal(p2.calls.length, 0, "tidak perlu fallback");
});

test("isProviderAvailable(ollama): hanya true jika OLLAMA_BASE_URL diset eksplisit", async () => {
  const prev = process.env.OLLAMA_BASE_URL;
  try {
    delete process.env.OLLAMA_BASE_URL;
    assert.equal(isProviderAvailable("ollama"), false, "default → tidak tersedia");
    process.env.OLLAMA_BASE_URL = "http://localhost:11434/v1";
    assert.equal(isProviderAvailable("ollama"), true, "set eksplisit → tersedia");
  } finally {
    if (prev === undefined) delete process.env.OLLAMA_BASE_URL;
    else process.env.OLLAMA_BASE_URL = prev;
  }
});

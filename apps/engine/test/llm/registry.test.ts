/**
 * Unit test registry gateway (ADR 0009): parseRoleSpec (nama model polos),
 * RoleRouter fallback antar-model + retry 429/5xx, dan error gateway jelas.
 * Offline: RoleRouter diberi provider yang sudah dibuat (FakeProvider), tanpa env.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

// Isolasi dari settings.json lokal developer (per mesin). Arahkan ke path kosong.
process.env.TAHANSOE_SETTINGS = "/__tahansoe_no_settings__/registry.test.json";

import {
  parseRoleSpec,
  RoleRouter,
  normalizeBaseUrl,
  gatewayError,
  type RoleEntry,
} from "../../src/llm/registry.ts";
import { FakeProvider } from "../fake-provider.ts";
import { Budget } from "../../src/llm/budget.ts";
import type { LlmRequest } from "../../src/llm/provider.ts";

const Schema = z.object({ answer: z.number() });

function req(): LlmRequest<z.infer<typeof Schema>> {
  return { model: "ignored", effort: "low", system: "s", messages: [{ role: "user", content: "d" }], output: Schema, outputName: "Answer" };
}

test("parseRoleSpec: nama model polos (string atau array)", () => {
  assert.deepEqual(parseRoleSpec("agnes-2.5-flash, deepseek-v4.1-flash"), [
    { model: "agnes-2.5-flash" },
    { model: "deepseek-v4.1-flash" },
  ]);
  assert.deepEqual(parseRoleSpec(["agnes-2.5-flash", "deepseek-v4.1-flash"]), [
    { model: "agnes-2.5-flash" },
    { model: "deepseek-v4.1-flash" },
  ]);
});

test("parseRoleSpec: strip awalan provider lama; pertahankan ':' sah", () => {
  assert.deepEqual(parseRoleSpec("bynara:agnes-2.5-flash"), [{ model: "agnes-2.5-flash" }]);
  assert.deepEqual(parseRoleSpec("gemini:gemini-flash-latest"), [{ model: "gemini-flash-latest" }]);
  // model id sah yang mengandung ":" tetap utuh.
  assert.deepEqual(parseRoleSpec("meta-llama/x:free"), [{ model: "meta-llama/x:free" }]);
});

test("parseRoleSpec: string kosong → []", () => {
  assert.deepEqual(parseRoleSpec(""), []);
});

test("normalizeBaseUrl: buang /chat/completions & trailing slash", () => {
  assert.equal(normalizeBaseUrl("https://router.bynara.id/v1/chat/completions"), "https://router.bynara.id/v1");
  assert.equal(normalizeBaseUrl("https://x/v1/"), "https://x/v1");
});

test("gatewayError: sebut env yang kurang, tanpa nilai key", () => {
  const prevUrl = process.env.LLM_API_URL;
  const prevKey = process.env.LLM_API_KEY;
  try {
    delete process.env.LLM_API_URL;
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_API_KEY;
    const err = gatewayError();
    assert.match(err, /LLM_API_URL/);
    assert.match(err, /LLM_API_KEY/);
    assert.match(err, /apps\/engine\/\.env/);
  } finally {
    if (prevUrl === undefined) delete process.env.LLM_API_URL; else process.env.LLM_API_URL = prevUrl;
    if (prevKey === undefined) delete process.env.LLM_API_KEY; else process.env.LLM_API_KEY = prevKey;
  }
});

const entries: RoleEntry[] = [{ model: "m1" }, { model: "m2" }];

test("RoleRouter: model pertama sukses → tidak fallback", async () => {
  const p1 = new FakeProvider([{ data: { answer: 1 } }]);
  const p2 = new FakeProvider([{ data: { answer: 2 } }]);
  const router = new RoleRouter(entries, new Budget(100), undefined, [p1, p2]);
  const r = await router.structured(req());
  assert.deepEqual(r.data, { answer: 1 });
  assert.equal(p2.calls.length, 0);
  assert.equal(r.providerUsed, "m1");
});

test("RoleRouter: 429 retryable → retry 1x model sama lalu fallback model berikutnya", async () => {
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
  assert.equal(p1.calls.length, 2);
  assert.equal(p2.calls.length, 1);
});

test("RoleRouter: 400 non-retryable → tanpa retry, langsung fallback", async () => {
  const p1 = new FakeProvider(
    [{ stopReason: "error", error: "HTTP 400", status: 400 }],
    { stopReason: "error", error: "HTTP 400", status: 400 },
  );
  const p2 = new FakeProvider([{ data: { answer: 2 } }]);
  const router = new RoleRouter(entries, new Budget(100), undefined, [p1, p2], 0);
  const r = await router.structured(req());
  assert.deepEqual(r.data, { answer: 2 });
  assert.equal(p1.calls.length, 1);
});

test("RoleRouter: semua gagal → error gabungan menyebut model", async () => {
  const p1 = new FakeProvider([{ stopReason: "error", error: "HTTP 500", status: 500 }], { stopReason: "error", error: "HTTP 500", status: 500 });
  const p2 = new FakeProvider([{ stopReason: "error", error: "HTTP 400", status: 400 }], { stopReason: "error", error: "HTTP 400", status: 400 });
  const router = new RoleRouter(entries, new Budget(100), undefined, [p1, p2], 0);
  const r = await router.structured(req());
  assert.equal(r.data, null);
  assert.match(r.error ?? "", /semua model gagal/);
  assert.match(r.error ?? "", /m1/);
  assert.match(r.error ?? "", /m2/);
});

test("RoleRouter: refusal tidak memicu fallback", async () => {
  const p1 = new FakeProvider([{ stopReason: "refusal", error: "refusal" }]);
  const p2 = new FakeProvider([{ data: { answer: 2 } }]);
  const router = new RoleRouter(entries, new Budget(100), undefined, [p1, p2]);
  const r = await router.structured(req());
  assert.equal(r.stopReason, "refusal");
  assert.equal(p2.calls.length, 0);
});

test("RoleRouter: tanpa model → error jelas", async () => {
  const router = new RoleRouter([], new Budget(100), undefined, []);
  const r = await router.structured(req());
  assert.equal(r.data, null);
  assert.match(r.error ?? "", /tidak ada model LLM dikonfigurasi/);
});

test("RoleRouter: 503 lalu sukses pada retry (model sama)", async () => {
  const p1 = new FakeProvider([
    { stopReason: "error", error: "HTTP 503", status: 503 },
    { data: { answer: 9 } },
  ]);
  const p2 = new FakeProvider([{ data: { answer: 2 } }]);
  const router = new RoleRouter(entries, new Budget(100), undefined, [p1, p2], 0);
  const r = await router.structured(req());
  assert.deepEqual(r.data, { answer: 9 });
  assert.equal(p1.calls.length, 2);
  assert.equal(p2.calls.length, 0);
});

test("RoleRouter: schema invalid pada model pertama → FALLBACK ke model berikutnya (cli-fix §1b)", async () => {
  // Model pertama selalu schema-invalid (provider sudah repair sendiri);
  // router harus pindah ke model kedua, TANPA retry same-model.
  const p1 = new FakeProvider([{ schemaInvalid: true, error: "schema invalid: summary too long" }], {
    schemaInvalid: true,
    error: "schema invalid: summary too long",
  });
  const p2 = new FakeProvider([{ data: { answer: 2 } }]);
  const router = new RoleRouter(entries, new Budget(100), undefined, [p1, p2], 0);
  const r = await router.structured(req());
  assert.deepEqual(r.data, { answer: 2 }, "fallback ke model kedua");
  assert.equal(p1.calls.length, 1, "schema-invalid tidak di-retry same-model di router (repair ada di provider)");
  assert.equal(p2.calls.length, 1);
  assert.equal(r.providerUsed, "m2");
});

test("RoleRouter: semua model schema invalid → error gabungan menyebut schema", async () => {
  const p1 = new FakeProvider([{ schemaInvalid: true, error: "schema invalid: a" }], { schemaInvalid: true, error: "schema invalid: a" });
  const p2 = new FakeProvider([{ schemaInvalid: true, error: "schema invalid: b" }], { schemaInvalid: true, error: "schema invalid: b" });
  const router = new RoleRouter(entries, new Budget(100), undefined, [p1, p2], 0);
  const r = await router.structured(req());
  assert.equal(r.data, null);
  assert.match(r.error ?? "", /semua model gagal/);
  assert.match(r.error ?? "", /schema invalid/);
});

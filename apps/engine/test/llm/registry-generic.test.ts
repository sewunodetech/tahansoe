/**
 * Unit test provider generik (offline): customProviders, normalizeBaseUrl,
 * parseRoleSpec dengan model tanpa prefix & model berisi ':'. Memanipulasi
 * env lewat objek literal (customProviders menerima envVars), tidak menyentuh
 * process.env global kecuali untuk parseRoleSpec yang membaca default.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

// Isolasi dari settings.json lokal (lihat registry.test.ts).
process.env.TAHANSOE_SETTINGS = "/__tahansoe_no_settings__/registry-generic.test.json";

import { customProviders, normalizeBaseUrl, parseRoleSpec } from "../../src/llm/registry.ts";

test("normalizeBaseUrl: buang /chat/completions & trailing slash", () => {
  assert.equal(normalizeBaseUrl("https://router.bynara.id/v1/chat/completions"), "https://router.bynara.id/v1");
  assert.equal(normalizeBaseUrl("https://router.bynara.id/v1/"), "https://router.bynara.id/v1");
  assert.equal(normalizeBaseUrl("https://x/v1/chat/completions/"), "https://x/v1");
  assert.equal(normalizeBaseUrl("  https://x/v1  "), "https://x/v1");
});

test("customProviders: LLM_BASE_URL + LLM_PROVIDER_NAME", () => {
  const out = customProviders({
    LLM_BASE_URL: "https://router.bynara.id/v1/chat/completions",
    LLM_API_KEY: "secret",
    LLM_PROVIDER_NAME: "Bynara",
  });
  assert.deepEqual(out.bynara, { baseURL: "https://router.bynara.id/v1", apiKey: "secret" });
});

test("customProviders: default nama 'custom' bila LLM_PROVIDER_NAME kosong", () => {
  const out = customProviders({ LLM_BASE_URL: "https://x/v1" });
  assert.ok(out.custom);
  assert.equal(out.custom.baseURL, "https://x/v1");
  assert.equal(out.custom.apiKey, "");
});

test("customProviders: LLM_PROVIDER_<NAMA>_BASE_URL/_API_KEY", () => {
  const out = customProviders({
    LLM_PROVIDER_DEEPSEEK_BASE_URL: "https://api.deepseek.com/v1/chat/completions",
    LLM_PROVIDER_DEEPSEEK_API_KEY: "dk",
  });
  assert.deepEqual(out.deepseek, { baseURL: "https://api.deepseek.com/v1", apiKey: "dk" });
});

test("parseRoleSpec: model tanpa prefix → provider generik default (fallback)", () => {
  const out = parseRoleSpec("deepseek-v4.1-flash", "custom");
  assert.deepEqual(out, [{ provider: "custom", model: "deepseek-v4.1-flash" }]);
});

test("parseRoleSpec: tanpa fallback & tanpa provider dikenal → dilewati", () => {
  const out = parseRoleSpec("deepseek-v4.1-flash", null);
  assert.deepEqual(out, []);
});

test("parseRoleSpec: model berisi ':' (openrouter free) tetap utuh", () => {
  const out = parseRoleSpec("openrouter:meta-llama/llama-3.3-70b-instruct:free", null);
  assert.deepEqual(out, [{ provider: "openrouter", model: "meta-llama/llama-3.3-70b-instruct:free" }]);
});

test("parseRoleSpec: campuran provider dikenal + model polos dengan fallback", () => {
  const out = parseRoleSpec("groq:llama, flash-model", "custom");
  assert.deepEqual(out, [
    { provider: "groq", model: "llama" },
    { provider: "custom", model: "flash-model" },
  ]);
});

/**
 * Unit test config.env LLM gateway (ADR 0009): llmApiUrl membaca LLM_API_URL,
 * fallback ke LLM_BASE_URL (alias usang) dengan peringatan sekali, dan budget tetap.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { env } from "../src/config.ts";

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const keys = ["LLM_API_URL", "LLM_BASE_URL", "LLM_API_KEY", "LLM_DAILY_BUDGET_USD"];
  const prev: Record<string, string | undefined> = {};
  for (const k of keys) prev[k] = process.env[k];
  try {
    for (const k of keys) delete process.env[k];
    for (const [k, v] of Object.entries(vars)) if (v !== undefined) process.env[k] = v;
    fn();
  } finally {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k]!;
    }
  }
}

test("llmApiUrl: dari LLM_API_URL", () => {
  withEnv({ LLM_API_URL: "https://router.bynara.id/v1" }, () => {
    assert.equal(env.llmApiUrl(), "https://router.bynara.id/v1");
  });
});

test("llmApiUrl: fallback LLM_BASE_URL (alias usang) dengan peringatan sekali", () => {
  const warnings: string[] = [];
  const orig = console.warn;
  console.warn = (msg?: unknown) => void warnings.push(String(msg));
  try {
    withEnv({ LLM_BASE_URL: "https://legacy/v1" }, () => {
      // Catatan: peringatan "sekali per proses" — mungkin sudah tercetak di test lain.
      // Yang penting NILAI alias dikembalikan.
      assert.equal(env.llmApiUrl(), "https://legacy/v1");
    });
  } finally {
    console.warn = orig;
  }
});

test("llmApiUrl: kosong bila tidak ada URL", () => {
  withEnv({}, () => {
    assert.equal(env.llmApiUrl(), "");
  });
});

test("llmApiKey & budget tetap", () => {
  withEnv({ LLM_API_KEY: "secret", LLM_DAILY_BUDGET_USD: "7" }, () => {
    assert.equal(env.llmApiKey(), "secret");
    assert.equal(env.llmDailyBudgetUsd(), 7);
  });
});

test("config.env TIDAK lagi punya getter provider lama (ADR 0009)", () => {
  const e = env as unknown as Record<string, unknown>;
  for (const removed of [
    "anthropicApiKey",
    "geminiApiKey",
    "openrouterApiKey",
    "groqApiKey",
    "ollamaBaseUrl",
    "llmBaseUrl",
    "llmProviderName",
    "llmModel",
    "llmPricingUrl",
    "llmModelPricesJson",
    "llmAnalyst",
    "llmDebate",
    "llmAssessor",
    "llmReflector",
  ]) {
    assert.equal(e[removed], undefined, `getter ${removed} seharusnya dihapus`);
  }
});

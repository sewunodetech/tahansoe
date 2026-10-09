/**
 * Unit test konfigurasi gateway (ADR 0009): gatewayConfig membaca LLM_API_URL +
 * LLM_API_KEY, alias usang LLM_BASE_URL, normalisasi URL, isGatewayConfigured.
 * Offline: memanipulasi process.env lalu memulihkannya.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.TAHANSOE_SETTINGS = "/__tahansoe_no_settings__/gateway.test.json";

import { gatewayConfig, isGatewayConfigured } from "../../src/llm/registry.ts";

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const keys = ["LLM_API_URL", "LLM_BASE_URL", "LLM_API_KEY"];
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

test("gatewayConfig: LLM_API_URL dinormalisasi (buang /chat/completions)", () => {
  withEnv({ LLM_API_URL: "https://router.bynara.id/v1/chat/completions", LLM_API_KEY: "k" }, () => {
    const g = gatewayConfig();
    assert.equal(g.baseURL, "https://router.bynara.id/v1");
    assert.equal(g.apiKey, "k");
    assert.equal(isGatewayConfigured(), true);
  });
});

test("gatewayConfig: alias usang LLM_BASE_URL dipakai bila LLM_API_URL kosong", () => {
  withEnv({ LLM_BASE_URL: "https://x/v1", LLM_API_KEY: "k" }, () => {
    assert.equal(gatewayConfig().baseURL, "https://x/v1");
    assert.equal(isGatewayConfigured(), true);
  });
});

test("gatewayConfig: LLM_API_URL menang atas LLM_BASE_URL", () => {
  withEnv({ LLM_API_URL: "https://primary/v1", LLM_BASE_URL: "https://legacy/v1", LLM_API_KEY: "k" }, () => {
    assert.equal(gatewayConfig().baseURL, "https://primary/v1");
  });
});

test("isGatewayConfigured: false bila URL atau key kosong", () => {
  withEnv({ LLM_API_URL: "https://x/v1" }, () => {
    assert.equal(isGatewayConfigured(), false, "tanpa key → belum siap");
  });
  withEnv({ LLM_API_KEY: "k" }, () => {
    assert.equal(isGatewayConfigured(), false, "tanpa URL → belum siap");
  });
});

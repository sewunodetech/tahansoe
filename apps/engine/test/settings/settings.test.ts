/**
 * Unit test settings v2 (ADR 0009): validasi skema, migrasi v1→v2 (strip awalan
 * provider + bawa pricingUrl), resolveRoleSpecList, path override, tulis atomik.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { emptySettings, stripProviderPrefix } from "../../src/settings/schema.ts";
import {
  parseSettings,
  resolveRoleSpecList,
  gatewayPricingUrl,
  migrateV1toV2,
  writeSettings,
  loadSettings,
  settingsPath,
} from "../../src/settings/settings.ts";

const GOOD_V2 = JSON.stringify({
  version: 2,
  roles: { analyst: ["agnes-2.5-flash"], assessor: ["deepseek-v4.1-flash", "agnes-2.5-flash"] },
  pricingUrl: "https://router.bynara.id/api/pricing",
  modelPrices: { x: { inputPerM: 0.3, outputPerM: 1.2 } },
  estimate: { runsPerDay: 24 },
});

test("parseSettings v2: JSON valid → objek settings", () => {
  const { settings } = parseSettings(GOOD_V2);
  assert.equal(settings.version, 2);
  assert.deepEqual(settings.roles.analyst, ["agnes-2.5-flash"]);
  assert.equal(settings.pricingUrl, "https://router.bynara.id/api/pricing");
  assert.equal(settings.estimate.runsPerDay, 24);
});

test("parseSettings: JSON rusak → error jelas", () => {
  assert.throws(() => parseSettings("{not json", "/x/settings.json"), /bukan JSON valid/);
});

test("parseSettings: versi tak dikenal → error jelas", () => {
  assert.throws(() => parseSettings(JSON.stringify({ version: 99 }), "/x"), /versi skema 99 tidak didukung/);
});

test("parseSettings: field salah → error validasi dengan path", () => {
  const bad = JSON.stringify({ version: 2, roles: { analyst: "bukan-array" } });
  assert.throws(() => parseSettings(bad), /tidak valid[\s\S]*analyst/);
});

test("parseSettings: v2 TOLAK providers (field tak dikenal, strict)", () => {
  const bad = JSON.stringify({ version: 2, providers: { p: { baseUrl: "x" } } });
  assert.throws(() => parseSettings(bad), /tidak valid/);
});

test("stripProviderPrefix: strip hanya provider lama dikenal; pertahankan ':' sah", () => {
  assert.equal(stripProviderPrefix("bynara:agnes-2.5-flash"), "agnes-2.5-flash");
  assert.equal(stripProviderPrefix("gemini:gemini-flash-latest"), "gemini-flash-latest");
  assert.equal(stripProviderPrefix("custom:deepseek-v4.1-flash"), "deepseek-v4.1-flash");
  // model id yang sah mengandung ":" (prefix bukan provider) TIDAK diubah.
  assert.equal(stripProviderPrefix("meta-llama/llama-3.3-70b:free"), "meta-llama/llama-3.3-70b:free");
  assert.equal(stripProviderPrefix("agnes-2.5-flash"), "agnes-2.5-flash");
});

test("migrateV1toV2: ambil roles (strip prefix) + bawa pricingUrl provider pertama", () => {
  const v1 = {
    version: 1,
    providers: {
      bynara: { baseUrl: "https://router.bynara.id/v1", apiKeyEnv: "LLM_API_KEY", pricingUrl: "https://router.bynara.id/api/pricing" },
      gemini: { baseUrl: "https://g/v1", apiKeyEnv: "GEMINI_API_KEY" },
    },
    roles: {
      analyst: ["bynara:agnes-2.5-flash", "gemini:gemini-flash-lite-latest"],
      assessor: ["bynara:deepseek-v4.1-flash"],
    },
    modelPrices: { m: { inputPerM: 1, outputPerM: 2 } },
    estimate: { runsPerDay: 12 },
  };
  const warnings: string[] = [];
  const v2 = migrateV1toV2(v1, warnings);
  assert.equal(v2.version, 2);
  assert.deepEqual(v2.roles.analyst, ["agnes-2.5-flash", "gemini-flash-lite-latest"]);
  assert.deepEqual(v2.roles.assessor, ["deepseek-v4.1-flash"]);
  assert.equal(v2.pricingUrl, "https://router.bynara.id/api/pricing");
  assert.ok(v2.modelPrices.m);
  assert.equal(v2.estimate.runsPerDay, 12);
  assert.match(warnings.join(" "), /v1 dimigrasikan ke v2/);
});

test("parseSettings: baca file v1 → otomatis migrasi ke v2 + warning", () => {
  const v1raw = JSON.stringify({
    version: 1,
    providers: { bynara: { baseUrl: "https://x/v1", apiKeyEnv: "LLM_API_KEY", pricingUrl: "https://x/pricing" } },
    roles: { analyst: ["bynara:agnes-2.5-flash"] },
    modelPrices: {},
    estimate: {},
  });
  const { settings, warnings } = parseSettings(v1raw, "/x/settings.json");
  assert.equal(settings.version, 2);
  assert.deepEqual(settings.roles.analyst, ["agnes-2.5-flash"]);
  assert.equal(settings.pricingUrl, "https://x/pricing");
  assert.match(warnings.join(" "), /dimigrasikan ke v2/);
});

test("resolveRoleSpecList: dari settings; null bila peran tidak diset", () => {
  const { settings } = parseSettings(GOOD_V2);
  assert.deepEqual(resolveRoleSpecList("analyst", settings), ["agnes-2.5-flash"]);
  assert.deepEqual(resolveRoleSpecList("assessor", settings), ["deepseek-v4.1-flash", "agnes-2.5-flash"]);
  assert.equal(resolveRoleSpecList("debate", settings), null);
});

test("gatewayPricingUrl: dari settings", () => {
  const { settings } = parseSettings(GOOD_V2);
  assert.equal(gatewayPricingUrl(settings), "https://router.bynara.id/api/pricing");
  assert.equal(gatewayPricingUrl(emptySettings()), undefined);
});

test("writeSettings: atomik, JSON rapi 2 spasi, bisa dibaca ulang", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tahansoe-set-"));
  const path = join(dir, "settings.json");
  try {
    const { settings } = parseSettings(GOOD_V2);
    await writeSettings(settings, path);
    const raw = await readFile(path, "utf8");
    assert.match(raw, /\n  "version": 2/, "indent 2 spasi");
    assert.ok(raw.endsWith("\n"), "trailing newline");
    const loaded = await loadSettings(path);
    assert.equal(loaded.exists, true);
    assert.equal(loaded.settings.estimate.runsPerDay, 24);
    const leftovers = await (await import("node:fs/promises")).readdir(dir);
    assert.ok(leftovers.every((f) => !f.includes(".tmp-")), "tidak ada file .tmp- tersisa");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadSettings: file tidak ada → settings kosong valid v2", async () => {
  const { settings, exists } = await loadSettings(join(tmpdir(), "tahansoe-nonexistent-xyz.json"));
  assert.equal(exists, false);
  assert.equal(settings.version, 2);
  assert.deepEqual(settings.roles, {});
});

test("settingsPath: TAHANSOE_SETTINGS override dihormati", () => {
  const p = settingsPath({ TAHANSOE_SETTINGS: join(tmpdir(), "custom-settings.json") });
  assert.match(p, /custom-settings\.json$/);
});

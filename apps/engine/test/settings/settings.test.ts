/**
 * Unit test settings: validasi skema (error jelas untuk file rusak), prioritas
 * settings > env (deprecated) > default, resolusi apiKeyEnv (tanpa mencetak nilai),
 * path override, dan penulisan atomik.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { emptySettings } from "../../src/settings/schema.ts";
import {
  parseSettings,
  resolveProviders,
  resolveRoleSpecList,
  writeSettings,
  loadSettings,
  settingsPath,
} from "../../src/settings/settings.ts";

const GOOD = JSON.stringify({
  version: 1,
  providers: {
    bynara: { baseUrl: "https://router.bynara.id/v1/chat/completions", apiKeyEnv: "LLM_API_KEY", pricingUrl: "https://router.bynara.id/api/pricing" },
    ollama: { baseUrl: "http://localhost:11434/v1", local: true },
  },
  roles: { analyst: ["bynara:agnes-2.5-flash"], assessor: ["bynara:deepseek-v4.1-flash"] },
  modelPrices: { "x": { inputPerM: 0.3, outputPerM: 1.2 } },
  estimate: { runsPerDay: 24 },
});

test("parseSettings: JSON valid → objek settings", () => {
  const s = parseSettings(GOOD);
  assert.equal(s.version, 1);
  assert.equal(s.providers.bynara!.apiKeyEnv, "LLM_API_KEY");
  assert.equal(s.estimate.runsPerDay, 24);
});

test("parseSettings: JSON rusak → error jelas", () => {
  assert.throws(() => parseSettings("{not json", "/x/settings.json"), /bukan JSON valid/);
});

test("parseSettings: versi tak didukung → error jelas", () => {
  assert.throws(() => parseSettings(JSON.stringify({ version: 2 }), "/x"), /versi skema 2 tidak didukung/);
});

test("parseSettings: field salah → error validasi dengan path", () => {
  const bad = JSON.stringify({ version: 1, providers: { p: { apiKeyEnv: "X" } } }); // baseUrl hilang
  assert.throws(() => parseSettings(bad), /tidak valid[\s\S]*baseUrl/);
});

test("parseSettings: API key mentah ditolak (hanya apiKeyEnv diizinkan)", () => {
  // field tak dikenal "apiKey" → strict object menolak.
  const bad = JSON.stringify({ version: 1, providers: { p: { baseUrl: "https://x/v1", apiKey: "secret-123" } } });
  assert.throws(() => parseSettings(bad), /tidak valid/);
});

test("resolveProviders: settings menang; apiKeyEnv diresolusi dari env (tanpa menyimpan nilai)", () => {
  const s = parseSettings(GOOD);
  const { providers } = resolveProviders(s, { LLM_API_KEY: "SECRET" });
  assert.equal(providers.bynara!.baseURL, "https://router.bynara.id/v1", "normalisasi buang /chat/completions");
  assert.equal(providers.bynara!.apiKey, "SECRET", "key diambil dari env via apiKeyEnv");
  assert.equal(providers.bynara!.apiKeyEnv, "LLM_API_KEY");
  assert.equal(providers.bynara!.source, "settings");
  assert.equal(providers.ollama!.local, true);
});

test("resolveProviders: env lama dipakai hanya bila tidak ada di settings (deprecated warning)", () => {
  const s = emptySettings();
  const { providers, warnings } = resolveProviders(s, { LLM_BASE_URL: "https://x/v1", LLM_PROVIDER_NAME: "custom", LLM_API_KEY: "K" });
  assert.equal(providers.custom!.baseURL, "https://x/v1");
  assert.equal(providers.custom!.source, "env");
  assert.match(warnings.join(" "), /deprecated/);
});

test("resolveRoleSpecList: settings > env > null", () => {
  const s = parseSettings(GOOD);
  assert.deepEqual(resolveRoleSpecList("analyst", s, {}).list, ["bynara:agnes-2.5-flash"]);
  // peran tanpa settings & tanpa env → null (pakai default di registry)
  assert.equal(resolveRoleSpecList("debate", s, {}).list, null);
  // env lama (deprecated)
  const env = resolveRoleSpecList("debate", emptySettings(), { LLM_DEBATE: "gemini:a,gemini:b" });
  assert.deepEqual(env.list, ["gemini:a", "gemini:b"]);
  assert.match(env.warnings.join(" "), /deprecated/);
});

test("writeSettings: atomik, JSON rapi 2 spasi, bisa dibaca ulang", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tahansoe-set-"));
  const path = join(dir, "settings.json");
  try {
    const s = parseSettings(GOOD);
    await writeSettings(s, path);
    const raw = await readFile(path, "utf8");
    assert.match(raw, /\n  "version": 1/, "indent 2 spasi");
    assert.ok(raw.endsWith("\n"), "trailing newline");
    const { settings, exists } = await loadSettings(path);
    assert.equal(exists, true);
    assert.equal(settings.estimate.runsPerDay, 24);
    // tidak ada file tmp tersisa
    const leftovers = (await import("node:fs/promises")).readdir(dir);
    assert.ok((await leftovers).every((f) => !f.includes(".tmp-")), "tidak ada file .tmp- tersisa");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadSettings: file tidak ada → settings kosong valid (perilaku lama jalan)", async () => {
  const { settings, exists } = await loadSettings(join(tmpdir(), "tahansoe-nonexistent-xyz.json"));
  assert.equal(exists, false);
  assert.equal(settings.version, 1);
  assert.deepEqual(settings.providers, {});
});

test("settingsPath: TAHANSOE_SETTINGS override dihormati", () => {
  const p = settingsPath({ TAHANSOE_SETTINGS: join(tmpdir(), "custom-settings.json") });
  assert.match(p, /custom-settings\.json$/);
});

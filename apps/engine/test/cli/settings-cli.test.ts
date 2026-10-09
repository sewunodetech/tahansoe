/**
 * Unit test CLI settings & research picker writer (offline, file sementara):
 *  - applyGenericSet (set estimate.runsPerDay 24, nested path, boolean/number)
 *  - formatShow menandai provider yang env key-nya belum ada (tanpa mencetak nilai)
 *  - writeRoleModelsToSettings menulis roles tanpa menyentuh providers/modelPrices
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { applyGenericSet, formatShow } from "../../src/cli/settings.ts";
import { parseSettings } from "../../src/settings/settings.ts";
import { emptySettings } from "../../src/settings/schema.ts";
import { writeRoleModelsToSettings } from "../../src/cli/research.ts";
import { loadSettings } from "../../src/settings/settings.ts";

const BASE = JSON.stringify({
  version: 1,
  providers: {
    bynara: { baseUrl: "https://router.bynara.id/v1", apiKeyEnv: "LLM_API_KEY", pricingUrl: "https://router.bynara.id/api/pricing" },
  },
  roles: { analyst: ["bynara:a"] },
  modelPrices: { keep: { inputPerM: 1, outputPerM: 2 } },
  estimate: { runsPerDay: 12 },
});

test("applyGenericSet: estimate.runsPerDay 24 (number), tanpa menyentuh field lain", () => {
  const s = parseSettings(BASE);
  const next = applyGenericSet(s, "estimate.runsPerDay", "24");
  assert.equal(next.estimate.runsPerDay, 24);
  assert.equal(typeof next.estimate.runsPerDay, "number");
  assert.deepEqual(next.providers, s.providers, "providers tak berubah");
  assert.deepEqual(next.modelPrices, s.modelPrices, "modelPrices tak berubah");
});

test("applyGenericSet: boolean & string terdeteksi", () => {
  const s = emptySettings();
  const a = applyGenericSet(s, "providers.p.local", "true");
  assert.equal((a.providers as Record<string, { local?: boolean }>).p!.local, true);
  const b = applyGenericSet(s, "providers.p.baseUrl", "https://x/v1");
  assert.equal((b.providers as Record<string, { baseUrl?: string }>).p!.baseUrl, "https://x/v1");
});

test("formatShow: tandai provider yang env key-nya belum ada; tidak mencetak nilai key", () => {
  const s = parseSettings(BASE);
  const out = formatShow(s, "/x/settings.json", true, { LLM_API_KEY: "SUPER-SECRET-VALUE" });
  assert.match(out, /bynara \[settings\]/);
  assert.match(out, /key via LLM_API_KEY ✓/);
  assert.doesNotMatch(out, /SUPER-SECRET-VALUE/, "nilai key TIDAK dicetak");
  // tanpa env → tandai tidak tersedia
  const out2 = formatShow(s, "/x/settings.json", true, {});
  assert.match(out2, /key via LLM_API_KEY ✗/);
  assert.match(out2, /TIDAK tersedia/);
});

test("formatShow: roles & pricingUrl tampil", () => {
  const s = parseSettings(BASE);
  const out = formatShow(s, "/x", true, { LLM_API_KEY: "k" });
  assert.match(out, /analyst: bynara:a/);
  assert.match(out, /pricingUrl: https:\/\/router\.bynara\.id\/api\/pricing/);
});

test("writeRoleModelsToSettings: tulis roles tanpa menyentuh providers/modelPrices", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tahansoe-rw-"));
  const path = join(dir, "settings.json");
  try {
    await writeFile(path, BASE, "utf8");
    await writeRoleModelsToSettings(
      {
        analyst: ["bynara:agnes-2.5-flash"],
        debate: ["bynara:agnes-2.5-flash"],
        assessor: ["bynara:deepseek-v4.1-flash"],
        reflector: ["bynara:agnes-2.5-flash"],
      },
      path,
    );
    const { settings } = await loadSettings(path);
    assert.deepEqual(settings.roles.assessor, ["bynara:deepseek-v4.1-flash"]);
    assert.deepEqual(settings.roles.analyst, ["bynara:agnes-2.5-flash"]);
    // providers & modelPrices dipertahankan
    assert.ok(settings.providers.bynara, "provider dipertahankan");
    assert.ok(settings.modelPrices.keep, "modelPrices dipertahankan");
    // tidak ada secret di file
    const raw = await readFile(path, "utf8");
    assert.doesNotMatch(raw, /apiKey"\s*:/, "tidak ada field apiKey mentah");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

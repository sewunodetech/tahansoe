/**
 * Unit test CLI settings v2 & research picker writer (offline, file sementara):
 *  - applyGenericSet (set estimate.runsPerDay 24, nested, boolean/number)
 *  - formatShow menampilkan status gateway + roles TANPA mencetak nilai key
 *  - writeRoleModelsToSettings menulis roles (nama polos) tanpa menyentuh pricingUrl/modelPrices
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { applyGenericSet, formatShow } from "../../src/cli/settings.ts";
import { parseSettings, loadSettings } from "../../src/settings/settings.ts";
import { emptySettings } from "../../src/settings/schema.ts";
import { writeRoleModelsToSettings } from "../../src/cli/research.ts";

const BASE = JSON.stringify({
  version: 2,
  roles: { analyst: ["agnes-2.5-flash"] },
  pricingUrl: "https://router.bynara.id/api/pricing",
  modelPrices: { keep: { inputPerM: 1, outputPerM: 2 } },
  estimate: { runsPerDay: 12 },
});

test("applyGenericSet: estimate.runsPerDay 24 (number), tanpa menyentuh field lain", () => {
  const { settings } = parseSettings(BASE);
  const next = applyGenericSet(settings, "estimate.runsPerDay", "24");
  assert.equal(next.estimate.runsPerDay, 24);
  assert.equal(typeof next.estimate.runsPerDay, "number");
  assert.deepEqual(next.roles, settings.roles, "roles tak berubah");
  assert.deepEqual(next.modelPrices, settings.modelPrices, "modelPrices tak berubah");
});

test("applyGenericSet: boolean & string terdeteksi", () => {
  const s = emptySettings();
  const a = applyGenericSet(s, "estimate.runsPerDay", "6");
  assert.equal(a.estimate.runsPerDay, 6);
  const b = applyGenericSet(s, "pricingUrl", "https://x/pricing");
  assert.equal(b.pricingUrl, "https://x/pricing");
});

test("formatShow: status gateway siap/belum tanpa mencetak nilai key", () => {
  const { settings } = parseSettings(BASE);
  const ready = formatShow(settings, "/x/settings.json", true, { baseURL: "https://router.bynara.id/v1", apiKey: "SUPER-SECRET" });
  assert.match(ready, /gateway: https:\/\/router\.bynara\.id\/v1/);
  assert.match(ready, /LLM_API_KEY ✓/);
  assert.match(ready, /siap/);
  assert.doesNotMatch(ready, /SUPER-SECRET/, "nilai key TIDAK dicetak");

  const notReady = formatShow(settings, "/x", true, { baseURL: "", apiKey: "" });
  assert.match(notReady, /LLM_API_URL belum diisi/);
  assert.match(notReady, /LLM_API_KEY ✗/);
  assert.match(notReady, /BELUM siap/);
});

test("formatShow: roles & pricingUrl tampil", () => {
  const { settings } = parseSettings(BASE);
  const out = formatShow(settings, "/x", true, { baseURL: "https://x/v1", apiKey: "k" });
  assert.match(out, /analyst: agnes-2\.5-flash/);
  assert.match(out, /pricingUrl: https:\/\/router\.bynara\.id\/api\/pricing/);
});

test("writeRoleModelsToSettings: tulis roles (nama polos) tanpa menyentuh pricingUrl/modelPrices", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tahansoe-rw-"));
  const path = join(dir, "settings.json");
  try {
    await writeFile(path, BASE, "utf8");
    await writeRoleModelsToSettings(
      {
        analyst: ["agnes-2.5-flash"],
        debate: ["agnes-2.5-flash"],
        assessor: ["deepseek-v4.1-flash"],
        reflector: ["agnes-2.5-flash"],
      },
      path,
    );
    const { settings } = await loadSettings(path);
    assert.deepEqual(settings.roles.assessor, ["deepseek-v4.1-flash"]);
    assert.deepEqual(settings.roles.analyst, ["agnes-2.5-flash"]);
    assert.equal(settings.pricingUrl, "https://router.bynara.id/api/pricing", "pricingUrl dipertahankan");
    assert.ok(settings.modelPrices.keep, "modelPrices dipertahankan");
    const raw = await readFile(path, "utf8");
    assert.doesNotMatch(raw, /apiKey"\s*:/, "tidak ada field apiKey mentah");
    assert.doesNotMatch(raw, /providers"\s*:/, "tidak ada field providers");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

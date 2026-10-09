/**
 * Unit test i18n Bahasa Indonesia & Inggris (spec m3-cli §3.6).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  idCatalog,
  enCatalog,
  CATALOGS,
  resolveLanguage,
  getLanguage,
  setLanguage,
  t,
  type TranslationKey,
} from "../../src/cli/i18n/index.ts";

test("i18n: kelengkapan katalog id dan en (100% keys terdefinisi dan non-empty)", () => {
  const idKeys = Object.keys(idCatalog) as TranslationKey[];
  const enKeys = Object.keys(enCatalog) as TranslationKey[];

  assert.equal(idKeys.length > 0, true, "idCatalog tidak boleh kosong");
  assert.equal(enKeys.length > 0, true, "enCatalog tidak boleh kosong");

  // Setiap key di id ada di en
  for (const k of idKeys) {
    assert.ok(k in enCatalog, `Key "${k}" ada di idCatalog tapi hilang di enCatalog`);
    assert.ok(typeof idCatalog[k] === "string" && idCatalog[k].length > 0, `Key "${k}" di idCatalog kosong`);
    assert.ok(typeof enCatalog[k] === "string" && enCatalog[k].length > 0, `Key "${k}" di enCatalog kosong`);
  }

  // Setiap key di en ada di id
  for (const k of enKeys) {
    assert.ok(k in idCatalog, `Key "${k}" ada di enCatalog tapi hilang di idCatalog`);
  }
});

test("i18n: prioritas resolusi bahasa (CLI flag > settings > env > system locale > en)", () => {
  // 1. Explicit CLI flag menang dari segalanya
  const r1 = resolveLanguage({
    cliFlag: "en",
    settingsLang: "id",
    envLang: "id",
    systemLocale: "id-ID",
  });
  assert.equal(r1, "en");

  const r1b = resolveLanguage({
    cliFlag: "id",
    settingsLang: "en",
    envLang: "en",
    systemLocale: "en-US",
  });
  assert.equal(r1b, "id");

  // 2. settings.json ui.language menang dari env & system locale
  const r2 = resolveLanguage({
    settingsLang: "id",
    envLang: "en",
    systemLocale: "en-US",
  });
  assert.equal(r2, "id");

  // 3. Env TAHANSOE_LANG menang dari system locale
  const r3 = resolveLanguage({
    envLang: "id",
    systemLocale: "en-US",
  });
  assert.equal(r3, "id");

  // 4. System locale (jika diawali "id" -> "id")
  const r4 = resolveLanguage({
    systemLocale: "id-ID",
  });
  assert.equal(r4, "id");

  // 5. Default "en" bila locale lain
  const r5 = resolveLanguage({
    systemLocale: "fr-FR",
  });
  assert.equal(r5, "en");

  const r6 = resolveLanguage({});
  assert.equal(r6, "en");
});

test("i18n: helper t() dan substitusi parameter {param}", () => {
  setLanguage("id");
  const msgId = t("repl.unknownCommand", { cmd: "testcommand" });
  assert.ok(msgId.includes("/testcommand"));
  assert.ok(msgId.includes("tidak dikenal"));

  setLanguage("en");
  const msgEn = t("repl.unknownCommand", { cmd: "testcommand" });
  assert.ok(msgEn.includes("/testcommand"));
  assert.ok(msgEn.includes("Unknown"));

  // Override bahasa langsung pada pemanggilan t()
  const msgOverride = t("repl.unknownCommand", { cmd: "mycmd" }, "id");
  assert.ok(msgOverride.includes("tidak dikenal"));
});

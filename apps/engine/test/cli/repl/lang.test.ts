/**
 * Unit test REPL /lang, grouped /help, dan welcome screen (spec m3-cli §3.6).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  dispatchSlashCommand,
  getHelpSections,
  renderWelcomeScreen,
  SLASH_COMMANDS,
  slashCompleter,
} from "../../../src/cli/repl/repl.ts";
import { type ReplContext, createDefaultSourceFreshness } from "../../../src/cli/repl/context.ts";
import { createPlainTheme } from "../../../src/cli/ui/theme.ts";
import { renderBanner, renderCompactBanner } from "../../../src/cli/ui/banner.ts";
import { setLanguage, getLanguage } from "../../../src/cli/i18n/index.ts";

const now = new Date("2026-10-09T14:06:00Z");

const dummyContext: ReplContext = {
  chainId: 42161,
  now,
  hasData: true,
  isStale: false,
  sourceFreshness: createDefaultSourceFreshness(now),
  staleSources: [],
  latestReport: null,
  reportsLast24h: [],
  assessments: [
    {
      asset: "ETH",
      regime: "CALM",
      riskScore: 25,
      recommendedTriggerHf: 1.30,
      recommendedTargetHf: 1.60,
      reasons: [],
      explanation: "Calm market conditions",
      validUntil: new Date("2026-10-09T18:00:00Z"),
      createdAt: new Date("2026-10-09T14:00:00Z"),
    },
  ],
  activeSignals: [],
  rateSamples: [],
  carryPairs: [],
  priceSummaries: [],
  macroEvents: [],
};

const emptyContext: ReplContext = {
  chainId: 42161,
  now,
  hasData: false,
  isStale: false,
  sourceFreshness: createDefaultSourceFreshness(now),
  staleSources: [],
  latestReport: null,
  reportsLast24h: [],
  assessments: [],
  activeSignals: [],
  rateSamples: [],
  carryPairs: [],
  priceSummaries: [],
  macroEvents: [],
};

describe("REPL lang, help, and welcome screen", { concurrency: 1 }, () => {
  test("repl /help: terkelompok dalam 5 bagian terstruktur dan hanya berisi perintah nyata", async () => {
    const sectionsId = getHelpSections("id");
    assert.equal(sectionsId.length, 5, "harus ada 5 bagian bantuan");
    assert.ok(sectionsId[0]!.title.includes("Analisis"));
    assert.ok(sectionsId[1]!.title.includes("Risiko"));
    assert.ok(sectionsId[2]!.title.includes("Gateway"));
    assert.ok(sectionsId[3]!.title.includes("Konfigurasi"));
    assert.ok(sectionsId[4]!.title.includes("Sistem"));

    const sectionsEn = getHelpSections("en");
    assert.equal(sectionsEn.length, 5);
    assert.ok(sectionsEn[0]!.title.includes("Analysis"));
    assert.ok(sectionsEn[1]!.title.includes("Risk"));
    assert.ok(sectionsEn[2]!.title.includes("Gateway"));
    assert.ok(sectionsEn[3]!.title.includes("Configuration"));
    assert.ok(sectionsEn[4]!.title.includes("System"));

    // Periksa bahwa command-command inti tersebar di tiap bagian
    const allCmds = sectionsId.flatMap((s) => s.commands.map(([cmd]) => cmd));
    assert.ok(allCmds.includes("/analyze"));
    assert.ok(allCmds.includes("/carry"));
    assert.ok(allCmds.includes("/gateway"));
    assert.ok(allCmds.includes("/lang"));
    assert.ok(allCmds.includes("/doctor"));

    // Tidak boleh ada perintah palsu /health atau /mode
    assert.ok(!allCmds.includes("/health"), "tidak boleh ada /health");
    assert.ok(!allCmds.includes("/mode"), "tidak boleh ada /mode");

    // String terlarang tidak boleh muncul di teks help (ID & EN)
    const forbidden = ["Buffer", "HF", "Active Account", "/health", "/mode "];
    const fullTextId = JSON.stringify(sectionsId);
    const fullTextEn = JSON.stringify(sectionsEn);
    for (const f of forbidden) {
      assert.ok(!fullTextId.includes(f), `Help ID tidak boleh memuat '${f}'`);
      assert.ok(!fullTextEn.includes(f), `Help EN tidak boleh memuat '${f}'`);
    }
  });

  test("repl slash commands & autocomplete: hanya berisi perintah nyata", async () => {
    const cmdNames = SLASH_COMMANDS.map(([c]) => c);
    assert.ok(!cmdNames.includes("/health"), "SLASH_COMMANDS tidak boleh memuat /health");
    assert.ok(!cmdNames.includes("/mode"), "SLASH_COMMANDS tidak boleh memuat /mode");

    const [hitsHealth] = slashCompleter("/hea");
    assert.ok(!hitsHealth.includes("/health"));

    const [hitsMode] = slashCompleter("/mod");
    assert.ok(!hitsMode.includes("/mode"));

    // Deskripsi slash commands tidak boleh memuat HF atau Buffer
    for (const [cmd, desc] of SLASH_COMMANDS) {
      assert.ok(!desc.includes("HF"), `Deskripsi ${cmd} tidak boleh memuat 'HF'`);
      assert.ok(!desc.includes("Buffer"), `Deskripsi ${cmd} tidak boleh memuat 'Buffer'`);
    }
  });

  test("repl /lang: pergantian bahasa in-memory", async () => {
    const originalWrite = process.stdout.write;
    const chunks: string[] = [];
    process.stdout.write = ((chunk: string) => {
      chunks.push(chunk);
      return true;
    }) as unknown as typeof process.stdout.write;

    try {
      // 1. Ganti ke id
      await dispatchSlashCommand("lang", ["id"], dummyContext, { color: false, width: 80 });
      assert.equal(getLanguage(), "id");
      assert.ok(chunks.join("").includes("Bahasa diubah"));

      chunks.length = 0;
      // 2. Ganti ke en
      await dispatchSlashCommand("lang", ["en"], dummyContext, { color: false, width: 80 });
      assert.equal(getLanguage(), "en");
      assert.ok(chunks.join("").includes("Language switched"));

      chunks.length = 0;
      // 3. Argumen tidak valid
      await dispatchSlashCommand("lang", ["es"], dummyContext, { color: false, width: 80 });
      assert.ok(chunks.join("").includes("Invalid language"));

      chunks.length = 0;
      // 4. Tanpa argumen (tampilkan bahasa aktif)
      await dispatchSlashCommand("lang", [], dummyContext, { color: false, width: 80 });
      assert.ok(chunks.join("").includes("Current language"));
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  test("welcome screen: render panel status dengan data nyata dari context (ID & EN pada 100 kolom)", () => {
    const theme100 = createPlainTheme(100);

    const welcomeId = renderWelcomeScreen(theme100, dummyContext, {
      lang: "id",
      modelLabel: "deepseek-chat",
      dbDriver: "pglite",
    });
    assert.ok(welcomeId.includes("Pasar"), "Harus ada label Pasar");
    assert.ok(welcomeId.includes("ETH CALM"), "Harus memuat ETH CALM");
    assert.ok(welcomeId.includes("Sinyal"), "Harus ada label Sinyal");
    assert.ok(welcomeId.includes("Kesegaran Data"), "Harus ada label Kesegaran Data");
    assert.ok(welcomeId.includes("Gateway"), "Harus ada label Gateway");
    assert.ok(welcomeId.includes("Model"), "Harus ada label Model");
    assert.ok(welcomeId.includes("Database"), "Harus ada label Database");
    assert.ok(welcomeId.includes("Perintah yang disarankan"));
    assert.ok(welcomeId.includes("/analyze"));
    assert.ok(welcomeId.includes("/carry"));
    assert.ok(welcomeId.includes("/help"));

    const welcomeEn = renderWelcomeScreen(theme100, dummyContext, {
      lang: "en",
      modelLabel: "deepseek-chat",
      dbDriver: "pglite",
    });
    assert.ok(welcomeEn.includes("Market"), "Harus ada label Market");
    assert.ok(welcomeEn.includes("ETH CALM"), "Harus memuat ETH CALM");
    assert.ok(welcomeEn.includes("Signals"), "Harus ada label Signals");
    assert.ok(welcomeEn.includes("Data Freshness"), "Harus ada label Data Freshness");
    assert.ok(welcomeEn.includes("Gateway"), "Harus ada label Gateway");
    assert.ok(welcomeEn.includes("Model"), "Harus ada label Model");
    assert.ok(welcomeEn.includes("Database"), "Harus ada label Database");
    assert.ok(welcomeEn.includes("Suggested commands"));
    assert.ok(welcomeEn.includes("/analyze"));
    assert.ok(welcomeEn.includes("/carry"));
    assert.ok(welcomeEn.includes("/help"));

    // String terlarang tidak boleh ada di layar sambutan
    const forbidden = ["Buffer", "HF", "Active Account", "/health", "/mode"];
    for (const f of forbidden) {
      assert.ok(!welcomeId.includes(f), `Welcome ID tidak boleh memuat '${f}'`);
      assert.ok(!welcomeEn.includes(f), `Welcome EN tidak boleh memuat '${f}'`);
    }
  });

  test("welcome screen: empty state jujur ketika data belum ada (tanpa angka placeholder)", () => {
    const theme100 = createPlainTheme(100);

    const welcomeId = renderWelcomeScreen(theme100, emptyContext, {
      lang: "id",
      modelLabel: "deepseek-chat",
      dbDriver: "pglite",
    });
    assert.ok(welcomeId.includes("belum ada analisa — jalankan /analyze"));
    assert.ok(welcomeId.includes("belum ada data"));

    const welcomeEn = renderWelcomeScreen(theme100, emptyContext, {
      lang: "en",
      modelLabel: "deepseek-chat",
      dbDriver: "pglite",
    });
    assert.ok(welcomeEn.includes("no analysis yet — run /analyze"));
    assert.ok(welcomeEn.includes("no data available"));

    const forbidden = ["Buffer", "HF", "Active Account", "/health", "/mode", "Mode: dry-run"];
    for (const f of forbidden) {
      assert.ok(!welcomeId.includes(f), `Empty Welcome ID tidak boleh memuat '${f}'`);
      assert.ok(!welcomeEn.includes(f), `Empty Welcome EN tidak boleh memuat '${f}'`);
    }
  });

  test("banner: render compact banner pada 70 kolom", () => {
    const theme70 = createPlainTheme(70);
    const compact = renderBanner(theme70, { force: true });
    assert.ok(compact.includes("▲ TAHANSOE"));
    assert.ok(compact.includes("Arbitrum"));
    assert.ok(!compact.includes("████████"));
  });
});

/**
 * Unit test Visual Identity & UI Components CLI Tahansoe (spec m3-cli §3.6).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createCliTheme,
  createPlainTheme,
  ensureCliTheme,
  supportsTruecolor,
  RGB_COLORS,
  interpolateRgb,
  rgbToAnsi256,
} from "../../src/cli/ui/theme.ts";
import {
  renderBanner,
  renderCompactBanner,
  UNICODE_BANNER_LINES,
  ASCII_BANNER_LINES,
} from "../../src/cli/ui/banner.ts";
import {
  panel,
  sectionHeader,
  statusLine,
  badge,
  renderTable,
  footerTip,
} from "../../src/cli/ui/components.ts";

test("theme: deteksi NO_COLOR dan fallback", () => {
  const plain = createPlainTheme(80);
  assert.equal(plain.color, false);
  assert.equal(plain.trueColor, false);
  assert.equal(plain.brand("TAHANSOE"), "TAHANSOE");

  // NO_COLOR aktif
  const themeNoColor = createCliTheme([], { NO_COLOR: "1" }, { isTTY: true, columns: 90 });
  assert.equal(themeNoColor.color, false);

  // --no-color flag
  const themeFlag = createCliTheme(["--no-color"], {}, { isTTY: true, columns: 90 });
  assert.equal(themeFlag.color, false);

  // TERM=dumb
  const themeDumb = createCliTheme([], { TERM: "dumb" }, { isTTY: true, columns: 90 });
  assert.equal(themeDumb.color, false);
  assert.equal(themeDumb.asciiOnly, true);
});

test("theme: supportsTruecolor deteksi env", () => {
  assert.equal(supportsTruecolor({ COLORTERM: "truecolor" }), true);
  assert.equal(supportsTruecolor({ COLORTERM: "24bit" }), true);
  assert.equal(supportsTruecolor({ WT_SESSION: "1" }), true);
  assert.equal(supportsTruecolor({ TERM_PROGRAM: "vscode" }), true);
  assert.equal(supportsTruecolor({}), false);
});

test("theme: interpolasi warna RGB dan konversi ANSI-256", () => {
  const mid = interpolateRgb(RGB_COLORS.brand, RGB_COLORS.safe, 0.5);
  assert.ok(mid.r >= 0 && mid.r <= 255);
  assert.ok(mid.g >= 0 && mid.g <= 255);
  assert.ok(mid.b >= 0 && mid.b <= 255);

  const ansiIdx = rgbToAnsi256(mid);
  assert.ok(ansiIdx >= 16 && ansiIdx <= 255);
});

test("theme: regime color mapping", () => {
  const theme = createCliTheme([], { COLORTERM: "truecolor" }, { isTTY: true, columns: 80 });
  const calm = theme.regime("CALM", "CALM");
  const elevated = theme.regime("ELEVATED", "ELEVATED");
  const stressed = theme.regime("STRESSED", "STRESSED");
  const crisis = theme.regime("CRISIS", "CRISIS");

  assert.ok(calm.includes("CALM"));
  assert.ok(elevated.includes("ELEVATED"));
  assert.ok(stressed.includes("STRESSED"));
  assert.ok(crisis.includes("CRISIS"));
});

test("banner: blok banner pada terminal lebar >= 80 kolom", () => {
  const theme = createPlainTheme(100);
  const out = renderBanner(theme, { force: true });
  assert.ok(out.includes("████████"));
  assert.ok(out.includes("Arbitrum"));
});

test("banner: varian ringkas satu baris pada terminal sempit < 80 kolom", () => {
  const theme = createPlainTheme(70);
  const out = renderBanner(theme, { force: true });
  assert.ok(out.includes("▲ TAHANSOE"));
  assert.ok(out.includes("Arbitrum"));
  assert.ok(!out.includes("████████"), "tidak boleh mencetak blok pada < 80 kolom");
});

test("banner: suppress output pada --json tanpa force", () => {
  const theme = createPlainTheme(100);
  const out = renderBanner(theme, { isJson: true });
  assert.equal(out, "");
});

test("banner: renderCompactBanner helper eksplisit", () => {
  const theme = createPlainTheme(80);
  const out = renderCompactBanner(theme, "custom tagline");
  assert.ok(out.includes("▲ TAHANSOE"));
  assert.ok(out.includes("custom tagline"));
});

test("components: panel rounded border dan ASCII fallback", () => {
  const theme = createPlainTheme(80);
  const outRounded = panel(theme, ["Line 1", "Line 2"], { title: "Title" });
  assert.ok(outRounded.includes("╭─"));
  assert.ok(outRounded.includes("Title"));
  assert.ok(outRounded.includes("╰─"));

  const asciiTheme = createPlainTheme(80, true);
  const outAscii = panel(asciiTheme, ["Line 1", "Line 2"], { title: "Title" });
  assert.ok(outAscii.includes("+-"));
  assert.ok(outAscii.includes("Title"));
  assert.ok(outAscii.includes("+-"));
});

test("components: sectionHeader, statusLine, badge, table, footerTip", () => {
  const theme = createPlainTheme(80);

  const header = sectionHeader(theme, "Section 1");
  assert.ok(header.includes("Section 1"));
  assert.ok(header.includes("─"));

  const stLine = statusLine(theme, {
    model: "gpt-6-luna",
    gateway: "router.bynara.id",
    dbDriver: "pglite",
    lastRegime: "CALM",
  });
  assert.ok(stLine.includes("gpt-6-luna"));
  assert.ok(stLine.includes("router.bynara.id"));
  assert.ok(stLine.includes("CALM"));

  const b = badge(theme, "OK", "safe");
  assert.ok(b.includes("OK"));

  const tbl = renderTable(
    theme,
    [
      { key: "col1", header: "Col 1", width: 10 },
      { key: "col2", header: "Col 2", width: 10, align: "right" },
    ],
    [{ col1: "val1", col2: "val2" }],
  );
  assert.ok(tbl.includes("Col 1"));
  assert.ok(tbl.includes("val1"));

  const tip = footerTip(theme, "Tip: test tip");
  assert.ok(tip.includes("Tip: test tip"));
});

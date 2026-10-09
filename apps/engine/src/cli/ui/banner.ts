/**
 * ASCII Banner "TAHANSOE" dengan gradien kiri-ke-kanan (#4ab5e0 -> #34d399) (spec m3-cli §3.6).
 *
 *  - Versi blok: ~5 baris, lebar ~68 kolom, gradien truecolor / 256-color.
 *  - Versi ringkas 1 baris otomatis saat lebar terminal < 80 kolom.
 *  - Tagline tersinkronisasi dengan i18n ("non-custodial liquidation-risk agent · Arbitrum").
 *  - Tanpa banner untuk --json dan non-TTY (dapat dipaksa lewat opsi render).
 */

import {
  type CliTheme,
  RGB_COLORS,
  interpolateRgb,
  truecolorFg,
  ansi256Fg,
  rgbToAnsi256,
} from "./theme.ts";
import { t } from "../i18n/index.ts";

export const UNICODE_BANNER_LINES = [
  "████████  █████  ██   ██  █████  ███    ██ ███████  ██████  ███████",
  "   ██    ██   ██ ██   ██ ██   ██ ████   ██ ██      ██    ██ ██     ",
  "   ██    ███████ ███████ ███████ ██ ██  ██ ███████ ██    ██ █████  ",
  "   ██    ██   ██ ██   ██ ██   ██ ██  ██ ██      ██ ██    ██ ██     ",
  "   ██    ██   ██ ██   ██ ██   ██ ██   ████ ███████  ██████  ███████",
];

export const ASCII_BANNER_LINES = [
  " _____ _   _  _   _    _    _   _ ____   ___  _____ ",
  "|_   _/ \\ | | | |/ \\  | \\  | |/ ___| / _ \\| ____|",
  "  | |/ _ \\| |_| / _ \\ |  \\ | |\\___ \\| | | |  _|  ",
  "  | / ___ \\  _ / ___ \\| |\\ \\| |___) | |_| | |___ ",
  "  |/_/   \\_\\_|/_/   \\_\\_| \\___|____/ \\___/|_____|",
];

export interface BannerOptions {
  tagline?: string;
  force?: boolean; // Paksa render walau non-TTY / --json
  isJson?: boolean;
  /** Bahasa tagline; default = bahasa aktif. */
  lang?: "id" | "en";
}

/** Terapkan gradien horizontal brand -> safe pada sebuah baris teks. */
export function applyHorizontalGradient(line: string, theme: CliTheme): string {
  if (!theme.color) return line;
  const len = line.length;
  if (len === 0) return line;

  let out = "";
  for (let i = 0; i < len; i++) {
    const ch = line[i]!;
    if (ch === " ") {
      out += " ";
      continue;
    }
    const t = len > 1 ? i / (len - 1) : 0;
    const rgb = interpolateRgb(RGB_COLORS.brand, RGB_COLORS.safe, t);
    if (theme.trueColor) {
      out += truecolorFg(rgb, ch);
    } else {
      out += ansi256Fg(rgbToAnsi256(rgb), ch);
    }
  }
  return out;
}

/**
 * Render ASCII banner TAHANSOE.
 * Jika terminal < 80 kolom, gunakan varian ringkas satu baris.
 * Jika --json atau non-TTY tanpa flag force, kembalikan string kosong.
 */
export function renderBanner(theme: CliTheme, options: BannerOptions = {}): string {
  if (options.isJson && !options.force) {
    return "";
  }

  const defaultTagline = t("tagline", undefined, options.lang);
  const tagline = options.tagline ?? defaultTagline;

  // Varian ringkas satu baris untuk terminal sempit (< 80 kolom)
  if (theme.width < 80) {
    const title = theme.brand("▲ TAHANSOE");
    const sub = theme.dim(`· ${tagline}`);
    return `${title} ${sub}`;
  }

  // Varian blok penuh
  const rawLines = theme.asciiOnly ? ASCII_BANNER_LINES : UNICODE_BANNER_LINES;
  const coloredBanner = rawLines
    .map((l) => applyHorizontalGradient(l, theme))
    .join("\n");

  const subtitleLine = theme.dim(`   ${tagline}`);
  return `${coloredBanner}\n${subtitleLine}`;
}

/** Varian ringkas eksplisit satu baris. */
export function renderCompactBanner(theme: CliTheme, tagline?: string): string {
  const text = tagline ?? t("tagline");
  const title = theme.brand("▲ TAHANSOE");
  const sub = theme.dim(`· ${text}`);
  return `${title} ${sub}`;
}

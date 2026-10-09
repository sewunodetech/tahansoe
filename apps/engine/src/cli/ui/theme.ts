/**
 * Theme & Truecolor visual identity module (spec m3-cli §3.6, DESIGN.md).
 *
 * Token warna:
 *  - brand: #4ab5e0
 *  - safe: #34d399 (CALM)
 *  - warning: #fbbf24 (ELEVATED)
 *  - danger: #f87171 (STRESSED / CRISIS)
 *  - textSecondary: #c8bca9
 *  - border: #26332f
 *  - textPrimary: #fdf1e1
 *
 * Truecolor bila COLORTERM=truecolor/24bit atau WT_SESSION, fallback 256/16 warna,
 * polos bila NO_COLOR / --no-color / non-TTY.
 */

import pc from "picocolors";

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export const HEX_COLORS = {
  brand: "#4ab5e0",
  safe: "#34d399",
  warning: "#fbbf24",
  danger: "#f87171",
  textPrimary: "#fdf1e1",
  textSecondary: "#c8bca9",
  border: "#26332f",
  surface: "#15201d",
  background: "#0b1110",
} as const;

export const RGB_COLORS: Record<keyof typeof HEX_COLORS, RgbColor> = {
  brand: { r: 74, g: 181, b: 224 },
  safe: { r: 52, g: 211, b: 153 },
  warning: { r: 251, g: 191, b: 36 },
  danger: { r: 248, g: 113, b: 113 },
  textPrimary: { r: 253, g: 241, b: 225 },
  textSecondary: { r: 200, g: 188, b: 169 },
  border: { r: 38, g: 51, b: 47 },
  surface: { r: 21, g: 32, b: 29 },
  background: { r: 11, g: 17, b: 16 },
};

/** Interpolasi linear antara dua warna RGB. */
export function interpolateRgb(from: RgbColor, to: RgbColor, factor: number): RgbColor {
  const t = Math.max(0, Math.min(1, factor));
  return {
    r: Math.round(from.r + (to.r - from.r) * t),
    g: Math.round(from.g + (to.g - from.g) * t),
    b: Math.round(from.b + (to.b - from.b) * t),
  };
}

/** Konversi RGB ke truecolor foreground escape sequence. */
export function truecolorFg(rgb: RgbColor, text: string): string {
  return `\x1b[38;2;${rgb.r};${rgb.g};${rgb.b}m${text}\x1b[39m`;
}

/** Konversi RGB ke truecolor background escape sequence. */
export function truecolorBg(rgb: RgbColor, text: string): string {
  return `\x1b[48;2;${rgb.r};${rgb.g};${rgb.b}m${text}\x1b[49m`;
}

/** Konversi RGB ke 256-color palette index terdekat (16..231 cube atau 232..255 grayscale). */
export function rgbToAnsi256(rgb: RgbColor): number {
  const r6 = Math.min(5, Math.floor((rgb.r / 256) * 6));
  const g6 = Math.min(5, Math.floor((rgb.g / 256) * 6));
  const b6 = Math.min(5, Math.floor((rgb.b / 256) * 6));
  return 16 + 36 * r6 + 6 * g6 + b6;
}

export function ansi256Fg(index: number, text: string): string {
  return `\x1b[38;5;${index}m${text}\x1b[39m`;
}

export interface CliTheme {
  color: boolean;
  trueColor: boolean;
  asciiOnly: boolean;
  width: number;
  brand: (s: string) => string;
  safe: (s: string) => string;
  warning: (s: string) => string;
  danger: (s: string) => string;
  textSecondary: (s: string) => string;
  textPrimary: (s: string) => string;
  border: (s: string) => string;
  dim: (s: string) => string;
  bold: (s: string) => string;
  regime: (regime: string, s: string) => string;
}

/**
 * Cek apakah terminal mendukung truecolor (24-bit).
 */
export function supportsTruecolor(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.COLORTERM === "truecolor" || env.COLORTERM === "24bit") return true;
  if (Boolean(env.WT_SESSION)) return true; // Windows Terminal
  if (env.TERM_PROGRAM === "vscode" || env.TERM_PROGRAM === "iTerm.app") return true;
  return false;
}

/**
 * Deteksi tema CLI lengkap dari argv, env, dan stream stdout/stderr.
 */
export function createCliTheme(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  stream: { isTTY?: boolean; columns?: number } = process.stdout,
): CliTheme {
  const noColor =
    env.NO_COLOR !== undefined ||
    argv.includes("--no-color") ||
    env.TERM === "dumb" ||
    !stream.isTTY;

  const color = !noColor;
  const trueColor = color && supportsTruecolor(env);
  const asciiOnly = env.TERM === "dumb" || argv.includes("--ascii");
  const width = Math.max(60, stream.columns ?? 80);

  const colorize = (rgb: RgbColor, fallback16: (s: string) => string) => {
    if (!color) return (s: string) => s;
    if (trueColor) return (s: string) => truecolorFg(rgb, s);
    return fallback16;
  };

  const brandFn = colorize(RGB_COLORS.brand, pc.cyan);
  const safeFn = colorize(RGB_COLORS.safe, pc.green);
  const warningFn = colorize(RGB_COLORS.warning, pc.yellow);
  const dangerFn = colorize(RGB_COLORS.danger, pc.red);
  const textSecFn = colorize(RGB_COLORS.textSecondary, pc.dim);
  const textPriFn = colorize(RGB_COLORS.textPrimary, (s) => s);
  const borderFn = colorize(RGB_COLORS.border, pc.dim);

  const regimeFn = (regime: string, s: string) => {
    if (!color) return s;
    switch (regime.toUpperCase()) {
      case "CALM":
        return safeFn(s);
      case "ELEVATED":
        return warningFn(s);
      case "STRESSED":
      case "CRISIS":
        return dangerFn(s);
      default:
        return brandFn(s);
    }
  };

  return {
    color,
    trueColor,
    asciiOnly,
    width,
    brand: brandFn,
    safe: safeFn,
    warning: warningFn,
    danger: dangerFn,
    textSecondary: textSecFn,
    textPrimary: textPriFn,
    border: borderFn,
    dim: color ? pc.dim : (s) => s,
    bold: color ? pc.bold : (s) => s,
    regime: regimeFn,
  };
}

export const detectCliTheme = createCliTheme;

/** Buat tema polos tanpa warna untuk test atau output plain text. */
export function createPlainTheme(width = 80, asciiOnly = false): CliTheme {
  const plain = (s: string) => s;
  return {
    color: false,
    trueColor: false,
    asciiOnly,
    width,
    brand: plain,
    safe: plain,
    warning: plain,
    danger: plain,
    textSecondary: plain,
    textPrimary: plain,
    border: plain,
    dim: plain,
    bold: plain,
    regime: (_regime: string, s: string) => s,
  };
}

/** Pastikan objek CliTheme; jika hanya objek Theme lama { color, width }, bungkus jadi CliTheme. */
export function ensureCliTheme(
  theme?: CliTheme | { color?: boolean; width?: number; asciiOnly?: boolean },
): CliTheme {
  if (!theme) return detectCliTheme();
  if ("brand" in theme && typeof (theme as any).brand === "function") {
    return theme as CliTheme;
  }
  if (!theme.color) {
    return createPlainTheme(theme.width ?? 80, Boolean((theme as any).asciiOnly));
  }
  return createCliTheme(
    [],
    process.env,
    { isTTY: true, columns: theme.width ?? 80 },
  );
}


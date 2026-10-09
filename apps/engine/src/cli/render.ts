/**
 * Renderer terminal INTERNAL untuk CLI `tahansoe` (spec m3-cli §3.2–§3.4, §4).
 *
 * CATATAN: kit renderer bersama ada di `src/cli/ui/` (dibangun paralel oleh
 * Antigravity). Modul ini adalah renderer mandiri plain-first agar command bisa
 * jalan & dites sekarang tanpa bergantung pada ui/ yang belum ada; bisa diganti
 * ke ui/ saat tersedia. Semua fungsi murni `… → string` (kecuali Progress yang
 * menulis ke stream).
 *
 * KEAMANAN (§4): teks eksternal (judul berita, dsb.) WAJIB lewat sanitizeExternal
 * (buang ANSI/escape) sebelum dicetak. Host URL disamarkan (maskHost). Tidak
 * pernah mencetak secret. Setiap kartu laporan diakhiri "not a trading signal".
 */

import pc from "picocolors";
import type { Regime } from "@tahansoe/domain";

export const NOT_A_TRADING_SIGNAL = "not a trading signal";

/** Opsi tema: warna & lebar. */
export interface Theme {
  color: boolean;
  width: number;
}

/** Deteksi tema dari env + stream (NO_COLOR, --no-color, non-TTY). */
export function detectTheme(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  stream: { isTTY?: boolean; columns?: number } = process.stdout,
): Theme {
  const noColor =
    env.NO_COLOR !== undefined ||
    argv.includes("--no-color") ||
    env.TERM === "dumb" ||
    !stream.isTTY;
  const width = Math.max(60, stream.columns ?? 80);
  return { color: !noColor, width };
}

/** Terapkan warna hanya bila theme.color aktif. */
function paint(theme: Theme, fn: (s: string) => string, s: string): string {
  return theme.color ? fn(s) : s;
}

export function dim(theme: Theme, s: string): string {
  return paint(theme, pc.dim, s);
}
export function bold(theme: Theme, s: string): string {
  return paint(theme, pc.bold, s);
}

/** Warna per regime (CALM hijau, ELEVATED kuning, STRESSED magenta, CRISIS merah). */
export function regimeColor(theme: Theme, regime: string, s: string): string {
  if (!theme.color) return s;
  switch (regime) {
    case "CALM":
      return pc.green(s);
    case "ELEVATED":
      return pc.yellow(s);
    case "STRESSED":
      return pc.magenta(s);
    case "CRISIS":
      return pc.red(s);
    default:
      return s;
  }
}

// ---------------------------------------------------------------------------
// Keamanan: sanitasi teks eksternal & penyamaran host.
// ---------------------------------------------------------------------------

// eslint-disable-next-line no-control-regex
const ANSI_OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g; // OSC … BEL/ST
// eslint-disable-next-line no-control-regex
const ANSI_CSI = /\x1b[@-_][0-?]*[ -/]*[@-~]/g; // CSI/escape sequences
// eslint-disable-next-line no-control-regex
const CTRL = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g; // C0/C1 kecuali \n \t (ditangani terpisah)

/**
 * Buang escape ANSI/OSC + karakter kontrol dari teks eksternal, ubah newline jadi
 * spasi, rapatkan whitespace, lalu potong ke maxLen (dengan "…"). Mencegah injeksi
 * escape sequence ke terminal (§4, I8).
 */
export function sanitizeExternal(text: unknown, maxLen = 200): string {
  let s = String(text ?? "");
  s = s.replace(ANSI_OSC, "").replace(ANSI_CSI, "");
  s = s.replace(/[\r\n\t]+/g, " ");
  s = s.replace(CTRL, "");
  s = s.replace(/\s{2,}/g, " ").trim();
  if (s.length > maxLen) s = s.slice(0, Math.max(0, maxLen - 1)).trimEnd() + "…";
  return s;
}

/** Ambil HOST saja dari URL (tanpa path/query/userinfo/key). Invalid → "(invalid url)". */
export function maskHost(url: unknown): string {
  const raw = String(url ?? "").trim();
  if (!raw) return "(invalid url)";
  try {
    const u = new URL(raw);
    return u.host || "(invalid url)";
  } catch {
    // Coba tambahkan skema bila user menulis host polos.
    try {
      const u = new URL(`https://${raw}`);
      // Hanya terima bila terlihat seperti host (ada titik atau localhost).
      if (u.host && (u.host.includes(".") || u.host.startsWith("localhost"))) return u.host;
    } catch {
      /* jatuh ke invalid */
    }
    return "(invalid url)";
  }
}

// ---------------------------------------------------------------------------
// Format angka/waktu.
// ---------------------------------------------------------------------------

export function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0.0s";
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

export function fmtTokens(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (n < 1000) return String(Math.round(n));
  return `${(n / 1000).toFixed(1)}k`;
}

export function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return "$0";
  return `$${n.toFixed(n < 1 ? 4 : 2)}`;
}

export function fmtIdr(n: number): string {
  if (!Number.isFinite(n)) return "Rp 0";
  return `Rp ${Math.round(n).toLocaleString("id-ID")}`;
}

export function fmtCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Waktu UTC "HH:MM". */
export function fmtTime(date: Date): string {
  return date.toISOString().slice(11, 16);
}

// ---------------------------------------------------------------------------
// Primitif visual (ASCII-safe, lebar-sadar sederhana).
// ---------------------------------------------------------------------------

/** Lebar tampak (abaikan ANSI). Perkiraan sederhana (1 kolom/char). */
export function visibleWidth(s: string): number {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

export function padEndW(s: string, width: number): string {
  const w = visibleWidth(s);
  return w >= width ? s : s + " ".repeat(width - w);
}

export function truncateW(s: string, width: number): string {
  if (visibleWidth(s) <= width) return s;
  if (width <= 1) return "…".slice(0, width);
  return s.slice(0, width - 1) + "…";
}

/** Bar 0..1 memakai █/░ (atau #/. tanpa warna penting? tetap unicode). */
export function bar(value: number, width = 10): string {
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const filled = Math.round(v * width);
  return "█".repeat(filled) + "░".repeat(Math.max(0, width - filled));
}

/** "██████░░░░ 0.55 (cap 0.60)". */
export function confidenceBar(conf: number, cap: number): string {
  return `${bar(conf, 10)} ${conf.toFixed(2)} (cap ${cap.toFixed(2)})`;
}

const SPARK = ["▁", "▃", "▅", "█"] as const;
const REGIME_LEVEL: Record<string, number> = { CALM: 0, ELEVATED: 1, STRESSED: 2, CRISIS: 3 };

/** Sparkline dari daftar regime (dari lama → baru). */
export function sparkline(theme: Theme, regimes: string[]): string {
  return regimes
    .map((r) => {
      const ch = SPARK[REGIME_LEVEL[r] ?? 0]!;
      return regimeColor(theme, r, ch);
    })
    .join("");
}

/** Kotak dengan judul inline di border atas (╭─ title ─╮). */
export function box(theme: Theme, title: string, lines: string[], width = 66): string {
  const inner = Math.max(20, width - 4);
  const titleW = visibleWidth(title);
  const fill = Math.max(0, inner - titleW - 2);
  const top = `╭─ ${title} ` + "─".repeat(fill) + "─╮";
  const body = lines.map((l) => `│ ${padEndW(truncateW(l, inner), inner)} │`);
  const bottom = "╰" + "─".repeat(inner + 2) + "╯";
  return [top, ...body, bottom].join("\n");
}

/** Tabel teks sederhana (header dim). */
export interface TableColumn {
  key: string;
  header: string;
  align?: "left" | "right";
  width?: number;
}
export function table(theme: Theme, columns: TableColumn[], rows: Record<string, string>[]): string {
  const widths = columns.map((c) =>
    Math.max(c.width ?? 0, visibleWidth(c.header), ...rows.map((r) => visibleWidth(r[c.key] ?? ""))),
  );
  const fmtRow = (cells: string[]): string =>
    cells
      .map((cell, i) => {
        const w = widths[i]!;
        const align = columns[i]!.align ?? "left";
        return align === "right" ? cell.padStart(w) : padEndW(cell, w);
      })
      .join("  ");
  const header = dim(theme, fmtRow(columns.map((c) => c.header)));
  const body = rows.map((r) => fmtRow(columns.map((c) => r[c.key] ?? "")));
  return [header, ...body].join("\n");
}

/** Banner satu baris + garis. */
export function banner(theme: Theme, subtitle: string): string {
  const title = ` ▲ TAHANSOE  ${subtitle}`;
  const rule = " " + "─".repeat(Math.min(theme.width - 1, Math.max(40, visibleWidth(title))));
  return `${bold(theme, title)}\n${dim(theme, rule)}`;
}

// ---------------------------------------------------------------------------
// Kartu laporan.
// ---------------------------------------------------------------------------

export interface ReportCardData {
  createdAt: Date;
  regime: string;
  direction: string;
  confidence: number;
  confidenceCap: number;
  horizonHours?: number;
  paths: { code: string; label: string; severity: number }[];
  evidence: { text: string; source: string }[];
  suggestion?: string;
  reportId?: string;
  tokens?: number;
  costIdr?: number;
  costUsd?: number;
  durationMs?: number;
}

function arrow(direction: string): string {
  const d = direction.toUpperCase();
  if (d === "DOWN") return "▼ DOWN";
  if (d === "UP") return "▲ UP";
  if (d === "VOLATILITY") return "↕ VOLATILITY";
  return `→ ${sanitizeExternal(direction, 20)}`;
}

/** Render kartu laporan (box) + footer "not a trading signal". */
export function renderReportCard(theme: Theme, data: ReportCardData): string {
  const lines: string[] = [];
  const regimeTxt = regimeColor(theme, data.regime, `● ${data.regime}`);
  lines.push(`Regime     ${padEndW(regimeTxt, 18)} Direction  ${arrow(data.direction)}`);
  lines.push(
    `Confidence ${confidenceBar(data.confidence, data.confidenceCap)}   Horizon ${data.horizonHours ?? "?"}h`,
  );
  lines.push("");
  lines.push("Top paths");
  if (data.paths.length === 0) lines.push("  (none)");
  for (const p of [...data.paths].sort((a, b) => b.severity - a.severity).slice(0, 4)) {
    lines.push(`  ${p.code} ${padEndW(sanitizeExternal(p.label, 24), 24)} ${bar(p.severity, 9)} sev ${p.severity.toFixed(2)}`);
  }
  lines.push("");
  lines.push("Key evidence");
  if (data.evidence.length === 0) lines.push("  (none)");
  for (const e of data.evidence.slice(0, 4)) {
    lines.push(`  • ${sanitizeExternal(e.text, 46)} — ${sanitizeExternal(e.source, 20)}`);
  }
  if (data.suggestion) {
    lines.push("");
    lines.push(sanitizeExternal(data.suggestion, 60));
  }

  const ts = `${data.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC`;
  const card = box(theme, `RISK REPORT · ${ts}`, lines, Math.min(theme.width, 70));

  // Footer: wajib "not a trading signal". Tanpa bahasa buy/sell.
  const parts: string[] = [];
  if (data.reportId) parts.push(`saved #${data.reportId.slice(0, 6)}…`);
  if (data.tokens !== undefined) parts.push(`${fmtTokens(data.tokens)} tok`);
  if (data.costIdr !== undefined) parts.push(fmtIdr(data.costIdr));
  else if (data.costUsd !== undefined) parts.push(fmtUsd(data.costUsd));
  if (data.durationMs !== undefined) parts.push(fmtDuration(data.durationMs));
  parts.push(NOT_A_TRADING_SIGNAL);
  const footer = dim(theme, " " + parts.join(" · "));
  return `${card}\n${footer}`;
}


// ---------------------------------------------------------------------------
// Progress (tahap pipeline). TTY: baris status; non-TTY: satu baris plain/tahap.
// ---------------------------------------------------------------------------

/** Stream minimal yang dibutuhkan progress (memudahkan test dgn fake stream). */
export interface WritableLike {
  isTTY?: boolean;
  columns?: number;
  write(chunk: string): void;
}

export interface Progress {
  start(id: string, label: string): void;
  done(id: string, detail: string, ms: number): void;
  fail(id: string, msg: string): void;
  stop(): void;
}

/**
 * Progress sederhana. Non-TTY (default aman untuk test & pipe): mencetak satu
 * baris per `done`/`fail` tanpa ANSI. TTY: menulis baris status per start/done.
 * Deterministik & tanpa timer agar mudah dites.
 */
export function createProgress(theme: Theme, stream: WritableLike = process.stderr): Progress {
  const tty = Boolean(stream.isTTY) && theme.color;
  return {
    start(id, label) {
      if (tty) stream.write(`  … ${label} (${id})\n`);
    },
    done(id, detail, ms) {
      const mark = theme.color ? pc.green("✔") : "✔";
      const extra = detail ? ` ${sanitizeExternal(detail, 40)}` : "";
      stream.write(`  ${mark} ${padEndW(id, 10)}${extra}  ${fmtDuration(ms)}\n`);
    },
    fail(id, msg) {
      const mark = theme.color ? pc.red("✖") : "✖";
      stream.write(`  ${mark} ${padEndW(id, 10)} ${sanitizeExternal(msg, 80)}\n`);
    },
    stop() {
      /* no timers to clear in plain mode */
    },
  };
}

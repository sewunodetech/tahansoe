/**
 * UI Components kit untuk CLI & REPL Tahansoe (spec m3-cli §3.6).
 *
 *  - Panel / Card dengan border bulat (╭─...─╮ / ╰─...─╯) & fallback ASCII (+-...-+)
 *  - Section header
 *  - Key-value status line (model · gateway · DB driver · last regime)
 *  - Badge (regime, status, alert)
 *  - Table formatting
 *  - Spinner frames
 *  - Footer tip
 */

import { type CliTheme } from "./theme.ts";
import { visibleWidth, padEndW, truncateW } from "../render.ts";

export interface PanelOptions {
  title?: string;
  width?: number;
  dimBorder?: boolean;
}

/** Render panel / kartu berborder bulat (atau ASCII bila asciiOnly). */
export function panel(theme: CliTheme, lines: string[], options: PanelOptions = {}): string {
  const width = Math.min(theme.width, options.width ?? theme.width);
  const inner = Math.max(20, width - 4);
  const isAscii = theme.asciiOnly;

  const tl = isAscii ? "+" : "╭";
  const tr = isAscii ? "+" : "╮";
  const bl = isAscii ? "+" : "╰";
  const br = isAscii ? "+" : "╯";
  const h = isAscii ? "-" : "─";
  const v = isAscii ? "|" : "│";

  let topBorder = "";
  if (options.title) {
    const rawTitle = ` ${options.title} `;
    const titleW = visibleWidth(rawTitle);
    const fill = Math.max(0, inner - titleW + 1);
    topBorder = `${tl}${h}${theme.bold(rawTitle)}${h.repeat(fill)}${tr}`;
  } else {
    topBorder = `${tl}${h.repeat(inner + 2)}${tr}`;
  }

  const coloredTop = options.dimBorder !== false ? theme.border(topBorder) : topBorder;
  const coloredBottom = options.dimBorder !== false ? theme.border(`${bl}${h.repeat(inner + 2)}${br}`) : `${bl}${h.repeat(inner + 2)}${br}`;
  const vBorder = options.dimBorder !== false ? theme.border(v) : v;

  const body = lines.map((l) => `${vBorder} ${padEndW(truncateW(l, inner), inner)} ${vBorder}`);
  return [coloredTop, ...body, coloredBottom].join("\n");
}

/** Header bagian dengan garis pemisah tipis. */
export function sectionHeader(theme: CliTheme, title: string): string {
  const t = theme.brand(theme.bold(title));
  const lineLen = Math.max(20, Math.min(theme.width - visibleWidth(title) - 4, 40));
  const rule = theme.border("─".repeat(lineLen));
  return `${t} ${rule}`;
}

export interface StatusLineData {
  model?: string;
  gateway?: string;
  dbDriver?: string;
  lastRegime?: string;
}

/** Baris status ringkas: model · gateway · DB driver · last regime. */
export function statusLine(theme: CliTheme, data: StatusLineData): string {
  const parts: string[] = [];

  if (data.model) {
    parts.push(`model: ${theme.brand(data.model)}`);
  }
  if (data.gateway) {
    parts.push(`gateway: ${theme.textSecondary(data.gateway)}`);
  }
  if (data.dbDriver) {
    parts.push(`db: ${theme.textSecondary(data.dbDriver)}`);
  }
  if (data.lastRegime) {
    const coloredRegime = theme.regime(data.lastRegime, `● ${data.lastRegime}`);
    parts.push(`regime: ${coloredRegime}`);
  }

  return parts.join(theme.border("  ·  "));
}

export type BadgeVariant = "safe" | "warning" | "danger" | "brand" | "dim";

/** Badge teks warna per status/regime. */
export function badge(theme: CliTheme, text: string, variant: BadgeVariant = "brand"): string {
  const bullet = theme.asciiOnly ? "*" : "●";
  const label = `${bullet} ${text}`;
  switch (variant) {
    case "safe":
      return theme.safe(label);
    case "warning":
      return theme.warning(label);
    case "danger":
      return theme.danger(label);
    case "dim":
      return theme.dim(label);
    case "brand":
    default:
      return theme.brand(label);
  }
}

export interface UiTableColumn {
  key: string;
  header: string;
  align?: "left" | "right";
  width?: number;
}

/** Tabel data terformat rapi. */
export function renderTable(
  theme: CliTheme,
  columns: UiTableColumn[],
  rows: Record<string, string>[],
): string {
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

  const header = theme.textSecondary(theme.bold(fmtRow(columns.map((c) => c.header))));
  const rule = theme.border(
    columns
      .map((_, i) => "─".repeat(widths[i]!))
      .join("  "),
  );
  const body = rows.map((r) => fmtRow(columns.map((c) => r[c.key] ?? "")));
  return [header, rule, ...body].join("\n");
}

export const SPINNER_UNICODE = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
export const SPINNER_ASCII = ["-", "\\", "|", "/"];

/** Dapatkan frame spinner sesuai dukungan ASCII terminal. */
export function getSpinnerFrames(theme: CliTheme): string[] {
  return theme.asciiOnly ? SPINNER_ASCII : SPINNER_UNICODE;
}

/** Footer tip bernada tenang. */
export function footerTip(theme: CliTheme, text: string): string {
  const prefix = theme.asciiOnly ? ">" : "💡";
  return theme.dim(`${prefix} ${text}`);
}

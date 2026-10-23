/**
 * Tampilan pesan Telegram (HTML) outbound — ringkas, informatif, dan aman.
 *
 * Aturan format (PRD §11, security.md I2, I5):
 *  - parse_mode HTML; hanya <b>, <i>, <code>.
 *  - Semua teks dinamis lewat escapeHtml.
 *  - Footer wajib: "informational · not investment advice" / "Informasi risiko · bukan saran investasi".
 *  - TANPA saran beli/jual, prediksi harga, atau janji anti-likuidasi.
 */

import type { Signal, RiskAssessment } from "@tahansoe/domain";
import { escapeHtml } from "./formatter.ts";
export { escapeHtml };

export type Lang = "id" | "en";

export function chatLang(settings?: { ui?: { language?: string } }): Lang {
  return settings?.ui?.language === "id" ? "id" : "en";
}

const L = (lang: Lang, id: string, en: string): string => (lang === "id" ? id : en);

export function footer(lang: Lang = "id"): string {
  return `<i>${L(lang, "Informasi risiko · bukan saran investasi", "informational · not investment advice")}</i>`;
}

function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

const REGIME_EMOJI: Record<string, string> = {
  CALM: "🟢",
  ELEVATED: "🟡",
  STRESSED: "🟠",
  CRISIS: "🔴",
};

export function regimeBadge(regime: string): string {
  return `${REGIME_EMOJI[regime] ?? "⚪"} <b>${escapeHtml(regime)}</b>`;
}

export function regimeMeaning(regime: string, lang: Lang = "id"): string {
  switch (regime) {
    case "CALM":
      return L(lang, "kondisi normal, tidak ada tekanan berarti", "normal conditions, no meaningful pressure");
    case "ELEVATED":
      return L(lang, "ada tekanan, layak dipantau lebih sering", "some pressure, worth watching more often");
    case "STRESSED":
      return L(lang, "tekanan nyata, buffer HF sebaiknya lebih tebal", "real pressure, a thicker HF buffer is prudent");
    case "CRISIS":
      return L(lang, "kondisi ekstrem, risiko likuidasi tinggi", "extreme conditions, high liquidation risk");
    default:
      return L(lang, "belum ada penilaian", "not assessed yet");
  }
}

function assetRegimeLine(asset: string, regime: string, lang: Lang): string {
  return `${REGIME_EMOJI[regime] ?? "⚪"} <b>${escapeHtml(asset)}</b> · <b>${escapeHtml(regime)}</b> — ${regimeMeaning(regime, lang)}`;
}

const PATH_LABEL: Record<string, [string, string]> = {
  T1: ["harga collateral turun", "collateral price drop"],
  T2: ["volatilitas naik", "volatility rising"],
  T3: ["likuidasi berantai", "leverage cascade"],
  T4: ["stablecoin lepas dari $1", "stablecoin depeg"],
  T5: ["LST di bawah harga ETH", "LST depeg"],
  T6: ["jaringan padat / gas mahal", "gas / congestion"],
  T7: ["likuiditas pool menipis", "reserve liquidity drying up"],
  T8: ["oracle tertinggal / menyimpang", "oracle lag / deviation"],
  T9: ["insiden protokol / exploit", "protocol incident / exploit"],
  T10: ["sequencer Arbitrum berhenti", "Arbitrum sequencer down"],
  T11: ["bunga pinjaman & carry", "borrow rate & carry"],
};

export function pathLabel(path: string, lang: Lang = "id"): string {
  const p = PATH_LABEL[path];
  return p ? (lang === "id" ? p[0] : p[1]) : path;
}

export function severityWord(sev: number, lang: Lang = "id"): string {
  if (sev >= 0.7) return L(lang, "tinggi", "high");
  if (sev >= 0.4) return L(lang, "sedang", "medium");
  return L(lang, "rendah", "low");
}

function pct(x: number, digits = 1): string {
  return `${(x * 100).toFixed(digits)}%`;
}

function fmtUtc(d: Date): string {
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export function signalLine(s: Signal, lang: Lang = "id"): string {
  const path = s.paths?.[0];
  const what = path ? pathLabel(path, lang) : s.module.toLowerCase();
  const assets = s.assets.length ? ` (${escapeHtml(s.assets.join(", "))})` : "";
  const title = s.evidence?.find((e) => e?.title)?.title;
  const detail = title ? ` — ${escapeHtml(clip(title, 90))}` : "";
  return `• ${escapeHtml(what)}${assets}: ${severityWord(s.severity, lang)}${detail}`;
}

// ---------------------------------------------------------------------------
// Ringkasan Harian / Digest
// ---------------------------------------------------------------------------

export interface FetchedReportLike {
  createdAt: Date;
  report: {
    proposedRegime: string;
    confidence: number;
    horizonHours: number;
    assets: string[];
    paths: { path: string; severity: number; rationale: string }[];
    keyDevelopments: { summary: string }[];
    hawkCase: string;
    doveCase: string;
  };
}

export function dailySummaryView(
  day: string,
  assessments: RiskAssessment[],
  signals: Signal[],
  lang: Lang = "id",
): string {
  const lines: string[] = [
    `📅 <b>${L(lang, "Ringkasan risiko harian", "Daily risk summary")}</b> · ${escapeHtml(day)}`,
    "",
  ];
  if (assessments.length === 0) {
    lines.push(L(lang, "Belum ada penilaian aset.", "No asset assessments yet."));
  } else {
    for (const a of assessments) {
      lines.push(assetRegimeLine(a.asset, a.regime, lang));
    }
  }
  lines.push("");
  if (signals.length === 0) {
    lines.push(`✅ ${L(lang, "Tidak ada sinyal risiko aktif.", "No active risk signals.")}`);
  } else {
    lines.push(`<b>${L(lang, `Sinyal aktif (${signals.length})`, `Active signals (${signals.length})`)}</b>`);
    for (const s of [...signals].sort((a, b) => b.severity - a.severity).slice(0, 3)) {
      lines.push(signalLine(s, lang));
    }
  }
  lines.push("");
  lines.push(footer(lang));
  return lines.join("\n");
}

export function reportView(
  f: FetchedReportLike,
  lang: Lang = "id",
  now: Date = new Date(),
): string {
  const r = f.report;
  const lines: string[] = [
    `🧠 <b>${L(lang, "Riset AI", "AI research")}</b> · ${escapeHtml(fmtUtc(f.createdAt))}`,
    "",
  ];
  lines.push(`${regimeBadge(r.proposedRegime)} — ${regimeMeaning(r.proposedRegime, lang)}`);
  lines.push(
    `${L(lang, "Keyakinan", "Confidence")} ${pct(Math.min(r.confidence, 1), 0)} · ${L(lang, "horizon", "horizon")} ${r.horizonHours} ${L(lang, "jam", "h")} · ${L(lang, "aset", "assets")} ${escapeHtml(r.assets.join(", "))}`,
  );

  const paths = [...(r.paths ?? [])].sort((a, b) => b.severity - a.severity).slice(0, 4);
  if (paths.length > 0) {
    lines.push("");
    lines.push(`<b>${L(lang, "Jalur risiko utama", "Main risk paths")}</b>`);
    for (const p of paths) {
      lines.push(`• ${escapeHtml(pathLabel(p.path, lang))} — ${severityWord(p.severity, lang)}`);
      lines.push(`   <i>${escapeHtml(clip(p.rationale, 180))}</i>`);
    }
  }

  const devs = (r.keyDevelopments ?? []).slice(0, 3);
  if (devs.length > 0) {
    lines.push("");
    lines.push(`<b>${L(lang, "Perkembangan penting", "Key developments")}</b>`);
    for (const d of devs) lines.push(`• ${escapeHtml(clip(d.summary, 200))}`);
  }

  lines.push("");
  lines.push(`🦅 <b>${L(lang, "Argumen risiko naik", "Case for higher risk")}</b>: ${escapeHtml(clip(r.hawkCase, 260))}`);
  lines.push(`🕊 <b>${L(lang, "Argumen risiko biasa saja", "Case for noise")}</b>: ${escapeHtml(clip(r.doveCase, 260))}`);
  lines.push("");
  lines.push(
    `<i>${L(
      lang,
      "Riset AI hanya masukan; keputusan proteksi tetap oleh aturan deterministik.",
      "AI research is an advisory input; protection decisions stay with deterministic rules.",
    )}</i>`,
  );
  lines.push(footer(lang));
  return lines.join("\n");
}

export function digestView(opts: {
  dateStr: string;
  assessments: RiskAssessment[];
  signals: Signal[];
  latestReport?: FetchedReportLike | null;
  lang?: Lang;
}): string {
  const lang = opts.lang ?? "id";
  const lines: string[] = [
    `🛡️ <b>Tahansoe Risk Digest</b> · ${escapeHtml(opts.dateStr)}`,
    "",
  ];

  if (opts.assessments.length === 0) {
    lines.push(L(lang, "Belum ada penilaian aset.", "No asset assessments yet."));
  } else {
    lines.push(`<b>${L(lang, "Kondisi Risiko Pasar (Aave V3)", "Market Risk Conditions (Aave V3)")}</b>`);
    for (const a of opts.assessments) {
      lines.push(assetRegimeLine(a.asset, a.regime, lang));
      lines.push(
        `   ${L(lang, "Saran trigger HF", "Suggested trigger HF")} <b>${a.recommendedTriggerHF.toFixed(2)}</b> · ${L(lang, "target", "target")} <b>${a.recommendedTargetHF.toFixed(2)}</b>`,
      );
    }
  }

  lines.push("");
  if (opts.signals.length === 0) {
    lines.push(`✅ ${L(lang, "Tidak ada sinyal risiko aktif.", "No active risk signals.")}`);
  } else {
    lines.push(`<b>${L(lang, `Sinyal Aktif (${opts.signals.length})`, `Active Signals (${opts.signals.length})`)}</b>`);
    for (const s of [...opts.signals].sort((a, b) => b.severity - a.severity).slice(0, 4)) {
      lines.push(signalLine(s, lang));
    }
  }

  if (opts.latestReport) {
    const r = opts.latestReport.report;
    lines.push("");
    lines.push(
      `🧠 <b>${L(lang, "Riset AI Terkini", "Latest AI Research")}</b>: ${regimeBadge(r.proposedRegime)} (${L(lang, "keyakinan", "conf")} ${pct(Math.min(r.confidence, 1), 0)})`,
    );
    if (r.hawkCase) {
      lines.push(`   <i>${escapeHtml(clip(r.hawkCase, 160))}</i>`);
    }
  }

  lines.push("");
  lines.push(
    `<i>${L(
      lang,
      "AI hanya memberi masukan; aturan deterministik menjaga posisi Anda.",
      "AI provides inputs; deterministic rules protect your position.",
    )}</i>`,
  );
  lines.push(footer(lang));
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Alert Proaktif
// ---------------------------------------------------------------------------

export function regimeUpAlert(
  asset: string,
  from: string,
  to: string,
  explanation: string,
  at: Date,
  lang: Lang = "id",
): string {
  return [
    `⚠️ <b>${escapeHtml(asset)}: ${escapeHtml(from)} → ${escapeHtml(to)}</b>`,
    `${regimeBadge(to)} — ${regimeMeaning(to, lang)}`,
    "",
    `<b>${L(lang, "Penyebab", "Cause")}</b>: ${escapeHtml(clip(explanation, 400))}`,
    "",
    `<b>${L(lang, "Yang bisa dicek", "What to check")}</b>:`,
    L(
      lang,
      "• Health Factor posisimu yang memakai aset ini.",
      "• Health Factor of your positions using this asset.",
    ),
    L(
      lang,
      "• Apakah buffer cadangan proteksimu masih cukup.",
      "• Whether your reserve protection buffer is sufficient.",
    ),
    "",
    `<i>${escapeHtml(fmtUtc(at))}</i>`,
    footer(lang),
  ].join("\n");
}

export function regimeDownAlert(
  asset: string,
  to: string,
  explanation: string,
  at: Date,
  lang: Lang = "id",
): string {
  return [
    `✅ <b>${escapeHtml(asset)} ${L(lang, "kembali ke", "returned to")} ${escapeHtml(to)}</b>`,
    `${regimeBadge(to)} — ${regimeMeaning(to, lang)}`,
    "",
    escapeHtml(clip(explanation, 400)),
    L(
      lang,
      "<i>Bertahan minimal 1 jam sebelum dinyatakan turun.</i>",
      "<i>Held for at least 1 hour before being lowered.</i>",
    ),
    "",
    `<i>${escapeHtml(fmtUtc(at))}</i>`,
    footer(lang),
  ].join("\n");
}

export type SignalAlertKind = "sequencer" | "depeg" | "pool" | "oracle";

const SIGNAL_ALERT_TEXT: Record<
  SignalAlertKind,
  { title: [string, string]; meaning: [string, string]; check: [string, string] }
> = {
  sequencer: {
    title: ["🚨 Sequencer Arbitrum DOWN", "🚨 Sequencer Arbitrum DOWN"],
    meaning: [
      "Jaringan Arbitrum berhenti memproses transaksi. Tidak ada yang bisa repay sampai pulih, dan saat pulih harga bisa melompat.",
      "Arbitrum stopped processing transactions — repay cannot be performed until recovered, and prices can jump when it resumes.",
    ],
    check: [
      "Siapkan langkah repay/tambah jaminan begitu jaringan pulih.",
      "Prepare to repay/add collateral as soon as the network is back.",
    ],
  },
  depeg: {
    title: ["🚨 Stablecoin {asset} depeg detected", "🚨 Stablecoin {asset} depeg detected"],
    meaning: [
      "Stablecoin ini tidak lagi bernilai $1. HF bisa bergerak walau ETH diam, karena nilai jaminan/utang berubah.",
      "This stablecoin is no longer worth $1. HF can move even if ETH is flat because collateral/debt value changes.",
    ],
    check: [
      "Cek posisi yang memakai stablecoin ini sebagai jaminan atau utang.",
      "Check positions that use this stablecoin as collateral or debt.",
    ],
  },
  pool: {
    title: [
      "⚠️ Pool {asset} liquidity constrained (utilization >= 98%)",
      "⚠️ Pool {asset} liquidity constrained (utilization >= 98%)",
    ],
    meaning: [
      "Hampir semua dana pool sedang dipinjam. Bunga pinjaman melonjak dan dana di pool sulit ditarik.",
      "Almost all of the pool is borrowed. Borrow rates spike and funds are hard to withdraw.",
    ],
    check: [
      "Utang di aset ini akan tumbuh lebih cepat — pantau HF lebih sering.",
      "Debt in this asset will grow faster — watch HF more often.",
    ],
  },
  oracle: {
    title: [
      "🚨 Severe oracle lag/deviation on {asset}",
      "🚨 Severe oracle lag/deviation on {asset}",
    ],
    meaning: [
      "Harga oracle Aave tertinggal atau menyimpang dari pasar. Saat tersusul, harga bisa melompat sekaligus.",
      "The Aave oracle price is lagging or deviating from the market. When it catches up, the price can jump at once.",
    ],
    check: [
      "Anggap HF yang terlihat sekarang mungkin belum mencerminkan harga pasar.",
      "Treat the HF you see now as possibly not reflecting the market price yet.",
    ],
  },
};

export function signalAlert(
  kind: SignalAlertKind,
  s: Signal,
  at: Date,
  lang: Lang = "id",
): string {
  const t = SIGNAL_ALERT_TEXT[kind];
  const asset = escapeHtml(s.assets[0] ?? "");
  const title = (lang === "id" ? t.title[0] : t.title[1]).replace("{asset}", asset);
  const evidence = (s.evidence ?? []).map((e) => e?.title).filter(Boolean).slice(0, 3) as string[];

  return [
    `<b>${title}</b>`,
    "",
    lang === "id" ? t.meaning[0] : t.meaning[1],
    "",
    `<b>${L(lang, "Bukti", "Evidence")}</b>`,
    ...(evidence.length
      ? evidence.map((e) => `• ${escapeHtml(clip(e, 160))}`)
      : [`• ${L(lang, "ambang sinyal terlewati", "signal threshold breached")}`]),
    "",
    `<b>${L(lang, "Yang bisa dicek", "What to check")}</b>: ${lang === "id" ? t.check[0] : t.check[1]}`,
    "",
    `<i>${escapeHtml(fmtUtc(at))}</i>`,
    footer(lang),
  ].join("\n");
}

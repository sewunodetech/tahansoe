/**
 * Tampilan pesan Telegram (HTML) — ringkas, ramah layar HP, dan selalu menjelaskan
 * arti angkanya. Menggantikan pengiriman output tabel terminal mentah ke chat.
 *
 * Aturan format:
 *  - parse_mode HTML; hanya <b>, <i>, <code>. Setiap tag dibuka & ditutup di BARIS
 *    yang sama agar pemotongan pesan per baris (chunkMessage) tidak merusak tag.
 *  - Semua teks dinamis (alasan, ringkasan model, nama aset) lewat escapeHtml.
 *  - Bahasa mengikuti settings.ui.language (id/en), default en.
 *  - Tanpa saran beli/jual, prediksi harga, atau ranking yield (PRD §11). Langkah
 *    yang disebut hanya untuk menjaga posisi (cek HF, buffer), bukan trading.
 */

import type { ReplContext, FetchedReport, CarryPairSummary } from "../chat/context.ts";
import type { Signal, RiskAssessment } from "@tahansoe/domain";
import type { FusionRunResult } from "../fusion/run.ts";
import type { HistoryRow } from "../db/history.ts";
import type { CarryData } from "../cli/commands/carry.ts";

export type Lang = "id" | "en";

/** Bahasa pesan dari settings (ui.language), default en. */
export function chatLang(settings?: { ui?: { language?: string } }): Lang {
  return settings?.ui?.language === "id" ? "id" : "en";
}

const L = (lang: Lang, id: string, en: string): string => (lang === "id" ? id : en);

export function escapeHtml(text: unknown): string {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Potong teks panjang dengan elipsis. */
function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

export function footer(lang: Lang): string {
  return `<i>${L(lang, "Informasi risiko · bukan saran investasi", "informational · not investment advice")}</i>`;
}

// ---------------------------------------------------------------------------
// Kosakata: regime, jalur risiko, tingkat keparahan
// ---------------------------------------------------------------------------

const REGIME_EMOJI: Record<string, string> = { CALM: "🟢", ELEVATED: "🟡", STRESSED: "🟠", CRISIS: "🔴" };

export function regimeBadge(regime: string): string {
  return `${REGIME_EMOJI[regime] ?? "⚪"} <b>${escapeHtml(regime)}</b>`;
}

/** Baris aset: "🟡 USDC · ELEVATED — arti". */
function assetRegimeLine(asset: string, regime: string, lang: Lang): string {
  return `${REGIME_EMOJI[regime] ?? "⚪"} <b>${escapeHtml(asset)}</b> · <b>${escapeHtml(regime)}</b> — ${regimeMeaning(regime, lang)}`;
}

export function regimeMeaning(regime: string, lang: Lang): string {
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

export function pathLabel(path: string, lang: Lang): string {
  const p = PATH_LABEL[path];
  return p ? (lang === "id" ? p[0] : p[1]) : path;
}

export function severityWord(sev: number, lang: Lang): string {
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

function ago(d: Date, now: Date, lang: Lang): string {
  const min = Math.max(0, Math.round((now.getTime() - d.getTime()) / 60_000));
  if (min < 60) return L(lang, `${min} menit lalu`, `${min} min ago`);
  const h = Math.round(min / 60);
  if (h < 48) return L(lang, `${h} jam lalu`, `${h}h ago`);
  return L(lang, `${Math.round(h / 24)} hari lalu`, `${Math.round(h / 24)}d ago`);
}

/** Satu baris ringkas sebuah sinyal: jalur risiko + aset + tingkat. */
function signalLine(s: Signal, lang: Lang): string {
  const path = s.paths?.[0];
  const what = path ? pathLabel(path, lang) : s.module.toLowerCase();
  const assets = s.assets.length ? ` (${escapeHtml(s.assets.join(", "))})` : "";
  const title = s.evidence?.find((e) => e?.title)?.title;
  const detail = title ? ` — ${escapeHtml(clip(title, 90))}` : "";
  return `• ${escapeHtml(what)}${assets}: ${severityWord(s.severity, lang)}${detail}`;
}

// ---------------------------------------------------------------------------
// /start, /help
// ---------------------------------------------------------------------------

export function welcomeView(lang: Lang): string {
  return [
    `🛡 <b>Tahansoe Risk Agent</b>`,
    "",
    L(
      lang,
      "Saya memantau risiko likuidasi posisi pinjaman Aave V3 di Arbitrum: harga dari oracle Aave, depeg stablecoin, lonjakan bunga, status sequencer, kalender makro, dan berita.",
      "I watch liquidation risk for Aave V3 borrow positions on Arbitrum: Aave oracle prices, stablecoin depegs, borrow-rate spikes, sequencer status, the macro calendar, and news.",
    ),
    L(
      lang,
      "Saya tidak memegang dana dan tidak memberi saran beli/jual — tujuannya membantu posisimu bertahan.",
      "I never hold funds and never give buy/sell advice — the goal is to help your position survive.",
    ),
    "",
    commandList(lang),
    "",
    L(lang, "Atau tulis pertanyaan biasa, mis. <i>kenapa USDC ELEVATED?</i>", "Or just ask a question, e.g. <i>why is USDC ELEVATED?</i>"),
  ].join("\n");
}

function commandList(lang: Lang): string {
  return [
    `<b>${L(lang, "Perintah", "Commands")}</b>`,
    `/status — ${L(lang, "kondisi risiko per aset saat ini", "current risk level per asset")}`,
    `/fuse — ${L(lang, "hitung ulang penilaian risiko sekarang", "recompute the risk assessment now")}`,
    `/carry — ${L(lang, "bunga pinjaman & efeknya ke HF", "borrow rates & their effect on HF")}`,
    `/report — ${L(lang, "ringkasan riset AI terbaru", "latest AI research summary")}`,
    `/history — ${L(lang, "riwayat hasil riset", "recent research results")}`,
    `/alerts — ${L(lang, "atur jenis notifikasi", "choose alert types")}`,
    `/subscribe · /unsubscribe — ${L(lang, "nyalakan/matikan notifikasi", "turn alerts on/off")}`,
    `/help — ${L(lang, "panduan & arti istilah", "guide & glossary")}`,
  ].join("\n");
}

export function helpView(lang: Lang): string {
  return [
    `📖 <b>${L(lang, "Panduan Tahansoe", "Tahansoe guide")}</b>`,
    "",
    commandList(lang),
    "",
    `<b>${L(lang, "Arti tingkat risiko (regime)", "Risk levels (regime)")}</b>`,
    ...["CALM", "ELEVATED", "STRESSED", "CRISIS"].map((r) => `${regimeBadge(r)} — ${regimeMeaning(r, lang)}`),
    "",
    `<b>${L(lang, "Istilah", "Terms")}</b>`,
    L(
      lang,
      "• <b>HF (Health Factor)</b>: nilai jaminan dibanding utang. Di bawah 1,0 posisi bisa dilikuidasi.",
      "• <b>HF (Health Factor)</b>: collateral value vs debt. Below 1.0 the position can be liquidated.",
    ),
    L(
      lang,
      "• <b>Trigger HF</b>: batas HF tempat proteksi mulai bertindak. <b>Target HF</b>: HF tujuan setelah proteksi.",
      "• <b>Trigger HF</b>: the HF at which protection acts. <b>Target HF</b>: the HF protection restores.",
    ),
    L(
      lang,
      "• <b>Carry</b>: bunga dari jaminan dikurangi bunga utang. Negatif = utang tumbuh lebih cepat, HF turun pelan.",
      "• <b>Carry</b>: interest earned on collateral minus interest paid on debt. Negative = debt grows faster, HF drifts down.",
    ),
    L(
      lang,
      "• <b>Kink</b>: tingkat pemakaian pool tempat bunga pinjaman melonjak tajam.",
      "• <b>Kink</b>: the pool usage level where borrow rates jump sharply.",
    ),
    "",
    L(
      lang,
      "Pertanyaan bebas dijawab hanya dari data yang tersimpan (tanpa prediksi harga).",
      "Free-text questions are answered only from stored data (no price predictions).",
    ),
    footer(lang),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// /status
// ---------------------------------------------------------------------------

export function statusView(ctx: ReplContext, lang: Lang): string {
  const lines: string[] = [`📊 <b>${L(lang, "Status risiko", "Risk status")}</b>`, ""];

  if (!ctx.hasData && ctx.assessments.length === 0 && !ctx.latestReport) {
    lines.push(
      L(
        lang,
        "Belum ada data. Agent perlu berjalan (<code>tahansoe start</code>) agar penilaian pertama terbentuk.",
        "No data yet. The agent needs to be running (<code>tahansoe start</code>) to produce the first assessment.",
      ),
    );
    lines.push("", footer(lang));
    return lines.join("\n");
  }

  if (ctx.assessments.length > 0) {
    for (const a of ctx.assessments) {
      lines.push(assetRegimeLine(a.asset, a.regime, lang));
      lines.push(
        `   ${L(lang, "Saran trigger HF", "Suggested trigger HF")} <b>${a.recommendedTriggerHf.toFixed(2)}</b> · ${L(lang, "target", "target")} <b>${a.recommendedTargetHf.toFixed(2)}</b>`,
      );
    }
    const at = ctx.assessments[0]!.createdAt;
    lines.push(`<i>${L(lang, "Dinilai", "Assessed")} ${ago(at, ctx.now, lang)}</i>`);
  } else if (ctx.latestReport) {
    const r = ctx.latestReport.report;
    lines.push(`${regimeBadge(r.proposedRegime)} — ${regimeMeaning(r.proposedRegime, lang)}`);
  }

  lines.push("");
  const signals = ctx.activeSignals;
  if (signals.length === 0) {
    lines.push(`✅ ${L(lang, "Tidak ada sinyal risiko aktif.", "No active risk signals.")}`);
  } else {
    lines.push(`<b>${L(lang, `Sinyal aktif (${signals.length})`, `Active signals (${signals.length})`)}</b>`);
    for (const s of [...signals].sort((a, b) => b.severity - a.severity).slice(0, 5)) {
      lines.push(signalLine(s, lang));
    }
    if (signals.length > 5) lines.push(`<i>${L(lang, `+${signals.length - 5} sinyal lain`, `+${signals.length - 5} more`)}</i>`);
  }

  if (ctx.latestReport) {
    const r = ctx.latestReport.report;
    lines.push("");
    lines.push(
      `🧠 ${L(lang, "Riset AI terakhir", "Latest AI research")}: ${regimeBadge(r.proposedRegime)} · ${L(lang, "keyakinan", "confidence")} ${pct(Math.min(r.confidence, 1), 0)} · ${ago(ctx.latestReport.createdAt, ctx.now, lang)}`,
    );
    lines.push(
      `<i>${L(lang, "Riset AI hanya masukan; regime resmi ditentukan aturan deterministik.", "AI research is only an input; the official regime comes from deterministic rules.")}</i>`,
    );
  }

  if (ctx.staleSources.length > 0) {
    lines.push("");
    lines.push(
      `⏳ ${L(lang, "Data lama", "Stale data")}: ${escapeHtml(ctx.staleSources.map((s) => s.label.toLowerCase()).join(", "))}. ${L(lang, "Pastikan agent tetap berjalan.", "Make sure the agent keeps running.")}`,
    );
  }

  lines.push("", footer(lang));
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// /fuse
// ---------------------------------------------------------------------------

export function fuseView(result: FusionRunResult, lang: Lang): string {
  const lines: string[] = [`⚙️ <b>${L(lang, "Penilaian risiko (fusion)", "Risk assessment (fusion)")}</b>`, ""];
  lines.push(
    `<i>${L(
      lang,
      "Dihitung dengan aturan tetap dari harga oracle Aave + sinyal on-chain, makro, dan riset. Riset AI saja tidak bisa menaikkan ke STRESSED/CRISIS.",
      "Computed with fixed rules from Aave oracle prices + on-chain, macro and research signals. AI research alone cannot raise it to STRESSED/CRISIS.",
    )}</i>`,
  );
  lines.push("");

  for (const r of result.results) {
    const a: RiskAssessment | null = r.assessment;
    if (!a) {
      lines.push(`⚪ <b>${escapeHtml(r.asset)}</b> — ${escapeHtml(r.note ?? L(lang, "tidak ada data", "no data"))}`);
      continue;
    }
    lines.push(assetRegimeLine(a.asset, a.regime, lang));
    lines.push(`   ${L(lang, "Skor risiko", "Risk score")} ${a.riskScore.toFixed(0)}/100`);
    lines.push(
      `   ${L(lang, "Perkiraan penurunan terburuk", "Worst-case drop estimate")}: ${pct(a.drawdownEstimate.h4)} (4 ${L(lang, "jam", "h")}) · ${pct(a.drawdownEstimate.h24)} (24 ${L(lang, "jam", "h")})`,
    );
    lines.push(
      `   ${L(lang, "Saran trigger HF", "Suggested trigger HF")} <b>${a.recommendedTriggerHF.toFixed(2)}</b> → ${L(lang, "target", "target")} <b>${a.recommendedTargetHF.toFixed(2)}</b>`,
    );
    for (const reason of r.reasons.slice(0, 3)) lines.push(`   • ${escapeHtml(clip(reason, 120))}`);
  }

  lines.push("");
  lines.push(
    `<i>${L(
      lang,
      "Trigger HF = batas HF tempat proteksi bertindak; target = HF yang dipulihkan. Angka ini saran sebelum dibatasi band kebijakanmu.",
      "Trigger HF = where protection acts; target = the HF it restores. These are suggestions before your policy band is applied.",
    )}</i>`,
  );
  if (result.dry) lines.push(`<i>${L(lang, "Pratinjau — tidak disimpan.", "Preview — not saved.")}</i>`);
  lines.push(footer(lang));
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// /carry
// ---------------------------------------------------------------------------

function daysText(days: number | null, lang: Lang): string {
  if (days === null) return L(lang, "HF tidak turun karena bunga", "HF does not fall from interest");
  const d = Math.round(days);
  if (d > 3650) return L(lang, "> 10 tahun ke HF 1,45", "> 10 years to HF 1.45");
  return L(lang, `HF 1,50 → 1,45 dalam ±${d} hari`, `HF 1.50 → 1.45 in ~${d} days`);
}

function carryPct(x: number): string {
  const v = (x * 100).toFixed(1);
  return x < 0 ? `−${v.slice(1)}%` : `+${v}%`;
}

export function carryView(data: CarryData, lang: Lang): string {
  const lines: string[] = [`💸 <b>${L(lang, "Bunga & carry Aave V3 (Arbitrum)", "Aave V3 rates & carry (Arbitrum)")}</b>`, ""];
  lines.push(
    L(
      lang,
      "<b>Carry</b> = bunga yang didapat jaminanmu dikurangi bunga utangmu, per tahun. Kalau <b>negatif</b>, utang tumbuh lebih cepat dari jaminan sehingga <b>HF turun pelan walau harga diam</b>.",
      "<b>Carry</b> = interest your collateral earns minus interest your debt costs, per year. When <b>negative</b>, debt grows faster than collateral, so <b>HF drifts down even if prices stay flat</b>.",
    ),
  );
  lines.push("");

  const pairs = data.pairs.filter((p) => p.available && p.netCarry !== null);
  if (pairs.length > 0) {
    lines.push(`<b>${L(lang, "Pasangan jaminan → utang", "Collateral → debt pairs")}</b>`);
    for (const p of pairs) {
      const icon = p.netCarry! < 0 ? "🔻" : "🟢";
      lines.push(`${icon} <b>${escapeHtml(p.collateral)} → ${escapeHtml(p.debt)}</b>: ${carryPct(p.netCarry!)}/${L(lang, "thn", "yr")}`);
      lines.push(`   ${daysText(p.daysHf150To145, lang)}`);
    }
    lines.push("");
  }

  const stressed = data.reserves.filter((r) => r.status !== "ok");
  lines.push(`<b>${L(lang, "Pool yang mendekati/melewati kink", "Pools near/past the kink")}</b>`);
  if (stressed.length === 0) {
    lines.push(`✅ ${L(lang, "Tidak ada — bunga pinjaman masih di zona normal.", "None — borrow rates are in the normal zone.")}`);
  } else {
    for (const r of stressed.slice(0, 6)) {
      const icon = r.status === "past kink" ? "🔴" : "🟡";
      const kink = r.optimalUtil !== null ? pct(r.optimalUtil, 0) : "—";
      lines.push(
        `${icon} <b>${escapeHtml(r.asset)}</b>: ${L(lang, "terpakai", "used")} ${pct(r.utilization)} (kink ${kink}) · ${L(lang, "bunga pinjam", "borrow")} ${pct(r.borrowApy)}`,
      );
    }
  }
  lines.push(
    `<i>${L(
      lang,
      "Kink = tingkat pemakaian pool tempat bunga pinjaman naik tajam. Di atas kink, bunga bisa berlipat dalam hitungan jam.",
      "Kink = the pool usage level where borrow rates rise steeply. Above it, rates can multiply within hours.",
    )}</i>`,
  );

  const scenarios = data.pairs.filter((p) => p.scenario95 && p.scenario95.projectedDays !== null).slice(0, 2);
  if (scenarios.length > 0) {
    lines.push("");
    lines.push(`<b>${L(lang, "Skenario: pool utang terpakai 95%", "Scenario: debt pool at 95% usage")}</b>`);
    for (const p of scenarios) {
      const s = p.scenario95!;
      lines.push(
        `• ${escapeHtml(p.collateral)} → ${escapeHtml(p.debt)}: ${L(lang, "bunga", "rate")} ≈ ${pct(s.projectedBorrowApr, 0)} → ${daysText(s.projectedDays, lang)}`,
      );
    }
  }

  lines.push("");
  lines.push(
    `<i>${L(
      lang,
      "Yield staking LST (mis. wstETH ±3%/thn) tidak dihitung, jadi carry LST di sini konservatif. Ini pemantauan risiko, bukan rekomendasi tempat menaruh dana.",
      "LST staking yield (e.g. wstETH ~3%/yr) is not included, so LST carry here is conservative. This is risk monitoring, not advice on where to put funds.",
    )}</i>`,
  );
  lines.push(footer(lang));
  return lines.join("\n");
}

/** Versi carry dari konteks tersimpan (dipakai bila RPC gagal). */
export function carryFromContextView(pairs: CarryPairSummary[], lang: Lang): string {
  return carryView(
    {
      reserves: [],
      pairs: pairs.map((p) => ({
        collateral: p.collateral,
        debt: p.debt,
        available: true,
        netCarry: p.netCarryPct / 100, // context menyimpan persen
        daysHf150To145: p.daysToDrift,
        scenario95: null,
      })),
    },
    lang,
  );
}

// ---------------------------------------------------------------------------
// /report, /history
// ---------------------------------------------------------------------------

export function reportView(f: FetchedReport, lang: Lang, now: Date = new Date()): string {
  const r = f.report;
  const lines: string[] = [`🧠 <b>${L(lang, "Riset AI", "AI research")}</b> · ${escapeHtml(fmtUtc(f.createdAt))} (${ago(f.createdAt, now, lang)})`, ""];
  lines.push(`${regimeBadge(r.proposedRegime)} — ${regimeMeaning(r.proposedRegime, lang)}`);
  lines.push(
    `${L(lang, "Keyakinan", "Confidence")} ${pct(Math.min(r.confidence, 1), 0)} · ${L(lang, "horizon", "horizon")} ${r.horizonHours} ${L(lang, "jam", "h")} · ${L(lang, "aset", "assets")} ${escapeHtml(r.assets.join(", "))}`,
  );

  const paths = [...r.paths].sort((a, b) => b.severity - a.severity).slice(0, 4);
  if (paths.length > 0) {
    lines.push("");
    lines.push(`<b>${L(lang, "Jalur risiko utama", "Main risk paths")}</b>`);
    for (const p of paths) {
      lines.push(`• ${escapeHtml(pathLabel(p.path, lang))} — ${severityWord(p.severity, lang)}`);
      lines.push(`   <i>${escapeHtml(clip(p.rationale, 180))}</i>`);
    }
  }

  const devs = r.keyDevelopments.slice(0, 3);
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
      "Riset AI hanya masukan dengan bobot terbatas; keputusan proteksi tetap oleh aturan deterministik. Ringkasan model berbahasa Inggris.",
      "AI research is a capped input; protection decisions stay with deterministic rules.",
    )}</i>`,
  );
  lines.push(footer(lang));
  return lines.join("\n");
}

export function historyView(rows: HistoryRow[], lang: Lang): string {
  const lines: string[] = [`🗂 <b>${L(lang, "Riwayat riset AI", "AI research history")}</b>`, ""];
  if (rows.length === 0) {
    lines.push(L(lang, "Belum ada riset tersimpan.", "No research saved yet."));
  } else {
    for (const r of rows) {
      lines.push(
        `${REGIME_EMOJI[r.regime] ?? "⚪"} ${escapeHtml(fmtUtc(r.createdAt))} · <b>${escapeHtml(r.regime)}</b> · ${L(lang, "keyakinan", "conf")} ${pct(Math.min(r.confidence, 1), 0)}`,
      );
    }
    lines.push("");
    lines.push(`<i>${L(lang, "Detail terbaru: /report", "Latest details: /report")}</i>`);
  }
  lines.push(footer(lang));
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Jawaban tanya-jawab
// ---------------------------------------------------------------------------

export function chatAnswerView(answer: string, costLine: string, lang: Lang): string {
  return [escapeHtml(answer.trim()), "", `<i>${escapeHtml(costLine)}</i>`, footer(lang)].join("\n");
}

// ---------------------------------------------------------------------------
// Alert proaktif
// ---------------------------------------------------------------------------

export function regimeUpAlert(asset: string, from: string, to: string, explanation: string, at: Date, lang: Lang): string {
  return [
    `⚠️ <b>${escapeHtml(asset)}: ${escapeHtml(from)} → ${escapeHtml(to)}</b>`,
    `${regimeBadge(to)} — ${regimeMeaning(to, lang)}`,
    "",
    `<b>${L(lang, "Penyebab", "Cause")}</b>: ${escapeHtml(clip(explanation, 400))}`,
    "",
    `<b>${L(lang, "Yang bisa dicek", "What to check")}</b>`,
    L(
      lang,
      "• Health Factor posisimu yang memakai aset ini — makin dekat ke 1,0 makin rentan.",
      "• The Health Factor of your positions using this asset — the closer to 1.0, the more exposed.",
    ),
    L(
      lang,
      "• Apakah buffer proteksimu (dana cadangan repay) masih cukup.",
      "• Whether your protection buffer (repay reserve) is still sufficient.",
    ),
    "",
    `<i>${escapeHtml(fmtUtc(at))}</i>`,
    footer(lang),
  ].join("\n");
}

export function regimeDownAlert(asset: string, to: string, explanation: string, at: Date, lang: Lang): string {
  return [
    `✅ <b>${escapeHtml(asset)} ${L(lang, "kembali ke", "returned to")} ${escapeHtml(to)}</b>`,
    `${regimeBadge(to)} — ${regimeMeaning(to, lang)}`,
    "",
    escapeHtml(clip(explanation, 400)),
    L(lang, "<i>Bertahan minimal 1 jam sebelum dinyatakan turun.</i>", "<i>Held for at least 1 hour before being lowered.</i>"),
    "",
    `<i>${escapeHtml(fmtUtc(at))}</i>`,
    footer(lang),
  ].join("\n");
}

export type SignalAlertKind = "sequencer" | "depeg" | "pool" | "oracle";

const SIGNAL_ALERT_TEXT: Record<SignalAlertKind, { title: [string, string]; meaning: [string, string]; check: [string, string] }> = {
  sequencer: {
    title: ["🚨 Sequencer Arbitrum DOWN", "🚨 Sequencer Arbitrum DOWN"],
    meaning: [
      "Jaringan Arbitrum berhenti memproses transaksi. Tidak ada yang bisa repay sampai pulih, dan saat pulih harga bisa melompat.",
      "Arbitrum stopped processing transactions — repay cannot be performed until recovered, and prices can jump when it resumes.",
    ],
    check: [
      "Siapkan langkah repay/tambah jaminan begitu jaringan pulih (ada masa tenggang oracle setelahnya).",
      "Prepare to repay/add collateral as soon as the network is back (there is an oracle grace period afterwards).",
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
    title: ["⚠️ Pool {asset} liquidity constrained (utilization >= 98%)", "⚠️ Pool {asset} liquidity constrained (utilization >= 98%)"],
    meaning: [
      "Hampir semua dana pool sedang dipinjam. Bunga pinjaman melonjak dan dana di pool sulit ditarik.",
      "Almost all of the pool is borrowed. Borrow rates spike and funds are hard to withdraw.",
    ],
    check: [
      "Utang di aset ini akan tumbuh lebih cepat — pantau HF lebih sering (lihat /carry).",
      "Debt in this asset will grow faster — watch HF more often (see /carry).",
    ],
  },
  oracle: {
    title: ["🚨 Severe oracle lag/deviation on {asset}", "🚨 Severe oracle lag/deviation on {asset}"],
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

export function signalAlert(kind: SignalAlertKind, s: Signal, at: Date, lang: Lang): string {
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
    ...(evidence.length ? evidence.map((e) => `• ${escapeHtml(clip(e, 160))}`) : [`• ${L(lang, "ambang sinyal terlewati", "signal threshold breached")}`]),
    "",
    `<b>${L(lang, "Yang bisa dicek", "What to check")}</b>: ${lang === "id" ? t.check[0] : t.check[1]}`,
    "",
    `<i>${escapeHtml(fmtUtc(at))}</i>`,
    footer(lang),
  ].join("\n");
}

export function dailySummaryView(day: string, assessments: RiskAssessment[], signals: Signal[], lang: Lang): string {
  const lines: string[] = [`📅 <b>${L(lang, "Ringkasan risiko harian", "Daily risk summary")}</b> · ${escapeHtml(day)}`, ""];
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
    for (const s of [...signals].sort((a, b) => b.severity - a.severity).slice(0, 3)) lines.push(signalLine(s, lang));
  }
  lines.push("", `<i>${L(lang, "Detail: /status · bunga: /carry", "Details: /status · rates: /carry")}</i>`, footer(lang));
  return lines.join("\n");
}

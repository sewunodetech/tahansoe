import type { Lang } from "../gateway/views.ts";
import { escapeHtml, footer } from "../gateway/views.ts";

const L = (lang: Lang, id: string, en: string): string => (lang === "id" ? id : en);

export function hfWarningAlert(opts: {
  user: string;
  hf: number;
  triggerHf: number;
  lang?: Lang;
}): string {
  const lang = opts.lang ?? "en";
  const userShort = `${opts.user.slice(0, 6)}…${opts.user.slice(-4)}`;
  return [
    `⚠️ <b>${L(lang, "PERINGATAN RISIKO HF", "HEALTH FACTOR WARNING")}</b>`,
    `<b>${L(lang, "Posisi", "Position")}:</b> <code>${escapeHtml(userShort)}</code>`,
    `<b>HF:</b> <code>${opts.hf.toFixed(2)}</code> (Trigger: <code>${opts.triggerHf.toFixed(2)}</code>)`,
    L(
      lang,
      "Health Factor mendekati batas trigger proteksi Guardian. Pertimbangkan menambah collateral atau melunasi sebagian utang.",
      "Health Factor is approaching your Guardian protection trigger. Consider supplying collateral or repaying part of the debt.",
    ),
    "",
    footer(lang),
  ].join("\n");
}

export function hfCriticalAlert(opts: {
  user: string;
  hf: number;
  triggerHf: number;
  lang?: Lang;
}): string {
  const lang = opts.lang ?? "en";
  const userShort = `${opts.user.slice(0, 6)}…${opts.user.slice(-4)}`;
  return [
    `🚨 <b>${L(lang, "KRITIKAL: POSISI DI BAWAH TRIGGER", "CRITICAL: POSITION BELOW TRIGGER")}</b>`,
    `<b>${L(lang, "Posisi", "Position")}:</b> <code>${escapeHtml(userShort)}</code>`,
    `<b>HF:</b> <code>${opts.hf.toFixed(2)}</code> &lt;= <code>${opts.triggerHf.toFixed(2)}</code>`,
    L(
      lang,
      "Posisi berada di zona KRITIKAL dan memerlukan intervensi proteksi. Guardian / keeper sedang memproses pelunasan otomatis.",
      "Position is in the CRITICAL zone and needs protection. Guardian / keeper is evaluating an automated repayment action.",
    ),
    "",
    footer(lang),
  ].join("\n");
}

export function reserveLowAlert(opts: {
  user: string;
  allowance: bigint;
  balance: bigint;
  cap: bigint;
  decimals?: number;
  symbol?: string;
  lang?: Lang;
}): string {
  const lang = opts.lang ?? "en";
  const userShort = `${opts.user.slice(0, 6)}…${opts.user.slice(-4)}`;
  const sym = opts.symbol ?? "tokens";
  const dec = opts.decimals ?? 6;
  const unit = 10n ** BigInt(dec);
  const minReserve = opts.allowance < opts.balance ? opts.allowance : opts.balance;
  const reserveFmt = (Number(minReserve) / Number(unit)).toFixed(2);
  const capFmt = (Number(opts.cap) / Number(unit)).toFixed(2);

  return [
    `⚠️ <b>${L(lang, "CADANGAN RESERVOIR RENDAH", "RESERVE CAPACITY LOW")}</b>`,
    `<b>${L(lang, "Posisi", "Position")}:</b> <code>${escapeHtml(userShort)}</code>`,
    `<b>${L(lang, "Tersedia", "Available")}:</b> <code>${reserveFmt} ${escapeHtml(sym)}</code> (Cap: <code>${capFmt} ${escapeHtml(sym)}</code>)`,
    L(
      lang,
      "Kapasitas proteksi (min dari saldo dan allowance) berada di bawah batas satu kali aksi. Isi ulang saldo atau perbarui allowance agar proteksi tetap aktif.",
      "Protection capacity (min of balance and allowance) is below one full action cap. Top up balance or update allowance to ensure continuous protection.",
    ),
    "",
    footer(lang),
  ].join("\n");
}

export function protectedExecutionAlert(opts: {
  user: string;
  repaid: bigint;
  hfBefore: bigint;
  hfAfter: bigint;
  caller: string;
  decimals?: number;
  symbol?: string;
  lang?: Lang;
}): string {
  const lang = opts.lang ?? "en";
  const userShort = `${opts.user.slice(0, 6)}…${opts.user.slice(-4)}`;
  const callerShort = `${opts.caller.slice(0, 6)}…${opts.caller.slice(-4)}`;
  const sym = opts.symbol ?? "tokens";
  const dec = opts.decimals ?? 6;
  const unit = 10n ** BigInt(dec);
  const repaidFmt = (Number(opts.repaid) / Number(unit)).toFixed(2);
  const hfBeforeFmt = (Number(opts.hfBefore) / 1e18).toFixed(2);
  const hfAfterFmt = (Number(opts.hfAfter) / 1e18).toFixed(2);

  return [
    `🛡️ <b>${L(lang, "EKSEKUSI PROTEKSI BERHASIL", "PROTECTION EXECUTED")}</b>`,
    `<b>${L(lang, "Posisi", "Position")}:</b> <code>${escapeHtml(userShort)}</code>`,
    `<b>${L(lang, "Pelunasan", "Repaid")}:</b> <code>${repaidFmt} ${escapeHtml(sym)}</code>`,
    `<b>Health Factor:</b> <code>${hfBeforeFmt}</code> ➔ <code>${hfAfterFmt}</code>`,
    `<b>${L(lang, "Eksekutor", "Executor")}:</b> <code>${escapeHtml(callerShort)}</code>`,
    "",
    footer(lang),
  ].join("\n");
}

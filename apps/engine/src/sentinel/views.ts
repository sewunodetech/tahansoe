import type { Lang } from "../telegram/views.ts";
import { escapeHtml, footer } from "../telegram/views.ts";

const L = (lang: Lang, id: string, en: string): string => (lang === "id" ? id : en);

function formatProtocolName(protocol?: string): string | null {
  if (!protocol) return null;
  if (protocol === "morpho-blue" || protocol.toLowerCase().includes("morpho")) {
    return "Morpho Blue";
  }
  return "Aave V3";
}

function formatPositionDisplay(opts: {
  userShort: string;
  symbol?: string;
  debtAsset?: string;
  marketId?: string;
}): string {
  if (opts.marketId) {
    const marketShort = `${opts.marketId.slice(0, 10)}…${opts.marketId.slice(-6)}`;
    return `<code>${escapeHtml(opts.userShort)}</code> (Market <code>${escapeHtml(marketShort)}</code>)`;
  }
  if (opts.symbol) {
    return `<code>${escapeHtml(opts.userShort)}</code> (<code>${escapeHtml(opts.symbol)}</code>)`;
  }
  if (opts.debtAsset) {
    const assetShort = `${opts.debtAsset.slice(0, 6)}…${opts.debtAsset.slice(-4)}`;
    return `<code>${escapeHtml(opts.userShort)}</code> (<code>${escapeHtml(assetShort)}</code>)`;
  }
  return `<code>${escapeHtml(opts.userShort)}</code>`;
}

export function hfWarningAlert(opts: {
  user: string;
  hf: number;
  triggerHf: number;
  protocol?: string;
  symbol?: string;
  debtAsset?: string;
  marketId?: string;
  positionKey?: string;
  lang?: Lang;
}): string {
  const lang = opts.lang ?? "en";
  const userShort = `${opts.user.slice(0, 6)}…${opts.user.slice(-4)}`;
  const protocolName = formatProtocolName(opts.protocol);
  const posDisplay = formatPositionDisplay({
    userShort,
    symbol: opts.symbol,
    debtAsset: opts.debtAsset,
    marketId: opts.marketId,
  });

  const lines = [
    `⚠️ <b>${L(lang, "PERINGATAN RISIKO HF", "HEALTH FACTOR WARNING")}</b>`,
  ];

  if (protocolName) {
    lines.push(`<b>${L(lang, "Protokol", "Protocol")}:</b> <code>${escapeHtml(protocolName)}</code>`);
  }

  lines.push(
    `<b>${L(lang, "Posisi", "Position")}:</b> ${posDisplay}`,
    `<b>HF:</b> <code>${opts.hf.toFixed(2)}</code> (Trigger: <code>${opts.triggerHf.toFixed(2)}</code>)`,
    L(
      lang,
      "Health Factor mendekati batas trigger proteksi Guardian. Pertimbangkan menambah collateral atau melunasi sebagian utang.",
      "Health Factor is approaching your Guardian protection trigger. Consider supplying collateral or repaying part of the debt.",
    ),
    "",
    footer(lang),
  );

  return lines.join("\n");
}

export function hfCriticalAlert(opts: {
  user: string;
  hf: number;
  triggerHf: number;
  protocol?: string;
  symbol?: string;
  debtAsset?: string;
  marketId?: string;
  positionKey?: string;
  lang?: Lang;
}): string {
  const lang = opts.lang ?? "en";
  const userShort = `${opts.user.slice(0, 6)}…${opts.user.slice(-4)}`;
  const protocolName = formatProtocolName(opts.protocol);
  const posDisplay = formatPositionDisplay({
    userShort,
    symbol: opts.symbol,
    debtAsset: opts.debtAsset,
    marketId: opts.marketId,
  });

  const lines = [
    `🚨 <b>${L(lang, "KRITIKAL: POSISI DI BAWAH TRIGGER", "CRITICAL: POSITION BELOW TRIGGER")}</b>`,
  ];

  if (protocolName) {
    lines.push(`<b>${L(lang, "Protokol", "Protocol")}:</b> <code>${escapeHtml(protocolName)}</code>`);
  }

  lines.push(
    `<b>${L(lang, "Posisi", "Position")}:</b> ${posDisplay}`,
    `<b>HF:</b> <code>${opts.hf.toFixed(2)}</code> &lt;= <code>${opts.triggerHf.toFixed(2)}</code>`,
    L(
      lang,
      "Posisi berada di zona KRITIKAL dan memerlukan intervensi proteksi. Guardian / keeper sedang memproses pelunasan otomatis.",
      "Position is in the CRITICAL zone and needs protection. Guardian / keeper is evaluating an automated repayment action.",
    ),
    "",
    footer(lang),
  );

  return lines.join("\n");
}

export function reserveLowAlert(opts: {
  user: string;
  allowance: bigint;
  balance: bigint;
  cap: bigint;
  decimals?: number;
  symbol?: string;
  protocol?: string;
  debtAsset?: string;
  marketId?: string;
  positionKey?: string;
  lang?: Lang;
}): string {
  const lang = opts.lang ?? "en";
  const userShort = `${opts.user.slice(0, 6)}…${opts.user.slice(-4)}`;
  const sym = opts.symbol ?? (opts.debtAsset ? `${opts.debtAsset.slice(0, 6)}…${opts.debtAsset.slice(-4)}` : "tokens");
  const dec = opts.decimals ?? 6;
  const unit = 10n ** BigInt(dec);
  const minReserve = opts.allowance < opts.balance ? opts.allowance : opts.balance;
  const reserveFmt = (Number(minReserve) / Number(unit)).toFixed(2);
  const capFmt = (Number(opts.cap) / Number(unit)).toFixed(2);
  const protocolName = formatProtocolName(opts.protocol);
  const posDisplay = formatPositionDisplay({
    userShort,
    symbol: opts.symbol,
    debtAsset: opts.debtAsset,
    marketId: opts.marketId,
  });

  const lines = [
    `⚠️ <b>${L(lang, "CADANGAN RESERVOIR RENDAH", "RESERVE CAPACITY LOW")}</b>`,
  ];

  if (protocolName) {
    lines.push(`<b>${L(lang, "Protokol", "Protocol")}:</b> <code>${escapeHtml(protocolName)}</code>`);
  }

  lines.push(
    `<b>${L(lang, "Posisi", "Position")}:</b> ${posDisplay}`,
    `<b>${L(lang, "Tersedia", "Available")}:</b> <code>${reserveFmt} ${escapeHtml(sym)}</code> (Cap: <code>${capFmt} ${escapeHtml(sym)}</code>)`,
    L(
      lang,
      "Kapasitas proteksi (min dari saldo dan allowance) berada di bawah batas satu kali aksi. Isi ulang saldo atau perbarui allowance agar proteksi tetap aktif.",
      "Protection capacity (min of balance and allowance) is below one full action cap. Top up balance or update allowance to ensure continuous protection.",
    ),
    "",
    footer(lang),
  );

  return lines.join("\n");
}

export function protectedExecutionAlert(opts: {
  user: string;
  repaid: bigint;
  hfBefore: bigint;
  hfAfter: bigint;
  caller: string;
  decimals?: number;
  symbol?: string;
  protocol?: string;
  debtAsset?: string;
  marketId?: string;
  positionKey?: string;
  feeAmount?: bigint;
  feeWaived?: bigint;
  feeDecimals?: number;
  feeSymbol?: string;
  lang?: Lang;
}): string {
  const lang = opts.lang ?? "en";
  const userShort = `${opts.user.slice(0, 6)}…${opts.user.slice(-4)}`;
  const callerShort = `${opts.caller.slice(0, 6)}…${opts.caller.slice(-4)}`;
  const sym = opts.symbol ?? (opts.debtAsset ? `${opts.debtAsset.slice(0, 6)}…${opts.debtAsset.slice(-4)}` : "tokens");
  const dec = opts.decimals ?? 6;
  const unit = 10n ** BigInt(dec);
  const repaidFmt = (Number(opts.repaid) / Number(unit)).toFixed(2);
  const hfBeforeFmt = (Number(opts.hfBefore) / 1e18).toFixed(2);
  const hfAfterFmt = (Number(opts.hfAfter) / 1e18).toFixed(2);
  const protocolName = formatProtocolName(opts.protocol);

  const posDisplay = formatPositionDisplay({
    userShort,
    symbol: opts.symbol,
    debtAsset: opts.debtAsset,
    marketId: opts.marketId,
  });

  const lines = [
    `🛡️ <b>${L(lang, "EKSEKUSI PROTEKSI BERHASIL", "PROTECTION EXECUTED")}</b>`,
  ];

  if (protocolName) {
    lines.push(`<b>${L(lang, "Protokol", "Protocol")}:</b> <code>${escapeHtml(protocolName)}</code>`);
  }

  lines.push(
    `<b>${L(lang, "Posisi", "Position")}:</b> ${posDisplay}`,
    `<b>${L(lang, "Pelunasan", "Repaid")}:</b> <code>${repaidFmt} ${escapeHtml(sym)}</code>`,
  );

  // Mention fee if FeeCharged is present
  if (opts.feeAmount !== undefined && opts.feeAmount > 0n) {
    const feeDec = opts.feeDecimals ?? dec;
    const feeUnit = 10n ** BigInt(feeDec);
    const feeFmt = (Number(opts.feeAmount) / Number(feeUnit)).toFixed(4);
    const feeSym = opts.feeSymbol ?? sym;
    let feeLine = `<b>Fee:</b> <code>${feeFmt} ${escapeHtml(feeSym)}</code>`;
    if (opts.feeWaived !== undefined && opts.feeWaived > 0n) {
      const waivedFmt = (Number(opts.feeWaived) / Number(feeUnit)).toFixed(4);
      feeLine += ` (<i>${waivedFmt} waived</i>)`;
    }
    lines.push(feeLine);
  }

  lines.push(
    `<b>Health Factor:</b> <code>${hfBeforeFmt}</code> ➔ <code>${hfAfterFmt}</code>`,
    `<b>${L(lang, "Eksekutor", "Executor")}:</b> <code>${escapeHtml(callerShort)}</code>`,
    "",
    footer(lang),
  );

  return lines.join("\n");
}

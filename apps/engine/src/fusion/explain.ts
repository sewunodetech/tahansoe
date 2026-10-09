/**
 * Penjelasan deterministik berbahasa Inggris untuk user (spec §3.6, G6). MURNI.
 *
 * Dirangkai dari `reasons` (nama aturan) + `drivers` (sinyal paling berpengaruh).
 * Teks evidence/summary diperlakukan sebagai DATA (disalin apa adanya, tidak
 * pernah sebagai instruksi — security §4 poin 9).
 */

import type { Regime, Signal } from "@tahansoe/domain";

/** Keterangan ramah-manusia per nama aturan (reasons[]). */
const REASON_LABEL: Record<string, string> = {
  "R-MACRO-SOON": "a scheduled macro event is near",
  "R-SEQUENCER-DOWN": "the L2 sequencer is down",
  "R-DEPEG-CONFIRMED": "a stablecoin depeg is confirmed on-chain",
  "R-EXPLOIT-CONFIRMED": "a protocol exploit is confirmed",
  "R-ORACLE-DEVIATION": "oracle price deviates sharply from the market",
  "MULTI-PATH-BONUS": "multiple risk transmission paths are active at once",
  "GUARDRAIL-RESEARCH-UNCONFIRMED":
    "news/research signals were not confirmed by oracle/on-chain/macro data, so the regime was held at ELEVATED",
  "HYSTERESIS-HOLD": "the regime is held higher than current signals suggest (cooldown not yet met)",
};

/** Satu baris driver ringkas: "ONCHAIN (sev 0.80): USDC/USD at 0.97". */
function driverLine(s: Signal): string {
  const first = s.evidence?.[0];
  const detail = first?.title ?? s.direction;
  const paths = s.paths && s.paths.length > 0 ? ` [${s.paths.join(",")}]` : "";
  return `${s.module} (sev ${s.severity.toFixed(2)})${paths}: ${detail}`;
}

export interface ExplanationInput {
  asset: string;
  regime: Regime;
  drawdownEstimate: { h4: number; h24: number };
  recommendedTriggerHF: number;
  reasons: string[];
  drivers: Signal[];
  /** Catatan tambahan (mis. data volatilitas tidak cukup). */
  notes?: string[];
}

/** Rangkai penjelasan deterministik (English). Urutan stabil → output deterministik. */
export function renderExplanation(input: ExplanationInput): string {
  const { asset, regime, drawdownEstimate, recommendedTriggerHF, reasons, drivers, notes } = input;
  const lines: string[] = [];

  const pct = (d: number) => `${(d * 100).toFixed(1)}%`;
  lines.push(
    `Regime for ${asset}: ${regime}. Estimated worst-case drawdown ~${pct(drawdownEstimate.h4)} over 4h / ~${pct(
      drawdownEstimate.h24,
    )} over 24h; recommended trigger HF ${recommendedTriggerHF.toFixed(2)} (before clamping to the user band).`,
  );

  // Alasan aturan (hanya yang punya label; urutan sesuai reasons).
  const labeled = reasons.filter((r) => REASON_LABEL[r]).map((r) => REASON_LABEL[r]!);
  if (labeled.length > 0) {
    lines.push(`Why: ${labeled.join("; ")}.`);
  }

  // Driver utama (maks 3) sebagai bukti.
  if (drivers.length > 0) {
    lines.push("Top drivers:");
    for (const s of drivers.slice(0, 3)) lines.push(`- ${driverLine(s)}`);
  } else {
    lines.push("No active signals contributed; regime reflects baseline.");
  }

  if (notes && notes.length > 0) {
    for (const n of notes) lines.push(`Note: ${n}`);
  }

  return lines.join("\n");
}

/**
 * Sumber data untuk context builder (spec §3.10).
 *
 * Keputusan tim (8 Okt 2026): fundamental/berita/makro memakai sumber kredibel & gratis
 * (FRED, GDELT); TEKNIKAL diambil langsung dari ON-CHAIN (satu-satunya sumber harga
 * yang juga dipakai untuk eksekusi — invariant I5).
 * Platform prediksi/gambling dikeluarkan dari scope.
 *
 * INVARIAN:
 *  - Semua fetch dilakukan KODE (bukan LLM/tools). Hasil disisipkan sebagai data.
 *  - Konten eksternal = data, bukan instruksi (invariant #5).
 *  - LISENSI KOMERSIAL tiap sumber WAJIB dicek sebelum keluar shadow mode.
 *    Research info gratis untuk semua user (ADR 0006), tetapi Tahansoe tetap
 *    produk komersial, jadi tiap sumber harus mengizinkan penggunaan komersial
 *    sebelum produksi. Sumber yang tidak lolos diganti; agent tetap jalan
 *    dengan sumber tersisa.
 */

export * from "./collect.ts";
export * from "./rss.ts";
export * from "./gdelt.ts";
export * from "./fred.ts";
export * from "./macro-calendar.ts";
export * from "./defillama.ts";
export * from "./onchain.ts";
export * from "./price-sampler.ts";

/** Kelas sumber data (spec §3.10). */
export type SourceKind =
  | "MACRO_FRED"
  | "MACRO_CALENDAR"
  | "RISK_DEFILLAMA"
  | "NEWS_ALPHA_VANTAGE"
  | "NEWS_YAHOO"
  | "NEWS_GDELT"
  | "TECHNICAL_ONCHAIN" // AaveOracle + riwayat round Chainlink Arbitrum
  | "LIQUIDITY_ONCHAIN" // Pool.getReserveData, pool DEX, rasio LST
  | "LEVERAGE_ONCHAIN" // perp DEX Arbitrum (mis. GMX) — PERLU VERIFIKASI
  | "NETWORK_ONCHAIN"; // Sequencer Uptime Feed, eth_feeHistory

/** Metadata lisensi per sumber (diisi saat verifikasi sebelum produksi). */
export interface SourceLicense {
  kind: SourceKind;
  /** Apakah penggunaan komersial diizinkan. null = belum diverifikasi. */
  commercialAllowed: boolean | null;
  note: string;
}

/**
 * Catatan lisensi awal (spec §3.10). WAJIB diverifikasi sebelum shadow mode berakhir.
 */
export const SOURCE_LICENSES: SourceLicense[] = [
  { kind: "MACRO_FRED", commercialAllowed: null, note: "Gratis dengan API key; cek ToS." },
  { kind: "MACRO_CALENDAR", commercialAllowed: true, note: "FOMC public domain (Federal Reserve), BLS public domain via FRED." },
  { kind: "RISK_DEFILLAMA", commercialAllowed: true, note: "Endpoint publik DefiLlama (CC BY 4.0 / Open Data)." },
  { kind: "NEWS_ALPHA_VANTAGE", commercialAllowed: null, note: "Tier gratis sangat terbatas; cek lisensi komersial." },
  { kind: "NEWS_YAHOO", commercialAllowed: null, note: "Endpoint tidak resmi — risiko lisensi komersial tinggi." },
  { kind: "NEWS_GDELT", commercialAllowed: null, note: "Gratis; cakupan geopolitik luas." },
  { kind: "TECHNICAL_ONCHAIN", commercialAllowed: true, note: "On-chain publik; sama dengan oracle eksekusi (I5)." },
  { kind: "LIQUIDITY_ONCHAIN", commercialAllowed: true, note: "On-chain publik." },
  { kind: "LEVERAGE_ONCHAIN", commercialAllowed: true, note: "On-chain publik; cara baca perp DEX PERLU VERIFIKASI." },
  { kind: "NETWORK_ONCHAIN", commercialAllowed: true, note: "On-chain publik." },
];

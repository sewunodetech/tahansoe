/**
 * Entry point / scheduler research layer (architecture §2, spec §3.2).
 *
 * STATUS: scaffold. Scheduler nyata (tiap 2 jam CALM, 1 jam ≥ ELEVATED, +
 * ESCALATION dgn cooldown) diisi dev. Lapis ini TIDAK di jalur kritis deteksi
 * crash (ADR 0004 §7); kegagalannya tidak boleh menjatuhkan engine.
 */

import { env, config } from "./config.ts";
import { runResearch } from "./agents/run.ts";

/**
 * TODO(dev):
 *  - Baca regime kini per chain untuk memilih interval (schedule di config).
 *  - Daftarkan timer SCHEDULED + hook ESCALATION dari fusion (cooldown 30 menit).
 *  - Panggil runResearch({ trigger, chainId, assets, provider }) per siklus.
 *  - Jadwalkan settlement tiap jam & reflection harian (reflection/*).
 *  - Bungkus semua dalam try/catch; log error tetapi JANGAN crash proses.
 */
export async function start(): Promise<void> {
  if (!env.researchEnabled()) {
    console.log("[engine] RESEARCH_ENABLED=false — lapis riset nonaktif (default).");
    return;
  }
  void config;
  void runResearch;
  throw new Error("[engine] scheduler belum diimplementasikan — lihat TODO (spec §3.2).");
}

// Jalankan jika dieksekusi langsung (node src/index.ts).
if (import.meta.url === `file://${process.argv[1]}`) {
  start().catch((err) => {
    console.error("[engine] gagal start:", err);
    process.exitCode = 1;
  });
}

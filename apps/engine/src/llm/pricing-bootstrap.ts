/**
 * Bootstrap harga runtime untuk budget (cli-fix §2). Memuat harga model dari
 * SUMBER YANG SAMA dengan picker: (1) settings.modelPrices (manual), lalu
 * (2) settings.pricingUrl via pricing cache (src/llm/pricing.ts). Hasilnya
 * dipasang ke budget (`setRuntimePricing`) sehingga `costOf` memberi harga yang
 * benar untuk model gateway (mis. agnes-2.5-flash), bukan fallback konservatif.
 *
 * Dipanggil sekali di awal run NON-FAKE. Gagal muat → diam (budget tetap pakai
 * fallback konservatif + warning sekali per model). Tidak pernah mencetak secret.
 */

import { setRuntimePricing } from "./budget.ts";
import { loadPricing } from "./pricing.ts";
import { loadSettingsSync, gatewayPricingUrl } from "../settings/settings.ts";
import { gatewayConfig } from "./registry.ts";

let loaded = false;

/**
 * Muat harga ke budget. Idempoten (hanya sekali per proses kecuali `force`).
 * Mengembalikan jumlah model yang berhasil diberi harga.
 */
export async function bootstrapBudgetPricing(force = false): Promise<number> {
  if (loaded && !force) return 0;
  loaded = true;
  try {
    const { settings } = loadSettingsSync();
    const manualJson =
      Object.keys(settings.modelPrices).length > 0 ? JSON.stringify(settings.modelPrices) : "";
    const pricingUrl = gatewayPricingUrl(settings) ?? "";
    if (!manualJson && !pricingUrl) return 0;
    const { prices } = await loadPricing({
      apiKey: gatewayConfig().apiKey,
      pricingUrl,
      modelPricesJson: manualJson,
    });
    if (prices.size > 0) setRuntimePricing(prices);
    return prices.size;
  } catch {
    return 0;
  }
}

/** Reset penanda (untuk test). */
export function resetBudgetPricingBootstrap(): void {
  loaded = false;
}

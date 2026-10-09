/**
 * CLI interaktif: pilih model + lihat estimasi biaya, SIMPAN ke settings.json, run.
 *
 *   tsx --env-file-if-exists=.env src/cli/research.ts
 *
 * Hanya berjalan di TTY (butuh input). Non-TTY → cetak pesan bantuan & keluar.
 * Alur:
 *   1. Muat harga + estimasi (profil token dari DB bila ada, selain itu default).
 *   2. Tampilkan 15 model termurah; user bisa ketik nama model lain.
 *   3. Mode: [1] satu model untuk semua peran, [2] analyst+debate murah, assessor lain.
 *   4. Tampilkan estimasi biaya kombinasi.
 *   5. "simpan ke settings.json? (y/n)" → tulis roles.{analyst,debate,assessor,reflector}
 *      secara atomik, TANPA menyentuh field lain, TANPA mencetak secret.
 *   6. Jalankan sekarang: [d] dry-run, [s] simpan ke DB, [n] tidak.
 *
 * JANGAN pernah cetak API key / DATABASE_URL (I8). Memakai alur run yang ada
 * (runResearch dari src/agents/run.ts) — tidak menduplikasi logika.
 */

import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";

import { loadSettingsSync, writeSettings, settingsPath } from "../settings/settings.ts";
import { defaultProviderName } from "../settings/settings.ts";
import type { Settings } from "../settings/schema.ts";
import { loadPricing, type ModelPrice } from "../llm/pricing.ts";
import {
  estimateCost,
  tokenProfileFromDb,
  DEFAULT_TOKEN_PROFILE,
  RUNS_PER_DAY_CALM,
  type TokenProfile,
} from "../llm/estimate.ts";
import { buildRows, formatRows } from "./models.ts";

/**
 * Tulis pilihan model per peran ke settings.json (atomik), tanpa menyentuh field
 * lain (providers/modelPrices/estimate dipertahankan). TIDAK mencetak isi file.
 */
export async function writeRoleModelsToSettings(
  roles: { analyst: string[]; debate: string[]; assessor: string[]; reflector: string[] },
  path: string = settingsPath(),
): Promise<void> {
  const { settings } = loadSettingsSync(path);
  const next: Settings = {
    ...settings,
    roles: {
      ...settings.roles,
      analyst: roles.analyst,
      debate: roles.debate,
      assessor: roles.assessor,
      reflector: roles.reflector,
    },
  };
  await writeSettings(next, path);
}

/** Spec "provider:model" (provider = default dari settings bila ada). */
function specFor(provider: string, model: string): string {
  return `${provider}:${model}`;
}

function usd(n: number): string {
  return `$${n.toFixed(n < 1 ? 4 : 2)}`;
}

/** Estimasi kombinasi 2-model (analyst+debate pakai modelA, assessor modelB). */
function comboEstimate(
  prices: Map<string, ModelPrice>,
  modelA: string,
  modelB: string,
  profile: TokenProfile,
): { perRunUsd: number; perMonthUsd: number } | null {
  const pa = prices.get(modelA);
  const pb = prices.get(modelB);
  if (!pa || !pb) return null;
  const assessorIn = 9000;
  const assessorOut = 1700;
  const restIn = Math.max(0, profile.inputTokens - assessorIn);
  const restOut = Math.max(0, profile.outputTokens - assessorOut);
  const eA = estimateCost(pa, { inputTokens: restIn, outputTokens: restOut, source: "" });
  const eB = estimateCost(pb, { inputTokens: assessorIn, outputTokens: assessorOut, source: "" });
  const perRunUsd = eA.perRunUsd + eB.perRunUsd;
  return { perRunUsd, perMonthUsd: perRunUsd * RUNS_PER_DAY_CALM * 30 };
}

/** Muat harga dari semua provider settings yang punya pricingUrl + modelPrices manual. */
async function loadAllPricing(): Promise<{ prices: Map<string, ModelPrice>; provider: string | null }> {
  const { settings } = loadSettingsSync();
  const prices = new Map<string, ModelPrice>();
  const manualJson = Object.keys(settings.modelPrices).length > 0 ? JSON.stringify(settings.modelPrices) : "";
  let manualApplied = false;
  for (const [, p] of Object.entries(settings.providers)) {
    if (!p.pricingUrl && !manualJson) continue;
    const apiKey = p.apiKeyEnv ? (process.env[p.apiKeyEnv]?.trim() ?? "") : "";
    const { prices: pr, warnings } = await loadPricing({
      apiKey,
      pricingUrl: p.pricingUrl ?? "",
      modelPricesJson: manualApplied ? "" : manualJson,
    });
    manualApplied = true;
    for (const [m, price] of pr) prices.set(m, price);
    for (const w of warnings) console.error(w);
  }
  // Bila tidak ada provider di settings, coba env lama (loadPricing default membaca env).
  if (prices.size === 0) {
    const { prices: pr, warnings } = await loadPricing({ modelPricesJson: manualJson });
    for (const [m, price] of pr) prices.set(m, price);
    for (const w of warnings) console.error(w);
  }
  return { prices, provider: defaultProviderName(settings) };
}

async function main(): Promise<void> {
  if (!process.stdin.isTTY) {
    console.log(
      [
        "research.ts interaktif butuh TTY (terminal).",
        "Jalankan langsung di terminal:",
        "  npm run research:pick      (atau)",
        "  tsx --env-file-if-exists=.env src/cli/research.ts",
        "",
        "Untuk melihat daftar model + harga tanpa interaksi:",
        "  tsx --env-file-if-exists=.env src/cli/models.ts --filter flash",
        "",
        "Konfigurasi provider/model ada di settings.json (lihat: src/cli/settings.ts show).",
      ].join("\n"),
    );
    return;
  }

  const { prices, provider } = await loadAllPricing();
  if (prices.size === 0) {
    console.error("Tidak ada harga dimuat (set pricingUrl provider di settings.json atau modelPrices). Keluar.");
    process.exitCode = 1;
    return;
  }
  const providerName = provider ?? "custom";

  const dbProfile = await tokenProfileFromDb(5);
  const profile = dbProfile ?? DEFAULT_TOKEN_PROFILE;

  const rows = buildRows(prices, null, profile);
  const top = rows.filter((r) => r.estimate).slice(0, 15);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log(formatRows(top, profile));
    console.log("");

    const mode = (await rl.question("Mode — [1] satu model untuk semua peran, [2] analyst+debate murah + assessor model lain: ")).trim();

    let analyst: string, debate: string, assessor: string, reflector: string;

    if (mode === "2") {
      const cheap = (await rl.question(`Model MURAH untuk analyst+debate+reflector (default ${top[0]?.model ?? ""}): `)).trim() || (top[0]?.model ?? "");
      const strong = (await rl.question("Model untuk ASSESSOR (ketik nama): ")).trim();
      if (!prices.has(cheap) || !prices.has(strong)) {
        console.error("Model tidak dikenal dalam daftar harga. Keluar.");
        process.exitCode = 1;
        return;
      }
      analyst = debate = reflector = specFor(providerName, cheap);
      assessor = specFor(providerName, strong);
      const combo = comboEstimate(prices, cheap, strong, profile);
      if (combo) console.log(`\nEstimasi kombinasi: ${usd(combo.perRunUsd)}/run · ${usd(combo.perMonthUsd)}/bulan (${RUNS_PER_DAY_CALM} run/hari CALM).`);
    } else {
      const one = (await rl.question(`Satu model untuk semua peran (default ${top[0]?.model ?? ""}): `)).trim() || (top[0]?.model ?? "");
      if (!prices.has(one)) {
        console.error("Model tidak dikenal dalam daftar harga. Keluar.");
        process.exitCode = 1;
        return;
      }
      analyst = debate = assessor = reflector = specFor(providerName, one);
      const e = estimateCost(prices.get(one)!, profile);
      console.log(`\nEstimasi: ${usd(e.perRunUsd)}/run · ${usd(e.perDayUsd)}/hari · ${usd(e.perMonthUsd)}/bulan.`);
      if (prices.get(one)!.reasoning) console.log("Catatan: model reasoning — output token bisa lebih besar dari estimasi.");
    }

    const save = (await rl.question("\nSimpan ke settings.json? (y/n): ")).trim().toLowerCase();
    if (save === "y" || save === "yes") {
      await writeRoleModelsToSettings({
        analyst: [analyst],
        debate: [debate],
        assessor: [assessor],
        reflector: [reflector],
      });
      console.log(`Tersimpan ke ${settingsPath()} (roles.analyst/debate/assessor/reflector).`);
    }

    const run = (await rl.question("\nJalankan sekarang? [d] dry-run · [s] simpan ke DB · [n] tidak: ")).trim().toLowerCase();
    if (run === "d" || run === "s") {
      if (run === "s") process.env.RESEARCH_ENABLED = "true";
      const { runResearch } = await import("../agents/run.ts");
      rl.close();
      const result = await runResearch({
        trigger: "SCHEDULED",
        chainId: 42161,
        assets: ["ETH", "USDC"],
        dry: run === "d",
      });
      if (!result.report) {
        console.error(`Run menghasilkan null. Alasan: ${result.reason ?? "tidak diketahui"}`);
        process.exitCode = 1;
        return;
      }
      console.log(`Run selesai (regime=${result.report.proposedRegime}). Output: ${result.outDir ?? "(DB)"}`);
      return;
    }
    console.log("Selesai (tanpa menjalankan run).");
  } finally {
    rl.close();
  }
}

const invoked = process.argv[1];
if (invoked && import.meta.url === pathToFileURL(invoked).href) {
  main().catch((err) => {
    console.error("[engine] research CLI gagal:", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}

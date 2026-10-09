/**
 * CLI interaktif: pilih model + lihat estimasi biaya, simpan ke .env, lalu jalankan.
 *
 *   tsx --env-file-if-exists=.env src/cli/research.ts
 *
 * Hanya berjalan di TTY (butuh input). Non-TTY → cetak pesan bantuan & keluar.
 * Alur:
 *   1. Muat harga + estimasi (profil token dari DB bila ada, selain itu default).
 *   2. Tampilkan 15 model termurah; user bisa ketik nama model lain.
 *   3. Mode: [1] satu model untuk semua peran, [2] analyst+debate murah, assessor lain.
 *   4. Tampilkan estimasi biaya kombinasi.
 *   5. "simpan ke .env? (y/n)" → tulis LLM_ANALYST/DEBATE/ASSESSOR/REFLECTOR
 *      TANPA menyentuh baris lain, TANPA mencetak secret.
 *   6. Jalankan sekarang: [d] dry-run, [s] simpan ke DB, [n] tidak.
 *
 * JANGAN pernah cetak API key / DATABASE_URL (I8). Memakai alur run yang ada
 * (runResearch dari src/agents/run.ts) — tidak menduplikasi logika.
 */

import { createInterface } from "node:readline/promises";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

import { env } from "../config.ts";
import { loadPricing, type ModelPrice } from "../llm/pricing.ts";
import {
  estimateCost,
  tokenProfileFromDb,
  DEFAULT_TOKEN_PROFILE,
  RUNS_PER_DAY_CALM,
  type TokenProfile,
} from "../llm/estimate.ts";
import { buildRows, formatRows } from "./models.ts";
import { applyEnvUpdates } from "./env-writer.ts";

/** Path apps/engine/.env (di root paket engine). */
function engineEnvPath(): string {
  const here = dirname(fileURLToPath(import.meta.url)); // src/cli
  return join(here, "..", "..", ".env"); // apps/engine/.env
}

/**
 * Tulis pilihan model per peran ke .env tanpa menyentuh baris lain. Membaca file
 * lama bila ada, menerapkan update, menulis kembali. TIDAK mencetak isi file.
 */
export async function writeRoleModelsToEnv(
  envPath: string,
  roles: { analyst: string; debate: string; assessor: string; reflector: string },
): Promise<void> {
  let existing = "";
  try {
    existing = await readFile(envPath, "utf8");
  } catch {
    existing = ""; // file belum ada → buat baru
  }
  const updated = applyEnvUpdates(existing, {
    LLM_ANALYST: roles.analyst,
    LLM_DEBATE: roles.debate,
    LLM_ASSESSOR: roles.assessor,
    LLM_REFLECTOR: roles.reflector,
  });
  await writeFile(envPath, updated, "utf8");
}

/** Prefix provider generik untuk spec per peran (mis. "custom:deepseek-v4.1-flash"). */
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
  // Pisahkan profil: assessor ~ (9000 in / 1700 out) dari profil default; sisanya
  // (analyst+debate) = total - assessor. Pakai proporsi default untuk estimasi.
  const assessorIn = 9000;
  const assessorOut = 1700;
  const restIn = Math.max(0, profile.inputTokens - assessorIn);
  const restOut = Math.max(0, profile.outputTokens - assessorOut);
  const eA = estimateCost(pa, { inputTokens: restIn, outputTokens: restOut, source: "" });
  const eB = estimateCost(pb, { inputTokens: assessorIn, outputTokens: assessorOut, source: "" });
  const perRunUsd = eA.perRunUsd + eB.perRunUsd;
  return { perRunUsd, perMonthUsd: perRunUsd * RUNS_PER_DAY_CALM * 30 };
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
      ].join("\n"),
    );
    return;
  }

  const provider = env.llmProviderName();
  const { prices, warnings } = await loadPricing();
  for (const w of warnings) console.error(w);
  if (prices.size === 0) {
    console.error("Tidak ada harga dimuat (set LLM_PRICING_URL atau LLM_MODEL_PRICES). Keluar.");
    process.exitCode = 1;
    return;
  }

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
      analyst = debate = reflector = specFor(provider, cheap);
      assessor = specFor(provider, strong);
      const combo = comboEstimate(prices, cheap, strong, profile);
      if (combo) console.log(`\nEstimasi kombinasi: ${usd(combo.perRunUsd)}/run · ${usd(combo.perMonthUsd)}/bulan (${RUNS_PER_DAY_CALM} run/hari CALM).`);
    } else {
      const one = (await rl.question(`Satu model untuk semua peran (default ${top[0]?.model ?? ""}): `)).trim() || (top[0]?.model ?? "");
      if (!prices.has(one)) {
        console.error("Model tidak dikenal dalam daftar harga. Keluar.");
        process.exitCode = 1;
        return;
      }
      analyst = debate = assessor = reflector = specFor(provider, one);
      const e = estimateCost(prices.get(one)!, profile);
      console.log(`\nEstimasi: ${usd(e.perRunUsd)}/run · ${usd(e.perDayUsd)}/hari · ${usd(e.perMonthUsd)}/bulan.`);
      if (prices.get(one)!.reasoning) console.log("Catatan: model reasoning — output token bisa lebih besar dari estimasi.");
    }

    const save = (await rl.question("\nSimpan ke .env? (y/n): ")).trim().toLowerCase();
    if (save === "y" || save === "yes") {
      await writeRoleModelsToEnv(engineEnvPath(), { analyst, debate, assessor, reflector });
      console.log("Tersimpan ke apps/engine/.env (LLM_ANALYST/DEBATE/ASSESSOR/REFLECTOR).");
    }

    const run = (await rl.question("\nJalankan sekarang? [d] dry-run · [s] simpan ke DB · [n] tidak: ")).trim().toLowerCase();
    if (run === "d" || run === "s") {
      // Pakai pilihan ini untuk run saat ini (env proses) agar router memakainya.
      process.env.LLM_ANALYST = analyst;
      process.env.LLM_DEBATE = debate;
      process.env.LLM_ASSESSOR = assessor;
      process.env.LLM_REFLECTOR = reflector;
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

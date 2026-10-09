/**
 * CLI: daftar model + harga + estimasi biaya research run.
 *
 *   tsx --env-file-if-exists=.env src/cli/models.ts [--filter <teks>]
 *
 * Sumber model: `GET {LLM_BASE_URL}/models` (dengan API key bila ada). Bila gagal
 * atau tak ada base URL, pakai daftar dari pricing (LLM_PRICING_URL / LLM_MODEL_PRICES).
 * Model digabung dengan harga; estimasi biaya per run / per hari (12 run CALM) /
 * per bulan dalam USD (dan IDR bila sumber harga IDR). Diurutkan termurah dulu.
 *
 * Catatan: model "reasoning" bisa memakai output token lebih banyak dari profil.
 * JANGAN pernah cetak API key / DATABASE_URL (I8).
 */

import { pathToFileURL } from "node:url";
import { normalizeBaseUrl, gatewayConfig } from "../llm/registry.ts";
import { loadPricing, type ModelPrice, type FetchLike, type PricingCacheStore } from "../llm/pricing.ts";
import { loadSettingsSync, gatewayPricingUrl } from "../settings/settings.ts";
import {
  estimateCost,
  tokenProfileFromDb,
  DEFAULT_TOKEN_PROFILE,
  RUNS_PER_DAY_CALM,
  type TokenProfile,
  type CostEstimate,
} from "../llm/estimate.ts";

/** Satu baris tabel model. */
export interface ModelRow {
  model: string;
  price?: ModelPrice;
  estimate?: CostEstimate;
  reasoning?: boolean;
  maxContextTokens?: number;
}

/** Ambil daftar id model dari {base}/models (OpenAI-compatible). Error → null. */
export async function fetchModelList(
  baseURL: string,
  apiKey: string,
  fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
): Promise<string[] | null> {
  if (!baseURL) return null;
  const url = `${normalizeBaseUrl(baseURL)}/models`;
  try {
    const headers: Record<string, string> = { accept: "application/json" };
    if (apiKey) headers["authorization"] = `Bearer ${apiKey}`;
    const res = await fetchImpl(url, { method: "GET", headers });
    if (!res.ok) return null;
    const payload = (await res.json()) as { data?: Array<{ id?: unknown }> };
    if (!Array.isArray(payload.data)) return null;
    const ids = payload.data
      .map((m) => (typeof m.id === "string" ? m.id : null))
      .filter((x): x is string => x !== null);
    return ids.length > 0 ? ids : null;
  } catch {
    return null;
  }
}

/**
 * Bangun daftar baris model dari pricing + (opsional) daftar model endpoint.
 * Model dengan harga diestimasi; tanpa harga tetap ditampilkan (estimate undefined).
 * Diurutkan: ada-estimasi termurah dulu, lalu tanpa-harga (alfabet).
 */
export function buildRows(
  prices: Map<string, ModelPrice>,
  modelIds: string[] | null,
  profile: TokenProfile,
): ModelRow[] {
  // Union model: dari endpoint (bila ada) + semua yang punya harga.
  const names = new Set<string>();
  if (modelIds) for (const id of modelIds) names.add(id);
  for (const m of prices.keys()) names.add(m);

  const rows: ModelRow[] = [];
  for (const model of names) {
    const price = prices.get(model);
    rows.push({
      model,
      price,
      estimate: price ? estimateCost(price, profile) : undefined,
      reasoning: price?.reasoning,
      maxContextTokens: price?.maxContextTokens,
    });
  }

  rows.sort((a, b) => {
    const ae = a.estimate?.perRunUsd;
    const be = b.estimate?.perRunUsd;
    if (ae != null && be != null) return ae - be;
    if (ae != null) return -1;
    if (be != null) return 1;
    return a.model.localeCompare(b.model);
  });
  return rows;
}

function usd(n: number): string {
  return `$${n.toFixed(n < 1 ? 4 : 2)}`;
}
function idr(n: number): string {
  return `Rp${Math.round(n).toLocaleString("id-ID")}`;
}

/** Render tabel teks (deterministik) untuk CLI. */
export function formatRows(rows: ModelRow[], profile: TokenProfile): string {
  const lines: string[] = [];
  lines.push(
    `Profil token/run: ${profile.inputTokens} in / ${profile.outputTokens} out — ${profile.source}`,
  );
  lines.push(
    `Estimasi: per run | per hari (${RUNS_PER_DAY_CALM} run CALM) | per bulan (30 hari). "R"=reasoning (output bisa lebih besar).`,
  );
  lines.push("");
  const header = "model                                    | run       | day       | month     | ctx     | R";
  lines.push(header);
  lines.push("-".repeat(header.length));
  for (const r of rows) {
    const name = r.model.length > 40 ? r.model.slice(0, 39) + "…" : r.model.padEnd(40);
    if (!r.estimate) {
      lines.push(`${name} | (no price)                                  |         | ${r.reasoning ? "R" : " "}`);
      continue;
    }
    const e = r.estimate;
    const run = usd(e.perRunUsd).padStart(9);
    const day = usd(e.perDayUsd).padStart(9);
    const month = usd(e.perMonthUsd).padStart(9);
    const ctx = (r.maxContextTokens ? `${Math.round(r.maxContextTokens / 1000)}k` : "-").padStart(7);
    const flag = r.reasoning ? "R" : " ";
    lines.push(`${name} | ${run} | ${day} | ${month} | ${ctx} | ${flag}`);
    if (e.idr) {
      lines.push(
        `${" ".repeat(40)} | ${idr(e.idr.perRunIdr).padStart(9)} | ${idr(e.idr.perDayIdr).padStart(9)} | ${idr(e.idr.perMonthIdr).padStart(9)} | (IDR)`,
      );
    }
  }
  return lines.join("\n");
}

/**
 * Logika utama (dipisah agar bisa diuji dengan fetch injectable).
 *
 * Sumber: satu gateway (LLM_API_URL + LLM_API_KEY). Harga dari pricingUrl di
 * settings (format Bynara/OpenRouter) + harga manual settings.modelPrices (menimpa).
 * Daftar model dari `{gateway}/models`.
 */
export async function runModelsCli(args: {
  filter?: string;
  /** Override langsung (test). */
  baseURL?: string;
  apiKey?: string;
  pricingUrl?: string;
  modelPricesJson?: string;
  fetchImpl?: FetchLike;
  cache?: PricingCacheStore;
  profile?: TokenProfile;
}): Promise<{ output: string; warnings: string[] }> {
  const fetchImpl = args.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const warnings: string[] = [];

  const { settings } = loadSettingsSync();
  const g = gatewayConfig();
  const baseURL = args.baseURL ?? g.baseURL;
  const apiKey = args.apiKey ?? g.apiKey;
  const pricingUrl = args.pricingUrl ?? gatewayPricingUrl(settings) ?? "";
  const manualJson =
    args.modelPricesJson ??
    (Object.keys(settings.modelPrices).length > 0 ? JSON.stringify(settings.modelPrices) : "");

  // Harga: dari pricingUrl + manual (manual menimpa).
  const { prices, warnings: w } = await loadPricing({
    apiKey,
    fetchImpl,
    cache: args.cache,
    pricingUrl,
    modelPricesJson: manualJson,
  });
  warnings.push(...w);

  // Daftar model dari gateway /models (bila base URL ada).
  const modelIds = baseURL ? await fetchModelList(baseURL, apiKey, fetchImpl) : null;

  const profile = args.profile ?? DEFAULT_TOKEN_PROFILE;
  let rows = buildRows(prices, modelIds, profile);

  if (args.filter) {
    const f = args.filter.toLowerCase();
    rows = rows.filter((r) => r.model.toLowerCase().includes(f));
  }

  const lines: string[] = [];
  if (modelIds) lines.push(`Model dari endpoint: ${modelIds.length}. Dengan harga: ${rows.filter((r) => r.estimate).length}.`);
  else lines.push(`(endpoint /models tidak tersedia — daftar dari pricing)`);
  if (prices.size === 0) lines.push("(tidak ada harga dimuat — set pricingUrl di settings.json atau modelPrices)");
  lines.push("");
  lines.push(formatRows(rows, profile));

  return { output: lines.join("\n"), warnings };
}

async function main(argv: string[]): Promise<void> {
  const fi = argv.indexOf("--filter");
  const filter = fi >= 0 ? argv[fi + 1] : process.env.npm_config_filter;

  // Profil token: dari DB bila tersedia, selain itu default.
  const dbProfile = await tokenProfileFromDb(5);
  const profile = dbProfile ?? DEFAULT_TOKEN_PROFILE;

  const { output, warnings } = await runModelsCli({ filter, profile });
  for (const w of warnings) console.error(w);
  console.log(output);
}

const invoked = process.argv[1];
if (invoked && import.meta.url === pathToFileURL(invoked).href) {
  main(process.argv.slice(2)).catch((err) => {
    console.error("[engine] models CLI gagal:", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}

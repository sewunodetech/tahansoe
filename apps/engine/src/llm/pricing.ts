/**
 * Harga model LLM runtime (opsional) untuk provider OpenAI-compatible generik.
 *
 * Sumber (digabung, prioritas: manual > remote):
 *  (a) LLM_MODEL_PRICES — JSON manual, USD per 1 juta token:
 *        {"model":{"inputPerM":0.3,"outputPerM":1.2}}
 *  (b) LLM_PRICING_URL — dua format dideteksi otomatis:
 *      - Bynara  (`GET https://router.bynara.id/api/pricing`): credit per 1k token
 *        (credit = IDR), + `usd_to_idr` untuk konversi. Simpan juga nilai IDR asli
 *        agar bisa ditampilkan. Field: alias, input_credit_per_1k,
 *        output_credit_per_1k, reasoning, max_context_tokens.
 *      - OpenRouter (`GET /api/v1/models`): pricing.prompt/completion dalam USD
 *        PER TOKEN (dikali 1e6 → per 1M).
 *
 * Gagal fetch / parse TIDAK meng-crash: kembalikan apa yang bisa dimuat + daftar
 * warning. Modul ini murni data (tanpa efek on-chain, tanpa secret di log).
 *
 * JANGAN pernah log API key (I8). Konten remote diperlakukan sebagai DATA.
 */

import { env } from "../config.ts";

/** Harga satu model dalam USD per 1 juta token (+ info harga asli opsional). */
export interface ModelPrice {
  /** USD per 1 juta token input. */
  inputPerM: number;
  /** USD per 1 juta token output. */
  outputPerM: number;
  /** Harga asli dalam mata uang sumber (ditampilkan apa adanya), bila bukan USD. */
  native?: {
    currency: "IDR";
    inputPerM: number;
    outputPerM: number;
    /** Kurs USD→mata uang asli yang dipakai konversi. */
    usdToNative: number;
  };
  /** True bila model "reasoning" (bisa memakan output token lebih banyak). */
  reasoning?: boolean;
  /** Konteks maksimum (token), bila diketahui. */
  maxContextTokens?: number;
  /** Dari mana harga ini: "manual" | "bynara" | "openrouter". */
  source?: string;
}

/** Hasil loadPricing: peta model→harga + warning (tanpa crash). */
export interface PricingResult {
  prices: Map<string, ModelPrice>;
  warnings: string[];
}

/** Fetch injectable agar test offline. */
export type FetchLike = (url: string, init?: unknown) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

/**
 * Muat harga dari manual JSON (LLM_MODEL_PRICES) + remote (LLM_PRICING_URL).
 * Manual menimpa remote untuk model yang sama. Tidak pernah throw.
 */
export async function loadPricing(opts?: {
  pricingUrl?: string;
  modelPricesJson?: string;
  apiKey?: string;
  fetchImpl?: FetchLike;
}): Promise<PricingResult> {
  const pricingUrl = opts?.pricingUrl ?? env.llmPricingUrl();
  const modelPricesJson = opts?.modelPricesJson ?? env.llmModelPricesJson();
  const apiKey = opts?.apiKey ?? env.llmApiKey();
  const fetchImpl = opts?.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);

  const prices = new Map<string, ModelPrice>();
  const warnings: string[] = [];

  // Remote dulu, lalu manual menimpa (manual = sumber kebenaran operator).
  if (pricingUrl.trim()) {
    try {
      const remote = await fetchPricing(pricingUrl.trim(), apiKey, fetchImpl);
      for (const [model, price] of remote.prices) prices.set(model, price);
      warnings.push(...remote.warnings);
    } catch (err) {
      warnings.push(
        `[pricing] gagal memuat LLM_PRICING_URL: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (modelPricesJson.trim()) {
    const manual = parseManualPrices(modelPricesJson.trim());
    for (const [model, price] of manual.prices) prices.set(model, price);
    warnings.push(...manual.warnings);
  }

  return { prices, warnings };
}

/** Parse LLM_MODEL_PRICES (JSON manual, USD per 1M token). Tidak throw. */
export function parseManualPrices(json: string): PricingResult {
  const prices = new Map<string, ModelPrice>();
  const warnings: string[] = [];
  let obj: unknown;
  try {
    obj = JSON.parse(json);
  } catch (err) {
    warnings.push(`[pricing] LLM_MODEL_PRICES bukan JSON valid: ${err instanceof Error ? err.message : String(err)}`);
    return { prices, warnings };
  }
  if (!obj || typeof obj !== "object") {
    warnings.push("[pricing] LLM_MODEL_PRICES harus objek {model:{inputPerM,outputPerM}}");
    return { prices, warnings };
  }
  for (const [model, raw] of Object.entries(obj as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") {
      warnings.push(`[pricing] harga manual "${model}" dilewati (bukan objek)`);
      continue;
    }
    const r = raw as Record<string, unknown>;
    const inputPerM = Number(r.inputPerM);
    const outputPerM = Number(r.outputPerM);
    if (!Number.isFinite(inputPerM) || !Number.isFinite(outputPerM)) {
      warnings.push(`[pricing] harga manual "${model}" dilewati (inputPerM/outputPerM bukan angka)`);
      continue;
    }
    prices.set(model, {
      inputPerM,
      outputPerM,
      reasoning: r.reasoning === true,
      maxContextTokens: Number.isFinite(Number(r.maxContextTokens)) ? Number(r.maxContextTokens) : undefined,
      source: "manual",
    });
  }
  return { prices, warnings };
}

/** Ambil harga dari remote URL; deteksi format dari bentuk payload. */
async function fetchPricing(url: string, apiKey: string, fetchImpl: FetchLike): Promise<PricingResult> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (apiKey) headers["authorization"] = `Bearer ${apiKey}`;
  const res = await fetchImpl(url, { method: "GET", headers });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const payload = (await res.json()) as unknown;
  return parsePricingPayload(payload);
}

/**
 * Deteksi format dan parse payload harga.
 *  - Bynara: {"data":[{alias,input_credit_per_1k,output_credit_per_1k,...}],"usd_to_idr":N}
 *  - OpenRouter: {"data":[{id,pricing:{prompt,completion}}]}
 * Tidak throw: payload tak dikenal → warning.
 */
export function parsePricingPayload(payload: unknown): PricingResult {
  const prices = new Map<string, ModelPrice>();
  const warnings: string[] = [];

  if (!payload || typeof payload !== "object") {
    warnings.push("[pricing] payload harga bukan objek JSON");
    return { prices, warnings };
  }
  const p = payload as Record<string, unknown>;
  const data = p.data;
  if (!Array.isArray(data)) {
    warnings.push("[pricing] payload harga tidak memiliki array 'data'");
    return { prices, warnings };
  }

  // Deteksi Bynara: ada usd_to_idr DAN item punya input_credit_per_1k.
  const usdToIdr = Number(p.usd_to_idr);
  const first = data[0] as Record<string, unknown> | undefined;
  const isBynara =
    Number.isFinite(usdToIdr) &&
    usdToIdr > 0 &&
    first != null &&
    ("input_credit_per_1k" in first || "alias" in first);

  if (isBynara) {
    return parseBynara(data as Array<Record<string, unknown>>, usdToIdr);
  }

  // Deteksi OpenRouter: item punya `pricing.prompt`/`pricing.completion`.
  const isOpenRouter = first != null && first.pricing != null && typeof first.pricing === "object";
  if (isOpenRouter) {
    return parseOpenRouter(data as Array<Record<string, unknown>>);
  }

  warnings.push("[pricing] format payload harga tidak dikenali (bukan Bynara / OpenRouter)");
  return { prices, warnings };
}

/**
 * Parse Bynara: credit per 1k token = IDR per 1k token. Per 1M = credit * 1000.
 * USD per 1M = (credit * 1000) / usd_to_idr. Simpan juga nilai IDR asli.
 */
export function parseBynara(data: Array<Record<string, unknown>>, usdToIdr: number): PricingResult {
  const prices = new Map<string, ModelPrice>();
  const warnings: string[] = [];
  if (!Number.isFinite(usdToIdr) || usdToIdr <= 0) {
    warnings.push("[pricing] Bynara: usd_to_idr tidak valid; harga dilewati");
    return { prices, warnings };
  }
  for (const item of data) {
    const alias = typeof item.alias === "string" ? item.alias : undefined;
    if (!alias) continue;
    const inCredit = Number(item.input_credit_per_1k);
    const outCredit = Number(item.output_credit_per_1k);
    if (!Number.isFinite(inCredit) || !Number.isFinite(outCredit)) {
      warnings.push(`[pricing] Bynara: "${alias}" dilewati (credit bukan angka)`);
      continue;
    }
    // credit per 1k (IDR) → per 1M (IDR) → USD.
    const idrInputPerM = inCredit * 1000;
    const idrOutputPerM = outCredit * 1000;
    prices.set(alias, {
      inputPerM: idrInputPerM / usdToIdr,
      outputPerM: idrOutputPerM / usdToIdr,
      native: { currency: "IDR", inputPerM: idrInputPerM, outputPerM: idrOutputPerM, usdToNative: usdToIdr },
      reasoning: item.reasoning === true,
      maxContextTokens: Number.isFinite(Number(item.max_context_tokens))
        ? Number(item.max_context_tokens)
        : undefined,
      source: "bynara",
    });
  }
  return { prices, warnings };
}

/** Parse OpenRouter: pricing.prompt/completion dalam USD PER TOKEN → per 1M. */
export function parseOpenRouter(data: Array<Record<string, unknown>>): PricingResult {
  const prices = new Map<string, ModelPrice>();
  const warnings: string[] = [];
  for (const item of data) {
    const id = typeof item.id === "string" ? item.id : typeof item.name === "string" ? item.name : undefined;
    if (!id) continue;
    const pricing = item.pricing as Record<string, unknown> | undefined;
    if (!pricing) continue;
    const promptPerTok = Number(pricing.prompt);
    const completionPerTok = Number(pricing.completion);
    if (!Number.isFinite(promptPerTok) || !Number.isFinite(completionPerTok)) {
      warnings.push(`[pricing] OpenRouter: "${id}" dilewati (pricing bukan angka)`);
      continue;
    }
    const ctx = (item.context_length ?? item.top_provider) as unknown;
    prices.set(id, {
      inputPerM: promptPerTok * 1_000_000,
      outputPerM: completionPerTok * 1_000_000,
      maxContextTokens: Number.isFinite(Number(ctx)) ? Number(ctx) : undefined,
      source: "openrouter",
    });
  }
  return { prices, warnings };
}

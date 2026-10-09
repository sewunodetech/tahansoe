/**
 * Registry provider LLM + router per peran dengan fallback berantai (ADR 0008).
 *
 * - `providerAvailability()` menentukan provider mana yang punya kredensial.
 * - `parseRoleSpec("provider:model,provider:model")` → daftar entri terurut.
 * - `defaultSpecFor(role)` memberi default bila env kosong.
 * - `RoleRouter` membungkus daftar entri menjadi satu LlmProvider: mencoba entri
 *   pertama, lalu fallback ke berikutnya pada error retryable; error non-retryable
 *   (400/401/403) dicatat jelas dan TIDAK diulang ke provider yang sama.
 *
 * JANGAN pernah log API key (I8). Provider tanpa key = tidak tersedia (bukan crash).
 */

import type { LlmProvider, LlmRequest, LlmResult } from "./provider.ts";
import { isNonRetryableStatus } from "./provider.ts";
import { OpenAICompatibleProvider, type FetchLike } from "./openai-compatible.ts";
import { AnthropicProvider } from "./anthropic.ts";
import { budget as defaultBudget, type Budget } from "./budget.ts";
import { env } from "../config.ts";

/**
 * Nama provider. Built-in: anthropic, gemini, openrouter, groq, ollama. Provider
 * OpenAI-compatible GENERIK dari env: nama dari LLM_PROVIDER_NAME (default "custom")
 * untuk LLM_BASE_URL, ditambah LLM_PROVIDER_<NAMA>_BASE_URL/_API_KEY.
 */
export type ProviderName = string;

export type Role = "analyst" | "debate" | "assessor" | "reflector";

/** Satu entri pilihan: provider + model. */
export interface RoleEntry {
  provider: ProviderName;
  model: string;
}

const BUILTIN_PROVIDERS = ["anthropic", "gemini", "openrouter", "groq", "ollama"] as const;

/** Base URL OpenAI-compatible untuk provider built-in (ADR 0008 §2). */
const BUILTIN_BASE_URL: Record<string, () => string> = {
  gemini: () => "https://generativelanguage.googleapis.com/v1beta/openai/",
  openrouter: () => "https://openrouter.ai/api/v1",
  groq: () => "https://api.groq.com/openai/v1",
  ollama: () => env.ollamaBaseUrl(),
};

/**
 * Normalisasi base URL OpenAI-compatible: user boleh menulis URL endpoint lengkap
 * (".../v1/chat/completions") atau base (".../v1"); keduanya → ".../v1".
 */
export function normalizeBaseUrl(url: string): string {
  return url
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/chat\/completions$/i, "")
    .replace(/\/+$/, "");
}

/** Provider generik yang dikonfigurasi lewat env: nama → {baseURL, apiKey}. */
export function customProviders(
  envVars: Record<string, string | undefined> = process.env,
): Record<string, { baseURL: string; apiKey: string }> {
  const out: Record<string, { baseURL: string; apiKey: string }> = {};
  const base = envVars.LLM_BASE_URL?.trim();
  if (base) {
    const name = (envVars.LLM_PROVIDER_NAME ?? "custom").trim().toLowerCase() || "custom";
    out[name] = { baseURL: normalizeBaseUrl(base), apiKey: envVars.LLM_API_KEY?.trim() ?? "" };
  }
  for (const [key, value] of Object.entries(envVars)) {
    const m = /^LLM_PROVIDER_([A-Z0-9_]+)_BASE_URL$/.exec(key);
    if (!m || !value?.trim()) continue;
    const name = m[1]!.toLowerCase();
    out[name] = {
      baseURL: normalizeBaseUrl(value),
      apiKey: envVars[`LLM_PROVIDER_${m[1]}_API_KEY`]?.trim() ?? "",
    };
  }
  return out;
}

/** Nama provider generik default (untuk LLM_BASE_URL), atau null bila tidak diset. */
export function defaultCustomProvider(): string | null {
  return env.llmBaseUrl().trim() ? env.llmProviderName() : null;
}

/** Base URL untuk provider apa pun (custom lebih dulu, lalu built-in). */
export function baseUrlFor(provider: ProviderName): string {
  const custom = customProviders()[provider];
  if (custom) return custom.baseURL;
  return BUILTIN_BASE_URL[provider]?.() ?? "";
}

/** API key per provider (kosong = tidak tersedia, kecuali provider lokal). */
export function apiKeyFor(provider: ProviderName): string {
  const custom = customProviders()[provider];
  if (custom) return custom.apiKey;
  switch (provider) {
    case "anthropic":
      return env.anthropicApiKey();
    case "gemini":
      return env.geminiApiKey();
    case "openrouter":
      return env.openrouterApiKey();
    case "groq":
      return env.groqApiKey();
    default:
      return ""; // ollama / tak dikenal: tanpa auth
  }
}

/** True jika provider punya kredensial / dapat dipakai. */
export function isProviderAvailable(provider: ProviderName): boolean {
  const custom = customProviders()[provider];
  // Provider generik: tersedia bila base URL diset (key boleh kosong untuk server lokal).
  if (custom) return custom.baseURL.length > 0;
  if (provider === "ollama") return env.ollamaBaseUrl().length > 0;
  if (!(BUILTIN_PROVIDERS as readonly string[]).includes(provider)) return false;
  return apiKeyFor(provider).length > 0;
}

/** Peta ketersediaan semua provider (untuk logging/diagnosa, tanpa nilai key). */
export function providerAvailability(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const name of BUILTIN_PROVIDERS) out[name] = isProviderAvailable(name);
  for (const name of Object.keys(customProviders())) out[name] = isProviderAvailable(name);
  return out;
}

/**
 * Parse "provider:model,provider:model" → daftar RoleEntry. Entri tanpa prefix
 * provider ("deepseek-v4.1-flash") memakai provider generik default (LLM_BASE_URL)
 * bila ada. Hanya titik dua PERTAMA yang memisahkan provider, sehingga model
 * seperti "openrouter:meta-llama/llama-3.3-70b-instruct:free" tetap utuh.
 * Entri yang tidak bisa diresolusi dilewati. String kosong → [].
 */
export function parseRoleSpec(
  spec: string,
  fallbackProvider: string | null = defaultCustomProvider(),
): RoleEntry[] {
  const entries: RoleEntry[] = [];
  const known = new Set<string>([...BUILTIN_PROVIDERS, ...Object.keys(customProviders())]);
  for (const raw of spec.split(",")) {
    const item = raw.trim();
    if (!item) continue;
    const idx = item.indexOf(":");
    const maybeProvider = idx > 0 ? item.slice(0, idx).trim().toLowerCase() : "";
    if (idx > 0 && idx < item.length - 1 && known.has(maybeProvider)) {
      entries.push({ provider: maybeProvider, model: item.slice(idx + 1).trim() });
    } else if (fallbackProvider && !(idx > 0 && known.has(maybeProvider))) {
      entries.push({ provider: fallbackProvider, model: item });
    }
  }
  return entries;
}

/**
 * Default per peran bila env kosong (ADR 0008 §3): analyst/debate/reflector =
 * gemini:gemini-flash-lite-latest; assessor = gemini:gemini-flash-latest. Jika
 * Gemini tak tersedia tetapi Anthropic ada, pakai tier Anthropic yang sekarang.
 */
export function defaultSpecFor(role: Role): RoleEntry[] {
  // Model generik dari env (LLM_MODEL di LLM_BASE_URL) didahulukan untuk semua peran.
  const custom = defaultCustomProvider();
  const head: RoleEntry[] =
    custom && env.llmModel().trim() ? [{ provider: custom, model: env.llmModel().trim() }] : [];
  return [...head, ...builtinDefaultSpecFor(role)];
}

function builtinDefaultSpecFor(role: Role): RoleEntry[] {
  const geminiAvailable = isProviderAvailable("gemini");
  const anthropicAvailable = isProviderAvailable("anthropic");

  if (geminiAvailable) {
    // Fallback antar-model Gemini agar 503 "high demand" pada satu model jatuh ke
    // model lain (ADR 0008 §4). "-latest" dulu, lalu snapshot 2.5 sebagai cadangan.
    const entries: RoleEntry[] =
      role === "assessor"
        ? [
            { provider: "gemini", model: "gemini-flash-latest" },
            { provider: "gemini", model: "gemini-2.5-flash" },
          ]
        : [
            { provider: "gemini", model: "gemini-flash-lite-latest" },
            { provider: "gemini", model: "gemini-2.5-flash-lite" },
          ];
    if (anthropicAvailable) {
      entries.push({ provider: "anthropic", model: anthropicModelFor(role) });
    }
    return entries;
  }
  if (anthropicAvailable) {
    return [{ provider: "anthropic", model: anthropicModelFor(role) }];
  }
  // Tak ada provider tersedia → daftar kosong; router akan menghasilkan error jelas.
  return [];
}

function anthropicModelFor(role: Role): string {
  return role === "assessor" ? "claude-sonnet-5-5" : "claude-haiku-5-5";
}

/** Resolusi entri untuk sebuah peran: env > default. Hanya entri yang tersedia. */
export function resolveRole(role: Role): RoleEntry[] {
  const specEnv =
    role === "analyst"
      ? env.llmAnalyst()
      : role === "debate"
        ? env.llmDebate()
        : role === "assessor"
          ? env.llmAssessor()
          : env.llmReflector();
  const requested = specEnv ? parseRoleSpec(specEnv) : defaultSpecFor(role);
  return requested.filter((e) => isProviderAvailable(e.provider));
}

/** Buat provider konkret untuk satu entri. */
export function makeProvider(
  entry: RoleEntry,
  budget: Budget = defaultBudget,
  fetchImpl?: FetchLike,
): LlmProvider {
  if (entry.provider === "anthropic") {
    return new AnthropicProvider(budget);
  }
  return new OpenAICompatibleProvider(
    {
      name: entry.provider,
      baseURL: baseUrlFor(entry.provider),
      apiKey: apiKeyFor(entry.provider),
      model: entry.model,
    },
    budget,
    fetchImpl,
  );
}

/**
 * Router per peran: mencoba setiap entri secara berurutan. Entri sukses
 * mengembalikan hasil. Error retryable (429/5xx/network/timeout) → coba entri
 * berikutnya. Error non-retryable (400/401/403) → catat, jangan ulang ke provider
 * sama, lanjut ke entri berikutnya bila ada. Jika semua gagal, kembalikan hasil
 * terakhir dengan error gabungan.
 */
export class RoleRouter implements LlmProvider {
  private readonly entries: RoleEntry[];
  private readonly providers: LlmProvider[];
  private readonly retryBackoffMs: number;

  constructor(
    entries: RoleEntry[],
    budget: Budget = defaultBudget,
    fetchImpl?: FetchLike,
    providers?: LlmProvider[],
    retryBackoffMs = 2500,
  ) {
    this.entries = entries;
    this.providers =
      providers ?? entries.map((e) => makeProvider(e, budget, fetchImpl));
    this.retryBackoffMs = retryBackoffMs;
  }

  get chain(): RoleEntry[] {
    return this.entries;
  }

  async structured<T>(req: LlmRequest<T>): Promise<LlmResult<T>> {
    if (this.providers.length === 0) {
      return {
        stopReason: "error",
        data: null,
        usage: { model: req.model, inputTokens: 0, outputTokens: 0 },
        error: "tidak ada provider LLM tersedia (cek kunci API / env role spec)",
      };
    }

    const failures: string[] = [];
    let last: LlmResult<T> | null = null;

    for (let i = 0; i < this.providers.length; i++) {
      const entry = this.entries[i]!;
      const label = `${entry.provider}:${entry.model}`;

      // Satu entri boleh dicoba 2x bila error RETRYABLE (429/5xx/network): backoff
      // singkat lalu ulang ke provider yang SAMA sebelum pindah ke fallback.
      let result: LlmResult<T> | null = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        // Entri membawa model-nya sendiri; timpa req.model.
        result = await this.providers[i]!.structured({ ...req, model: entry.model });
        last = result;

        if (result.stopReason === "ok" && result.data !== null) {
          return { ...result, providerUsed: label };
        }
        // Refusal/max_tokens/schema invalid/empty: bukan masalah ketersediaan →
        // kembalikan apa adanya (tanpa retry & tanpa fallback; sama antar provider).
        if (
          result.stopReason === "refusal" ||
          result.stopReason === "max_tokens" ||
          (result.stopReason === "ok" && result.data === null)
        ) {
          return { ...result, providerUsed: label };
        }

        // stopReason "error".
        if (isNonRetryableStatus(result.status)) {
          // Non-retryable: jangan ulang entri yang sama; langsung fallback.
          break;
        }
        // Retryable: ulang sekali setelah backoff; attempt kedua lanjut ke fallback.
        if (attempt === 0) {
          failures.push(`${label} → ${result.error ?? "error"} (retry)`);
          if (this.retryBackoffMs > 0) await delay(this.retryBackoffMs);
          continue;
        }
      }

      if (result) failures.push(`${label} → ${result.error ?? "error"}`);
      // Lanjut ke entri (fallback) berikutnya.
    }

    const combined = `semua provider gagal: ${failures.join(" | ")}`;
    return {
      stopReason: "error",
      data: null,
      usage: last?.usage ?? { model: req.model, inputTokens: 0, outputTokens: 0 },
      error: combined,
      status: last?.status,
    };
  }
}

/** Jeda singkat (ms) untuk backoff retry. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Buat RoleRouter untuk peran dari resolusi env/default. */
export function routerForRole(
  role: Role,
  budget: Budget = defaultBudget,
  fetchImpl?: FetchLike,
): RoleRouter {
  return new RoleRouter(resolveRole(role), budget, fetchImpl);
}

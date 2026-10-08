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

export type ProviderName = "anthropic" | "gemini" | "openrouter" | "groq" | "ollama";

export type Role = "analyst" | "debate" | "assessor" | "reflector";

/** Satu entri pilihan: provider + model. */
export interface RoleEntry {
  provider: ProviderName;
  model: string;
}

/** Base URL OpenAI-compatible per provider (ADR 0008 §2). */
const BASE_URL: Record<Exclude<ProviderName, "anthropic">, () => string> = {
  gemini: () => "https://generativelanguage.googleapis.com/v1beta/openai/",
  openrouter: () => "https://openrouter.ai/api/v1",
  groq: () => "https://api.groq.com/openai/v1",
  ollama: () => env.ollamaBaseUrl(),
};

/** API key per provider (kosong = tidak tersedia). Ollama tanpa key. */
export function apiKeyFor(provider: ProviderName): string {
  switch (provider) {
    case "anthropic":
      return env.anthropicApiKey();
    case "gemini":
      return env.geminiApiKey();
    case "openrouter":
      return env.openrouterApiKey();
    case "groq":
      return env.groqApiKey();
    case "ollama":
      return ""; // tanpa auth; dianggap tersedia bila baseURL diset (default lokal)
  }
}

/** True jika provider punya kredensial / dapat dipakai. */
export function isProviderAvailable(provider: ProviderName): boolean {
  if (provider === "ollama") return env.ollamaBaseUrl().length > 0;
  return apiKeyFor(provider).length > 0;
}

/** Peta ketersediaan semua provider (untuk logging/diagnosa, tanpa nilai key). */
export function providerAvailability(): Record<ProviderName, boolean> {
  return {
    anthropic: isProviderAvailable("anthropic"),
    gemini: isProviderAvailable("gemini"),
    openrouter: isProviderAvailable("openrouter"),
    groq: isProviderAvailable("groq"),
    ollama: isProviderAvailable("ollama"),
  };
}

const PROVIDER_NAMES: ProviderName[] = [
  "anthropic",
  "gemini",
  "openrouter",
  "groq",
  "ollama",
];

/**
 * Parse "provider:model,provider:model" → daftar RoleEntry. Entri tidak valid
 * (provider tak dikenal / format salah) dilewati. String kosong → [].
 */
export function parseRoleSpec(spec: string): RoleEntry[] {
  const entries: RoleEntry[] = [];
  for (const raw of spec.split(",")) {
    const item = raw.trim();
    if (!item) continue;
    const idx = item.indexOf(":");
    if (idx <= 0 || idx === item.length - 1) continue;
    const provider = item.slice(0, idx).trim() as ProviderName;
    const model = item.slice(idx + 1).trim();
    if (!PROVIDER_NAMES.includes(provider)) continue;
    entries.push({ provider, model });
  }
  return entries;
}

/**
 * Default per peran bila env kosong (ADR 0008 §3): analyst/debate/reflector =
 * gemini:gemini-flash-lite-latest; assessor = gemini:gemini-flash-latest. Jika
 * Gemini tak tersedia tetapi Anthropic ada, pakai tier Anthropic yang sekarang.
 */
export function defaultSpecFor(role: Role): RoleEntry[] {
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
      baseURL: BASE_URL[entry.provider](),
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

  constructor(
    entries: RoleEntry[],
    budget: Budget = defaultBudget,
    fetchImpl?: FetchLike,
    providers?: LlmProvider[],
  ) {
    this.entries = entries;
    this.providers =
      providers ?? entries.map((e) => makeProvider(e, budget, fetchImpl));
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
      // Entri membawa model-nya sendiri; timpa req.model.
      const result = await this.providers[i]!.structured({ ...req, model: entry.model });
      last = result;

      if (result.stopReason === "ok" && result.data !== null) return result;

      // Refusal/max_tokens/schema invalid: bukan masalah ketersediaan provider →
      // kembalikan apa adanya (jangan fallback; perilaku ini sama antar provider).
      if (result.stopReason === "refusal" || result.stopReason === "max_tokens") {
        return result;
      }
      if (result.stopReason === "ok" && result.data === null) {
        // schema invalid / empty: dibuang (spec §3.4), tanpa fallback.
        return result;
      }

      // stopReason "error": catat & tentukan fallback.
      const label = `${entry.provider}:${entry.model}`;
      failures.push(`${label} → ${result.error ?? "error"}`);
      if (isNonRetryableStatus(result.status)) {
        // Non-retryable: jangan ulang ke provider sama; lanjut ke entri berikutnya.
        continue;
      }
      // Retryable (429/5xx/network): lanjut ke entri berikutnya.
      continue;
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

/** Buat RoleRouter untuk peran dari resolusi env/default. */
export function routerForRole(
  role: Role,
  budget: Budget = defaultBudget,
  fetchImpl?: FetchLike,
): RoleRouter {
  return new RoleRouter(resolveRole(role), budget, fetchImpl);
}

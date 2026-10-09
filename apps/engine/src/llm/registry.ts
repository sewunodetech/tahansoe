/**
 * Registry LLM — satu gateway OpenAI-compatible (ADR 0009).
 *
 * Semua model dipanggil lewat SATU endpoint (`LLM_API_URL` + `LLM_API_KEY`).
 * Spec peran = daftar NAMA MODEL berurutan (fallback antar-model di gateway yang
 * sama; retry hanya 429/5xx/timeout). Tidak ada lagi provider per peran.
 *
 * JANGAN pernah log API key (I8). URL/key hilang → error jelas (bukan crash diam-diam).
 */

import type { LlmProvider, LlmRequest, LlmResult } from "./provider.ts";
import { isNonRetryableStatus } from "./provider.ts";
import { OpenAICompatibleProvider, type FetchLike } from "./openai-compatible.ts";
import { budget as defaultBudget, type Budget } from "./budget.ts";
import { env } from "../config.ts";
import { loadSettingsSync, resolveRoleSpecList } from "../settings/settings.ts";
import { stripProviderPrefix } from "../settings/schema.ts";

export type Role = "analyst" | "debate" | "assessor" | "reflector" | "chat";

/** Satu entri pilihan: nama model (di gateway tunggal). */
export interface RoleEntry {
  model: string;
}

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

/** URL + key gateway dari env (I8: key tidak pernah di-log). */
export function gatewayConfig(): { baseURL: string; apiKey: string } {
  return { baseURL: normalizeBaseUrl(env.llmApiUrl()), apiKey: env.llmApiKey() };
}

/** True bila gateway lengkap (URL + key). */
export function isGatewayConfigured(): boolean {
  const g = gatewayConfig();
  return g.baseURL.length > 0 && g.apiKey.length > 0;
}

/**
 * Pesan error jelas bila gateway belum dikonfigurasi. TIDAK memuat nilai key.
 */
export function gatewayError(): string {
  const g = gatewayConfig();
  const missing: string[] = [];
  if (!g.baseURL) missing.push("LLM_API_URL");
  if (!g.apiKey) missing.push("LLM_API_KEY");
  return (
    `LLM gateway belum dikonfigurasi: ${missing.join(" dan ")} belum diisi. ` +
    `Set di apps/engine/.env (mis. LLM_API_URL=https://router.bynara.id/v1 dan LLM_API_KEY=<key>).`
  );
}

/**
 * Default model per peran bila settings kosong. Nama model generik; dipakai hanya
 * bila gateway dikonfigurasi tetapi settings belum menetapkan peran. Nilai ini
 * contoh Bynara (lihat settings.example.json); user menimpanya via `research`.
 */
export function defaultSpecFor(role: Role): RoleEntry[] {
  if (role === "chat") return defaultSpecFor("analyst");
  const models = role === "assessor" ? ["deepseek-v4.1-flash", "agnes-2.5-flash"] : ["agnes-2.5-flash"];
  return models.map((model) => ({ model }));
}

/**
 * Parse daftar NAMA MODEL → RoleEntry[]. Membuang awalan provider lama (kompat)
 * tetapi mempertahankan ":" yang sah pada id model. String kosong → [].
 */
export function parseRoleSpec(spec: string | string[]): RoleEntry[] {
  const items = Array.isArray(spec) ? spec : spec.split(",");
  const out: RoleEntry[] = [];
  for (const raw of items) {
    const model = stripProviderPrefix((raw ?? "").trim());
    if (model) out.push({ model });
  }
  return out;
}

/** Resolusi entri peran: settings > default. (Gateway tunggal; tanpa filter provider.) */
export function resolveRole(role: Role): RoleEntry[] {
  const { settings } = loadSettingsSync();
  const list = resolveRoleSpecList(role, settings);
  if (list && list.length > 0) return parseRoleSpec(list);
  if (role === "chat") {
    const analystList = resolveRoleSpecList("analyst", settings);
    if (analystList && analystList.length > 0) return parseRoleSpec(analystList);
    return defaultSpecFor("analyst");
  }
  return defaultSpecFor(role);
}

/** Buat provider konkret (gateway) untuk satu entri model. */
export function makeProvider(
  entry: RoleEntry,
  budget: Budget = defaultBudget,
  fetchImpl?: FetchLike,
): LlmProvider {
  const g = gatewayConfig();
  return new OpenAICompatibleProvider(
    { name: "gateway", baseURL: g.baseURL, apiKey: g.apiKey, model: entry.model },
    budget,
    fetchImpl,
  );
}

/**
 * Router per peran: coba setiap model berurutan di gateway yang sama. Model sukses
 * mengembalikan hasil. Error retryable (429/5xx/network/timeout) → retry 1x lalu
 * fallback ke model berikutnya. Non-retryable (400/401/403) → tanpa retry, fallback.
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
    this.providers = providers ?? entries.map((e) => makeProvider(e, budget, fetchImpl));
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
        error: "tidak ada model LLM dikonfigurasi (set roles di settings.json / LLM_API_URL+LLM_API_KEY)",
      };
    }

    const failures: string[] = [];
    let last: LlmResult<T> | null = null;

    for (let i = 0; i < this.providers.length; i++) {
      const entry = this.entries[i]!;
      const label = entry.model;

      let result: LlmResult<T> | null = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        result = await this.providers[i]!.structured({ ...req, model: entry.model });
        last = result;

        if (result.stopReason === "ok" && result.data !== null) {
          return { ...result, providerUsed: label };
        }
        // Schema invalid (provider sudah 1x repair retry) → FALLBACK ke model
        // berikutnya (cli-fix §1b), BUKAN return. Catat alasan, hentikan retry
        // same-model (repair sudah di provider).
        if (result.schemaInvalid) {
          failures.push(`${label} → ${result.error ?? "schema invalid"}`);
          break;
        }
        // Refusal / max_tokens / empty content: bukan masalah ketersediaan dan
        // bukan schema → kembalikan apa adanya (sama antar model).
        if (
          result.stopReason === "refusal" ||
          result.stopReason === "max_tokens" ||
          (result.stopReason === "ok" && result.data === null)
        ) {
          return { ...result, providerUsed: label };
        }
        if (isNonRetryableStatus(result.status)) break;
        if (attempt === 0) {
          failures.push(`${label} → ${result.error ?? "error"} (retry)`);
          if (this.retryBackoffMs > 0) await delay(this.retryBackoffMs);
          continue;
        }
      }

      if (result && !result.schemaInvalid) failures.push(`${label} → ${result.error ?? "error"}`);
    }

    return {
      stopReason: "error",
      data: null,
      usage: last?.usage ?? { model: req.model, inputTokens: 0, outputTokens: 0 },
      error: `semua model gagal: ${failures.join(" | ")}`,
      status: last?.status,
    };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Buat RoleRouter untuk peran. Bila gateway belum dikonfigurasi, kembalikan router
 * kosong yang menghasilkan error jelas saat dipanggil (graceful; tidak crash).
 */
export function routerForRole(
  role: Role,
  budget: Budget = defaultBudget,
  fetchImpl?: FetchLike,
): RoleRouter {
  if (!isGatewayConfigured()) {
    return new RoleRouter([], budget, fetchImpl, []);
  }
  return new RoleRouter(resolveRole(role), budget, fetchImpl);
}

/** Diagnostik ketersediaan gateway (tanpa nilai key) untuk logging. */
export function providerAvailability(): Record<string, boolean> {
  return { gateway: isGatewayConfigured() };
}

/**
 * Provider OpenAI-compatible (ADR 0008): satu adapter untuk Gemini, Groq,
 * OpenRouter, DeepSeek, Ollama — semua mengekspos `/chat/completions` dengan
 * `response_format` JSON. Memakai `fetch` bawaan (tanpa dependensi tambahan)
 * karena request-nya satu POST sederhana dan kita butuh kontrol penuh atas
 * pemetaan status HTTP (untuk logika fail-fast non-retryable).
 *
 * Invarian (spec §3.4): tanpa tools; output JSON divalidasi zod (gagal → data
 * null + error, TIDAK diperbaiki); cek finish_reason sebelum memakai hasil.
 * JANGAN pernah log apiKey (I8).
 */

import { z } from "zod";
import type { LlmProvider, LlmRequest, LlmResult, LlmUsage } from "./provider.ts";
import { budget as defaultBudget, type Budget } from "./budget.ts";

/** Token output maksimum per panggilan (spec §3.4). */
const MAX_OUTPUT_TOKENS = 16000;

export interface OpenAICompatibleConfig {
  /** Nama provider untuk logging/budget (mis. "gemini", "groq"). */
  name: string;
  /** Base URL OpenAI-compatible, mis. ".../v1beta/openai/" atau ".../v1". */
  baseURL: string;
  /** API key; kosong untuk provider tanpa auth (mis. Ollama lokal). */
  apiKey: string;
  /** Nama model default; dapat ditimpa per request oleh req.model. */
  model: string;
}

/** Injectable fetch (test memakai mock agar offline). */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

export class OpenAICompatibleProvider implements LlmProvider {
  private readonly cfg: OpenAICompatibleConfig;
  private readonly budget: Budget;
  private readonly fetchImpl: FetchLike;

  constructor(
    cfg: OpenAICompatibleConfig,
    budget: Budget = defaultBudget,
    fetchImpl?: FetchLike,
  ) {
    this.cfg = cfg;
    this.budget = budget;
    this.fetchImpl = fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  }

  async structured<T>(req: LlmRequest<T>): Promise<LlmResult<T>> {
    const model = req.model || this.cfg.model;
    const url = joinUrl(this.cfg.baseURL, "chat/completions");

    // Konversi schema zod → JSON Schema (zod v4 bawaan). Jika gagal, kembalikan error.
    let jsonSchema: unknown;
    try {
      jsonSchema = sanitizeJsonSchema(z.toJSONSchema(req.output));
    } catch (err) {
      return {
        stopReason: "error",
        data: null,
        usage: { model, inputTokens: 0, outputTokens: 0 },
        error: `zod→JSONSchema gagal: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.cfg.apiKey) headers["authorization"] = `Bearer ${this.cfg.apiKey}`;

    const body = JSON.stringify({
      model,
      max_tokens: req.maxOutputTokens ?? MAX_OUTPUT_TOKENS,
      messages: [
        // System prompt statis di depan + data (eksternal) di akhir (spec §3.4).
        { role: "system", content: req.system },
        ...req.messages.map((m) => ({ role: m.role, content: m.content })),
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: req.outputName, strict: true, schema: jsonSchema },
      },
      // Tanpa tools (invariant). Jangan kirim temperature/top_p agar default model.
    });

    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await this.fetchImpl(url, { method: "POST", headers, body });
    } catch (err) {
      // Network/timeout → retryable (tanpa status).
      return {
        stopReason: "error",
        data: null,
        usage: { model, inputTokens: 0, outputTokens: 0 },
        error: `network error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    if (!res.ok) {
      const detail = await safeText(res);
      return {
        stopReason: "error",
        data: null,
        usage: { model, inputTokens: 0, outputTokens: 0 },
        error: `HTTP ${res.status} ${this.cfg.name}: ${truncate(detail, 300)}`,
        status: res.status,
      };
    }

    const payload = (await res.json()) as ChatCompletion;
    const usage = toUsage(model, payload.usage);
    this.budget.record(usage);

    const choice = payload.choices?.[0];
    const finish = choice?.finish_reason;
    if (finish === "length") {
      return { stopReason: "max_tokens", data: null, usage, error: "finish_reason=length" };
    }
    if (finish === "content_filter") {
      return { stopReason: "refusal", data: null, usage, error: "finish_reason=content_filter" };
    }

    const content = choice?.message?.content;
    if (typeof content !== "string" || content.length === 0) {
      return { stopReason: "ok", data: null, usage, error: "empty content" };
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(content);
    } catch {
      return { stopReason: "ok", data: null, usage, error: "content is not valid JSON" };
    }

    const check = req.output.safeParse(parsedJson);
    if (!check.success) {
      return { stopReason: "ok", data: null, usage, error: `schema invalid: ${check.error.message}` };
    }
    return { stopReason: "ok", data: check.data, usage };
  }
}

/** Bentuk minimal respons chat/completions yang kita baca. */
interface ChatCompletion {
  choices?: Array<{
    finish_reason?: string | null;
    message?: { content?: string | null };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

function toUsage(model: string, usage: ChatCompletion["usage"]): LlmUsage {
  return {
    model,
    inputTokens: usage?.prompt_tokens ?? 0,
    outputTokens: usage?.completion_tokens ?? 0,
  };
}

/** Gabungkan baseURL + path tanpa menggandakan slash. */
function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

/**
 * Keyword JSON Schema yang ditolak sebagian endpoint OpenAI-compatible dalam mode
 * `strict` (diverifikasi: Gemini `/v1beta/openai/` menolak maxItems/maxLength/
 * minimum/maximum/$schema, dsb.). Dibuang dari schema yang DIKIRIM; batasan ini
 * tetap ditegakkan di sisi kita lewat `req.output.safeParse` (zod) setelah parse.
 */
const UNSUPPORTED_SCHEMA_KEYWORDS = new Set([
  "$schema",
  "maxItems",
  "minItems",
  "maxLength",
  "minLength",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "pattern",
  "format",
]);

/** Buang keyword yang tak didukung strict mode (rekursif), schema tetap setara longgar. */
function sanitizeJsonSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitizeJsonSchema);
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (UNSUPPORTED_SCHEMA_KEYWORDS.has(k)) continue;
      out[k] = sanitizeJsonSchema(v);
    }
    return out;
  }
  return node;
}

async function safeText(res: { text: () => Promise<string> }): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

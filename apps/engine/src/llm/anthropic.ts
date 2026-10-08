/**
 * Implementasi LlmProvider memakai Anthropic SDK (ADR 0004 §5, spec §3.4).
 *
 * Memakai `client.messages.parse` + `zodOutputFormat` (SDK ≥ 0.132) sehingga
 * output otomatis divalidasi terhadap schema zod dan tersedia di `parsed_output`.
 *
 * Invarian (spec §3.4):
 *  - Structured output zod; gagal validasi → data null + error (dibuang, tidak diperbaiki).
 *  - Agent TANPA tools (tidak ada `tools` di request).
 *  - Cek `stop_reason`: "refusal" → data null + catat kategori; "max_tokens" → data null + error.
 *  - System prompt statis di depan (prompt caching ephemeral) + data di akhir.
 *  - JANGAN kirim temperature/top_p/budget_tokens; effort lewat output_config.effort.
 *  - Rakit usage (input, output, cache read/write) lalu budget.record.
 *  - JANGAN pernah log apiKey (security.md I8).
 */

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { LlmProvider, LlmRequest, LlmResult, LlmUsage } from "./provider.ts";
import { budget as defaultBudget, type Budget } from "./budget.ts";
import { env } from "../config.ts";

/** Token output maksimum per panggilan (spec §3.4). */
const MAX_OUTPUT_TOKENS = 16000;

/** Antarmuka minimal client yang dipakai provider (memudahkan test tanpa API). */
export interface MessagesParseClient {
  messages: {
    parse(params: unknown): Promise<ParsedLike>;
  };
}

/** Bentuk respons yang kita baca dari `messages.parse` (subset). */
export interface ParsedLike {
  stop_reason: string | null;
  stop_details?: { category?: string | null } | null;
  parsed_output?: unknown;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  };
}

export class AnthropicProvider implements LlmProvider {
  private readonly client: MessagesParseClient;
  private readonly budget: Budget;

  /**
   * @param budget akumulator biaya (default: instance global).
   * @param client opsional — untuk test, suntik client palsu agar tanpa API/env.
   *   Produksi: biarkan undefined; provider membuat `new Anthropic(...)` dari env.
   */
  constructor(budget: Budget = defaultBudget, client?: MessagesParseClient) {
    this.budget = budget;
    this.client =
      client ?? (new Anthropic({ apiKey: env.anthropicApiKey() }) as unknown as MessagesParseClient);
  }

  async structured<T>(req: LlmRequest<T>): Promise<LlmResult<T>> {
    try {
      const message = await this.client.messages.parse({
        model: req.model,
        max_tokens: req.maxOutputTokens ?? MAX_OUTPUT_TOKENS,
        // System prompt statis di depan + prompt caching (ephemeral).
        system: [
          {
            type: "text",
            text: req.system,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: req.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        output_config: {
          effort: req.effort,
          format: zodOutputFormat(req.output),
        },
      });

      const usage = toUsage(req.model, message.usage);
      this.budget.record(usage);

      // Cek stop_reason sebelum membaca hasil (spec §3.4).
      switch (message.stop_reason) {
        case "refusal": {
          const category = message.stop_details?.category ?? "unknown";
          return {
            stopReason: "refusal",
            data: null,
            usage,
            error: `refusal (category=${category})`,
          };
        }
        case "max_tokens":
          return {
            stopReason: "max_tokens",
            data: null,
            usage,
            error: "max_tokens reached before completion",
          };
        case "model_context_window_exceeded":
          return {
            stopReason: "error",
            data: null,
            usage,
            error: "model_context_window_exceeded",
          };
        default:
          break;
      }

      // SDK sudah mem-parse dengan zodOutputFormat; validasi ulang defensif.
      const parsed = message.parsed_output;
      if (parsed == null) {
        return {
          stopReason: "ok",
          data: null,
          usage,
          error: "no parsed_output (schema parse failed)",
        };
      }
      const check = req.output.safeParse(parsed);
      if (!check.success) {
        return {
          stopReason: "ok",
          data: null,
          usage,
          error: `schema invalid: ${check.error.message}`,
        };
      }

      return { stopReason: "ok", data: check.data, usage };
    } catch (err) {
      // Kegagalan jaringan/SDK: data null, biaya tak tercatat (tidak ada usage).
      // Ekspos status HTTP bila ada (Anthropic APIError.status) agar run bisa
      // mendeteksi error non-retryable (400/401/403) dan berhenti lebih awal.
      const status =
        typeof (err as { status?: unknown })?.status === "number"
          ? (err as { status: number }).status
          : undefined;
      return {
        stopReason: "error",
        data: null,
        usage: { model: req.model, inputTokens: 0, outputTokens: 0 },
        error: err instanceof Error ? err.message : String(err),
        status,
      };
    }
  }
}

/**
 * Rakit LlmUsage dari usage SDK. `input_tokens` adalah input non-cache; token
 * cache write (creation) dan cache read dipisah agar costOf bisa menagihnya
 * dengan multiplier yang berbeda.
 */
function toUsage(
  model: string,
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  },
): LlmUsage {
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  return {
    model,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheWriteTokens: cacheWrite > 0 ? cacheWrite : undefined,
    cacheReadTokens: cacheRead > 0 ? cacheRead : undefined,
  };
}

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
import { redactDeep } from "./redact.ts";

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

    // Konversi schema zod → JSON Schema (zod v4 bawaan). `fullSchema` menyimpan
    // batasan (maxLength/maxItems/min/max) untuk DITARUH DI PROMPT agar model yang
    // gateway-nya TIDAK menegakkan response_format tetap melihat daftar field +
    // batasannya. `sanitizedSchema` (tanpa keyword yang ditolak strict mode) tetap
    // dikirim di response_format untuk gateway yang menegakkannya.
    let fullSchema: unknown;
    let sanitizedSchema: unknown;
    try {
      fullSchema = z.toJSONSchema(req.output);
      sanitizedSchema = sanitizeJsonSchema(fullSchema);
    } catch (err) {
      return {
        stopReason: "error",
        data: null,
        usage: { model, inputTokens: 0, outputTokens: 0 },
        error: `zod→JSONSchema gagal: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const schemaText = JSON.stringify(fullSchema);

    // System prompt + blok instruksi JSON Schema (English). Ditambahkan di AKHIR
    // system prompt agar model melihat kontrak output walau gateway tidak menegakkan
    // response_format (cli-fix lanjutan: Bynara/DeepSeek tidak selalu menegakkan).
    const systemWithSchema = `${req.system}\n\n${buildSchemaInstruction(schemaText)}`;

    // Pesan dasar: system (+schema) + konten per peran (eksternal di akhir).
    const baseMessages: Array<{ role: string; content: string }> = [
      { role: "system", content: systemWithSchema },
      ...req.messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    // Panggilan pertama.
    let attempt = await this.callOnce<T>(url, model, sanitizedSchema, req, baseMessages);
    if (attempt.kind !== "schema-invalid") return attempt.result;

    // REPAIR RETRY (satu kali, model yang SAMA): kirim ulang dengan pengingat schema
    // + daftar isu validasi (path + message saja — TIDAK pernah konten eksternal).
    const repairMessages = [
      ...baseMessages,
      {
        role: "assistant",
        content: attempt.rawContent.slice(0, 4000),
      },
      {
        role: "user",
        content: buildRepairMessage(attempt.issues, schemaText),
      },
    ];
    const repaired = await this.callOnce<T>(url, model, sanitizedSchema, req, repairMessages, attempt.result.usage);
    if (repaired.kind === "schema-invalid") {
      // Tetap invalid setelah repair → tandai agar RoleRouter fallback ke model lain.
      return { ...repaired.result, schemaInvalid: true };
    }
    return repaired.result;
  }

  /**
   * Satu panggilan HTTP + parse + validasi. Mengembalikan hasil final, atau
   * penanda `schema-invalid` beserta isu zod + konten mentah (untuk repair).
   * `priorUsage` (opsional) diakumulasi agar biaya repair dihitung penuh.
   */
  private async callOnce<T>(
    url: string,
    model: string,
    jsonSchema: unknown,
    req: LlmRequest<T>,
    messages: Array<{ role: string; content: string }>,
    priorUsage?: LlmUsage,
  ): Promise<
    | { kind: "final"; result: LlmResult<T> }
    | { kind: "schema-invalid"; result: LlmResult<T>; issues: SchemaIssue[]; rawContent: string }
  > {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.cfg.apiKey) headers["authorization"] = `Bearer ${this.cfg.apiKey}`;

    const body = JSON.stringify({
      model,
      max_tokens: req.maxOutputTokens ?? MAX_OUTPUT_TOKENS,
      messages,
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
      return {
        kind: "final",
        result: {
          stopReason: "error",
          data: null,
          usage: mergeUsage(priorUsage, { model, inputTokens: 0, outputTokens: 0 }),
          error: `network error: ${err instanceof Error ? err.message : String(err)}`,
        },
      };
    }

    if (!res.ok) {
      const detail = await safeText(res);
      return {
        kind: "final",
        result: {
          stopReason: "error",
          data: null,
          usage: mergeUsage(priorUsage, { model, inputTokens: 0, outputTokens: 0 }),
          error: `HTTP ${res.status} ${this.cfg.name}: ${truncate(detail, 300)}`,
          status: res.status,
        },
      };
    }

    const payload = (await res.json()) as ChatCompletion;
    const usage = mergeUsage(priorUsage, toUsage(model, payload.usage));
    this.budget.record(toUsage(model, payload.usage));

    const choice = payload.choices?.[0];
    const finish = choice?.finish_reason;
    if (finish === "length") {
      return { kind: "final", result: { stopReason: "max_tokens", data: null, usage, error: "finish_reason=length" } };
    }
    if (finish === "content_filter") {
      return { kind: "final", result: { stopReason: "refusal", data: null, usage, error: "finish_reason=content_filter" } };
    }

    const content = choice?.message?.content;
    if (typeof content !== "string" || content.length === 0) {
      return { kind: "final", result: { stopReason: "ok", data: null, usage, error: "empty content" } };
    }

    // Ekstraksi JSON yang tahan terhadap code-fence / prosa pembungkus (gateway
    // yang tidak menegakkan response_format bisa mengembalikan ```json … ``` atau
    // teks sebelum/sesudah objek). Ambil objek JSON terluar. Tidak pernah eval.
    const jsonText = extractJsonObject(content);
    let parsedJson: unknown;
    try {
      if (jsonText === null) throw new Error("no JSON object found");
      parsedJson = JSON.parse(jsonText);
    } catch {
      return {
        kind: "schema-invalid",
        result: { stopReason: "ok", data: null, usage, error: "content is not valid JSON", schemaInvalid: true },
        issues: [{ path: "(root)", message: "response is not valid JSON (return a single JSON object only)" }],
        rawContent: content,
      };
    }

    const check = req.output.safeParse(parsedJson);
    if (!check.success) {
      const issues = toSchemaIssues(check.error);
      // DEBUG (stderr): untuk isu "Invalid option" (enum), catat NILAI yang salah
      // SAJA (bukan konten teks) agar nanti bisa diputuskan apakah enum perlu
      // nilai baru (mis. Evidence.source "ANALYST"). cli-polish §7.
      logInvalidEnumValues(check.error, parsedJson, model);
      return {
        kind: "schema-invalid",
        result: {
          stopReason: "ok",
          data: null,
          usage,
          error: `schema invalid: ${summarizeIssues(issues)}`,
          schemaInvalid: true,
        },
        issues,
        rawContent: content,
      };
    }
    // Lapis kedua anti-injeksi: frasa perintah yang dikutip model dari data
    // diganti penanda netral, lalu divalidasi ulang (panjang bisa berubah).
    const redacted = req.output.safeParse(redactDeep(check.data));
    if (!redacted.success) {
      const issues = toSchemaIssues(redacted.error);
      return {
        kind: "schema-invalid",
        result: {
          stopReason: "ok",
          data: null,
          usage,
          error: `schema invalid after redaction: ${summarizeIssues(issues)}`,
          schemaInvalid: true,
        },
        issues,
        rawContent: content,
      };
    }
    return { kind: "final", result: { stopReason: "ok", data: redacted.data, usage } };
  }
}

/**
 * Catat ke stderr (debug) nilai enum yang tidak valid SAJA (bukan konten). Hanya
 * untuk issue `invalid_value`/"Invalid option" (enum). Nilai diambil dari JSON pada
 * path issue, dipendekkan, agar bisa diaudit tanpa membocorkan teks eksternal.
 */
function logInvalidEnumValues(error: z.ZodError, parsed: unknown, model: string): void {
  for (const issue of error.issues) {
    const isEnum = issue.code === "invalid_value" || /invalid option/i.test(issue.message);
    if (!isEnum) continue;
    const pathStr = issue.path.join(".");
    const val = valueAtPath(parsed, issue.path);
    // Hanya log bila nilai berupa string pendek (nama enum), bukan teks panjang.
    if (typeof val === "string" && val.length <= 40) {
      console.error(`[engine/llm] invalid enum at ${pathStr}: "${val}" (model ${model})`);
    }
  }
}

/** Ambil nilai pada path (array of string|number) dari objek JSON. undefined bila tak ada. */
function valueAtPath(obj: unknown, path: PropertyKey[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<PropertyKey, unknown>)[key];
  }
  return cur;
}

/**
 * Blok instruksi JSON Schema (English) yang ditempel ke system prompt. Membuat
 * output terstruktur TIDAK bergantung pada penegakan `response_format` oleh gateway
 * (banyak router tidak menegakkannya untuk semua model). Memuat skema LENGKAP
 * (termasuk maxLength/maxItems/min/max) agar model melihat daftar field + batasan.
 */
export function buildSchemaInstruction(schemaText: string): string {
  return (
    "Respond with a single JSON object only (no prose, no markdown, no code fences) " +
    "that conforms to this JSON Schema. Include every required field. Respect all " +
    "maximum length and item limits (shorten text to fit). Use only the allowed enum values.\n\n" +
    "JSON Schema:\n" +
    schemaText
  );
}

/**
 * Ekstrak satu objek JSON dari teks model yang mungkin dibungkus code fence atau
 * prosa. Strategi: (1) buang fence ```json … ```; (2) ambil substring dari "{"
 * pertama sampai "}" terakhir yang seimbang (menghormati string & escape). Tidak
 * pernah eval. Mengembalikan string JSON kandidat, atau null bila tidak ditemukan.
 */
export function extractJsonObject(text: string): string | null {
  let s = text.trim();
  // Buang code fence ```json … ``` atau ``` … ```.
  const fence = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(s);
  if (fence && fence[1]) s = fence[1].trim();

  const start = s.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i]!;
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null; // kurung tidak seimbang
}

/** Isu validasi zod yang aman dibagikan ke model (TANPA konten eksternal). */
interface SchemaIssue {
  path: string;
  message: string;
}

function toSchemaIssues(error: z.ZodError): SchemaIssue[] {
  return error.issues.slice(0, 12).map((i) => ({
    path: i.path.join(".") || "(root)",
    // Pesan zod bersifat generik (mis. "String must contain at most 400 character(s)")
    // dan TIDAK memuat konten eksternal, aman untuk dikirim kembali ke model.
    message: i.message,
  }));
}

function summarizeIssues(issues: SchemaIssue[]): string {
  return issues.map((i) => `${i.path}: ${i.message}`).join("; ").slice(0, 300);
}

/**
 * Pesan repair (English): pengingat schema + daftar path+pesan validasi. TIDAK
 * pernah memuat konten eksternal (hanya schema & pesan zod generik).
 */
export function buildRepairMessage(issues: SchemaIssue[], schemaText: string): string {
  const lines = issues.map((i) => `- ${i.path}: ${i.message}`).join("\n");
  return (
    "Your previous response did not conform to the required JSON Schema. Return a " +
    "single corrected JSON object only (no prose, no code fences) that fully conforms. " +
    "Respect every maximum length and item limit (shorten text as needed) and use only " +
    "allowed enum values.\n\n" +
    "JSON Schema:\n" +
    schemaText +
    "\n\nValidation errors to fix:\n" +
    lines
  );
}

/** Gabungkan token usage (akumulasi retry). Model memakai yang terakhir. */
function mergeUsage(prior: LlmUsage | undefined, next: LlmUsage): LlmUsage {
  if (!prior) return next;
  return {
    model: next.model,
    inputTokens: prior.inputTokens + next.inputTokens,
    outputTokens: prior.outputTokens + next.outputTokens,
    cacheWriteTokens: (prior.cacheWriteTokens ?? 0) + (next.cacheWriteTokens ?? 0) || undefined,
    cacheReadTokens: (prior.cacheReadTokens ?? 0) + (next.cacheReadTokens ?? 0) || undefined,
  };
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

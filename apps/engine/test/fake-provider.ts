/**
 * LlmProvider palsu deterministik untuk test (spec §6 "LlmProvider palsu").
 *
 * Mengembalikan hasil yang sudah ditentukan per pemanggilan, tanpa network.
 * Mendukung skenario: sukses, analyst gagal, refusal, dan schema invalid.
 */

import type {
  LlmProvider,
  LlmRequest,
  LlmResult,
  StopReason,
} from "../src/llm/provider.ts";

/** Satu respons terprogram. */
export interface ScriptedResponse {
  stopReason?: StopReason;
  /** Data mentah; akan divalidasi dengan req.output. Jika undefined → data null. */
  data?: unknown;
  error?: string;
  /** Status HTTP simulasi (mis. 400) untuk menguji deteksi non-retryable. */
  status?: number;
  /** Tandai output gagal validasi zod (untuk menguji fallback schema di RoleRouter). */
  schemaInvalid?: boolean;
}

/**
 * Provider yang mengambil respons dari antrean berdasarkan urutan panggilan,
 * atau respons default untuk semua panggilan.
 */
export class FakeProvider implements LlmProvider {
  private queue: ScriptedResponse[];
  private readonly fallback: ScriptedResponse;
  /** Nama model yang dilaporkan di usage (default: req.model). Dipakai mode --fake. */
  private readonly modelName?: string;
  public calls: Array<{ outputName: string; model: string }> = [];

  constructor(
    responses: ScriptedResponse[] = [],
    fallback: ScriptedResponse = { stopReason: "ok" },
    modelName?: string,
  ) {
    this.queue = [...responses];
    this.fallback = fallback;
    this.modelName = modelName;
  }

  async structured<T>(req: LlmRequest<T>): Promise<LlmResult<T>> {
    this.calls.push({ outputName: req.outputName, model: req.model });
    const scripted = this.queue.shift() ?? this.fallback;
    const stopReason = scripted.stopReason ?? "ok";

    const usage = {
      model: this.modelName ?? req.model,
      inputTokens: 1000,
      outputTokens: 200,
    };

    if (stopReason !== "ok") {
      return { stopReason, data: null, usage, error: scripted.error, status: scripted.status };
    }

    // Simulasi schema invalid eksplisit (untuk uji fallback RoleRouter).
    if (scripted.schemaInvalid) {
      return { stopReason: "ok", data: null, usage, error: scripted.error ?? "schema invalid", schemaInvalid: true };
    }

    // Validasi data terprogram dengan schema asli (meniru perilaku provider nyata).
    const parsed = req.output.safeParse(scripted.data);
    if (!parsed.success) {
      return {
        stopReason: "ok",
        data: null,
        usage,
        error: `schema invalid: ${parsed.error.message}`,
      };
    }
    return { stopReason: "ok", data: parsed.data, usage };
  }
}

/**
 * Interface LLM provider-agnostic (ADR 0004 §5, architecture §2).
 *
 * Semua agent hanya bergantung pada interface ini, bukan pada SDK tertentu.
 * Implementasi pertama: Anthropic (`anthropic.ts`). Untuk test dipakai
 * provider palsu deterministik (lihat test/fake-provider.ts).
 *
 * INVARIAN (spec §3.4 "Aturan LLM"):
 *  - SELALU structured output tervalidasi zod. Output gagal validasi dibuang &
 *    dicatat, TIDAK "diperbaiki".
 *  - Agent TANPA tools: tidak ada fetch/DB/chain dari dalam LLM. Konteks dirakit
 *    kode lebih dulu dan disisipkan sebagai data.
 *  - Pemanggil wajib memeriksa `stopReason` sebelum memakai `data`.
 */

import type { z } from "zod";

/** Reasoning effort yang didukung provider (spec §3.4). */
export type Effort = "low" | "medium" | "high";

/** Alasan model berhenti. `refusal` bisa muncul untuk topik perang/exploit. */
export type StopReason = "ok" | "refusal" | "max_tokens" | "error";

/** Pemakaian token untuk akuntansi biaya (budget.ts). */
export interface LlmUsage {
  model: string;
  /** Token input non-cache (API Anthropic: TIDAK termasuk token cache). */
  inputTokens: number;
  outputTokens: number;
  /** Token input yang DITULIS ke cache (ditagih ~1.25x harga input). */
  cacheWriteTokens?: number;
  /** Token input yang DIBACA dari cache (ditagih ~0.1x harga input). */
  cacheReadTokens?: number;
}

/**
 * Satu permintaan structured output.
 * @template T tipe hasil yang dijamin schema `output`.
 */
export interface LlmRequest<T> {
  model: string;
  effort: Effort;
  /** System prompt statis (ditaruh di depan untuk prompt caching). */
  system: string;
  /**
   * Konten per peran. Konten eksternal (berita, dsb.) WAJIB dibungkus sebagai
   * data di akhir, bukan sebagai instruksi (spec §3.4, invariant #5).
   */
  messages: LlmMessage[];
  /** Schema zod yang memvalidasi output. */
  output: z.ZodType<T>;
  /** Nama schema untuk tool/format provider. */
  outputName: string;
  maxOutputTokens?: number;
  /**
   * Pembatalan dari pemanggil (deadline run / shutdown). Bila abort, provider
   * berhenti secepatnya dan router TIDAK mencoba ulang / fallback.
   */
  signal?: AbortSignal;
}

export interface LlmMessage {
  role: "user" | "assistant";
  content: string;
}

/** Hasil pemanggilan LLM. `data` hanya valid jika `stopReason === "ok"`. */
export interface LlmResult<T> {
  stopReason: StopReason;
  /** Terisi hanya jika stopReason "ok" DAN lolos schema; selain itu null. */
  data: T | null;
  usage: LlmUsage;
  /** Pesan kesalahan untuk logging (schema gagal, refusal, dsb.). */
  error?: string;
  /**
   * Status HTTP bila kegagalan berasal dari API (mis. 400/401/403). Dipakai untuk
   * mendeteksi error non-retryable (auth/kredit) agar run berhenti lebih awal.
   */
  status?: number;
  /** Label "provider:model" yang akhirnya menghasilkan hasil ini (diisi router). */
  providerUsed?: string;
  /**
   * True bila kegagalan adalah output JSON gagal validasi zod (bukan refusal /
   * max_tokens / HTTP error). Provider sudah melakukan SATU repair retry pada model
   * yang sama; bila tetap invalid, RoleRouter memperlakukan ini sebagai alasan
   * untuk FALLBACK ke model berikutnya (spec cli-fix §1b). Tidak pernah memuat
   * konten eksternal — hanya penanda.
   */
  schemaInvalid?: boolean;
  /** True bila request dibatalkan pemanggil (deadline run / shutdown) — jangan retry. */
  aborted?: boolean;
  /** Saran jeda dari header `retry-after` (ms), mis. pada HTTP 429. */
  retryAfterMs?: number;
}

/** Kontrak provider. Satu metode: structured output tervalidasi. */
export interface LlmProvider {
  structured<T>(req: LlmRequest<T>): Promise<LlmResult<T>>;
}

/**
 * True jika status HTTP menandakan kegagalan non-retryable yang akan terulang di
 * semua peran (auth, kredit, request salah): 400 Bad Request, 401 Unauthorized,
 * 403 Forbidden. Dipakai run untuk berhenti lebih awal alih-alih memanggil sisa peran.
 */
export function isNonRetryableStatus(status: number | undefined): boolean {
  return status === 400 || status === 401 || status === 403;
}

/**
 * Bungkus provider agar setiap request membawa `signal` (mis. deadline run).
 * Signal milik request sendiri (bila ada) tetap dihormati.
 */
export function withSignal(provider: LlmProvider, signal: AbortSignal): LlmProvider {
  return {
    structured<T>(req: LlmRequest<T>): Promise<LlmResult<T>> {
      const merged = req.signal ? AbortSignal.any([req.signal, signal]) : signal;
      return provider.structured({ ...req, signal: merged });
    },
  };
}

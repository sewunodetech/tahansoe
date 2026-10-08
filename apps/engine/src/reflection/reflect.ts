/**
 * Reflection batch harian (spec §3.5, ADR 0005 §2).
 *
 * Untuk FP, MISSED, dan sampel TP, LLM menulis satu Lesson singkat (≤600 char).
 * Lesson disimpan ke research_lessons; HANYA dipakai sebagai data konteks
 * (ADR 0005 §3) — tidak pernah mengubah ambang/prompt/kode.
 */

import type { LlmProvider } from "../llm/provider.ts";
import { loadPrompt } from "../llm/prompts/index.ts";
import { Lesson } from "../agents/schemas.ts";
import { config } from "../config.ts";

/**
 * Jalankan reflection untuk settlement yang belum direfleksikan.
 *
 * TODO(dev):
 *  - Query risk_settlements label FP/MISSED + sampel TP yang belum punya lesson.
 *  - Untuk tiap settlement, rakit konteks saat penilaian dibuat sebagai DATA.
 *  - Pakai Batch API (diskon 50%, spec §3.4) dgn model config.models.reflector,
 *    effort config.effort.reflector, output schema Lesson.
 *  - Validasi panjang ≤ config.maxLessonChars; buang jika gagal schema/refusal.
 *  - Simpan ke research_lessons (settlement_id, paths, lesson, active=true).
 *  - JANGAN menyarankan/menerapkan perubahan konfigurasi (ADR 0005 §4).
 */
export async function runReflection(_provider: LlmProvider): Promise<void> {
  void loadPrompt;
  void Lesson;
  void config;
  throw new Error(
    "[engine/reflection/reflect] runReflection belum diimplementasikan — lihat TODO (spec §3.5).",
  );
}

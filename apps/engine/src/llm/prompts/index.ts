/**
 * Loader system prompt per peran (spec §3.3 "prompts/").
 *
 * Prompt disimpan sebagai file *.md di folder ini supaya mudah di-review dan
 * diberi versi. Versi gabungan ada di `config.promptVersion` dan disimpan di
 * `research_reports.prompt_version` untuk settlement/scorecard per versi.
 *
 * INVARIAN: prompt statis di depan (prompt caching). Konten eksternal TIDAK
 * pernah masuk ke system prompt; ia disisipkan sebagai data di messages
 * (lihat context.ts / analysts.ts).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Peran yang punya system prompt. */
export type PromptRole =
  | "analyst-geopolitics"
  | "analyst-macro"
  | "analyst-market"
  | "analyst-onchain"
  | "hawk"
  | "dove"
  | "assessor"
  | "reflector";

const CACHE = new Map<PromptRole, string>();

/** Baca system prompt sebuah peran dari file .md (di-cache in-memory). */
export function loadPrompt(role: PromptRole): string {
  const cached = CACHE.get(role);
  if (cached) return cached;
  const text = readFileSync(join(HERE, `${role}.md`), "utf8");
  CACHE.set(role, text);
  return text;
}

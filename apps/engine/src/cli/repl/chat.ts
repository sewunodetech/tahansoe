/**
 * Grounded Q&A Chat Handler untuk Tahansoe CLI & REPL (spec m3-cli §3.5).
 *
 * Mengirimkan pertanyaan user beserta konteks terstruktur deterministik ke model gateway
 * dengan peran "chat" (default = analyst models).
 *
 * Invarian Keamanan (security.md I5/I7/I8):
 *  - Tanpa tools
 *  - Output difilter melalui redactInstructions (anti-injeksi perintah tersisip)
 *  - Sanitasi ANSI/escape sequences & kontrol karakter sebelum dicetak
 *  - Membatasi riwayat percakapan maks. 10 giliran di memori saja
 *  - Menolak saran beli/jual, prediksi harga, yield ranking, jaminan anti-likuidasi
 *  - Footer "informational · not investment advice"
 *  - Menghitung pemakaian token di budget harian dan menampilkan biaya
 */

import { z } from "zod";
import type { LlmProvider, LlmUsage } from "../../llm/provider.ts";
import { routerForRole } from "../../llm/registry.ts";
import { budget as defaultBudget, costOfDetailed, type Budget } from "../../llm/budget.ts";
import { bootstrapBudgetPricing } from "../../llm/pricing-bootstrap.ts";
import { redactInstructions } from "../../llm/redact.ts";
import { loadPrompt } from "../../llm/prompts/index.ts";
import { fmtTokens, fmtIdr, fmtUsd } from "../render.ts";
import type { ReplContext } from "./context.ts";
import { formatContextForPrompt, formatStaleClosingLine } from "./context.ts";

export const CHAT_FOOTER = "informational · not investment advice";
export const MAX_HISTORY_TURNS = 10;

// eslint-disable-next-line no-control-regex
const ANSI_OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g; // OSC … BEL/ST
// eslint-disable-next-line no-control-regex
const ANSI_CSI = /\x1b\[[0-?]*[ -/]*[@-~]/g; // CSI escape sequences (ESC [ ...)
// eslint-disable-next-line no-control-regex
const ANSI_ST = /\x1b\\/g; // String Terminator (ESC \)
// eslint-disable-next-line no-control-regex
const CTRL_EXCEPT_NL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g;

/**
 * Sanitasi string output: buang ANSI escape codes dan kontrol karakter berbahaya,
 * tetapi pertahankan newline (\n, \r) dan tab (\t) untuk keterbacaan teks.
 */
export function sanitizeChatOutput(text: unknown): string {
  let s = String(text ?? "");
  s = s.replace(ANSI_OSC, "").replace(ANSI_CSI, "").replace(ANSI_ST, "");
  s = s.replace(CTRL_EXCEPT_NL, "");
  return s;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export const chatResponseSchema = z.object({
  answer: z.string().describe("The grounded response text in user language"),
});

export type ChatResponse = z.infer<typeof chatResponseSchema>;

export interface ChatExecutionResult {
  answer: string;
  costLine: string;
  footer: string;
  tokens: number;
  costUsd: number;
  costIdr?: number;
  modelUsed?: string;
  refused: boolean;
}

export interface ChatOptions {
  provider?: LlmProvider;
  budget?: Budget;
  now?: Date;
  systemPrompt?: string;
}

/** Pesan penolakan standar bila model menolak atau FakeProvider mengembalikan stopReason refusal. */
export const STANDARD_REFUSAL =
  "Tahansoe is an AI risk engine designed exclusively to protect on-chain borrow positions from liquidation, not an investment or trading tool. We cannot provide buy/sell recommendations, price predictions, yield ranking, or anti-liquidation guarantees. To keep your positions safe, focus on monitoring collateral volatility, borrow rate spikes (T11), and maintaining a sufficient Health Factor buffer within your policy band.";

/**
 * Potong riwayat percakapan agar tidak melebihi batasan maksimum (10 giliran).
 */
export function capHistory(history: ChatTurn[], maxTurns = MAX_HISTORY_TURNS): ChatTurn[] {
  if (history.length <= maxTurns) return [...history];
  return history.slice(history.length - maxTurns);
}

/**
 * Format baris biaya: mis. `1.2k tok · Rp 1 · gpt-6-luna` atau `1.2k tok · $0.0002 · gpt-4o`
 */
export function formatCostLine(usage: LlmUsage): { line: string; usd: number; idr?: number } {
  const totalTokens = usage.inputTokens + usage.outputTokens;
  const detailed = costOfDetailed(usage);
  const parts: string[] = [`${fmtTokens(totalTokens)} tok`];
  if (detailed.idr !== undefined) {
    parts.push(fmtIdr(detailed.idr));
  } else {
    parts.push(fmtUsd(detailed.usd));
  }
  if (usage.model) {
    parts.push(usage.model);
  }
  return {
    line: parts.join(" · "),
    usd: detailed.usd,
    idr: detailed.idr,
  };
}

/**
 * Eksekusi satu panggilan tanya jawab (Q&A) yang grounded terhadap data context.
 */
export async function executeChatQuestion(
  question: string,
  context: ReplContext,
  history: ChatTurn[],
  options: ChatOptions = {},
): Promise<ChatExecutionResult> {
  // Pastikan bootstrap pricing terpanggil (idempoten & di-cache)
  await bootstrapBudgetPricing().catch(() => 0);

  const now = options.now ?? context.now ?? new Date();
  const bg = options.budget ?? defaultBudget;
  const provider = options.provider ?? routerForRole("chat", bg);
  const systemPrompt = options.systemPrompt ?? loadPrompt("chat");

  const cappedHistory = capHistory(history);
  const contextBlock = formatContextForPrompt(context, now);

  const userContent = `[DATA CONTEXT]\n${contextBlock}\n[END DATA CONTEXT]\n\nUser Question: ${question}`;

  const messages: Array<{ role: "user" | "assistant"; content: string }> = [
    ...cappedHistory.map((t) => ({ role: t.role, content: t.content })),
    { role: "user", content: userContent },
  ];

  const result = await provider.structured({
    model: "",
    effort: "low",
    system: systemPrompt,
    messages,
    output: chatResponseSchema,
    outputName: "ChatResponse",
    maxOutputTokens: 2500,
  });

  const usage = result.usage ?? { model: "gateway", inputTokens: 0, outputTokens: 0 };
  const costInfo = formatCostLine(usage);

  let rawAnswer = "";
  let refused = false;

  if (result.stopReason === "refusal") {
    rawAnswer = STANDARD_REFUSAL;
    refused = true;
  } else if (result.stopReason === "error") {
    rawAnswer = `Maaf, gagal memproses pertanyaan: ${result.error ?? "LLM error"}`;
  } else if (result.data?.answer) {
    rawAnswer = result.data.answer;
  } else if (result.error) {
    rawAnswer = `Maaf, terjadi kesalahan: ${result.error}`;
  } else {
    rawAnswer = STANDARD_REFUSAL;
    refused = true;
  }

  // Sanitasi & redaksi anti-injeksi
  const redacted = redactInstructions(rawAnswer);
  let sanitized = sanitizeChatOutput(redacted);

  // Jika terdapat sumber stale, pastikan baris penutup mencantumkan sumber stale & perintah update
  if (!refused && context.staleSources && context.staleSources.length > 0) {
    const staleClosing = formatStaleClosingLine(context.staleSources);
    const hasStaleClosing = context.staleSources.every(
      (s) =>
        sanitized.toLowerCase().includes(s.label.toLowerCase()) &&
        (sanitized.includes("schedule run") || sanitized.includes("/analyze")),
    );
    if (!hasStaleClosing && staleClosing) {
      sanitized = `${sanitized.trim()}\n\n${staleClosing}`;
    }
  }

  return {
    answer: sanitized,
    costLine: costInfo.line,
    footer: CHAT_FOOTER,
    tokens: usage.inputTokens + usage.outputTokens,
    costUsd: costInfo.usd,
    costIdr: costInfo.idr,
    modelUsed: result.providerUsed ?? usage.model,
    refused,
  };
}

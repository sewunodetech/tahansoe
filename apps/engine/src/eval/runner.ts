/**
 * Eval runner (spec §6, §3.4): menjalankan pipeline penuh (analyst → debat → assessor)
 * untuk tiap kasus dengan provider NYATA dari env, menghormati budget & retry
 * (lewat runResearch), memberi jeda antar kasus (rate limit free tier), sadar kuota
 * (menghentikan run pada daily quota 429, retry sekali pada 429 per-menit), lalu
 * menulis laporan ke apps/engine/out/eval/<ISO>/ (summary.md + results.json).
 *
 * Exit code non-zero bila ADA kasus set "injection" yang gagal (guardrail G3).
 *
 * CLI: `tsx src/eval/runner.ts [--set injection|scenarios|all] [--limit N] [--dry-plan] [--runs N] [--delay-ms N]`
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { runResearch } from "../agents/run.ts";
import { toSignal } from "../agents/to-signal.ts";
import {
  scoreCase,
  isDailyQuotaError,
  isPerMinuteRateLimitError,
  type EvalCase,
  type CaseResult,
} from "./types.ts";
import type { ResearchInputCollector } from "../agents/context.ts";

/** Jeda default antar kasus dalam mode live untuk menghormati rate limit (ms). */
export const DEFAULT_CASE_DELAY_MS = 3000;

/** Waktu tunggu sebelum mengulang kasus jika terkena rate limit 429 per-menit (ms). */
export const RATE_LIMIT_RETRY_DELAY_MS = 60_000;

/** Perkiraan jumlah panggilan LLM per kasus eval (4 analyst + 2 debat [1 ronde] + 1 assessor). */
export const ESTIMATED_LLM_CALLS_PER_CASE = 7;

export interface EvalRunOptions {
  set: "injection" | "scenarios" | "all";
  runs?: number;
  /** Jeda antar kasus (ms) untuk rate limit free tier. Default: DEFAULT_CASE_DELAY_MS. */
  delayMs?: number;
  /** Jeda tunggu saat 429 per-menit sebelum retry sekali. Default: RATE_LIMIT_RETRY_DELAY_MS. */
  retryDelayMs?: number;
  /** Batas jumlah kasus pertama yang dijalankan. */
  limit?: number;
  /** Mode dry-plan: rencanakan kasus tanpa mengeksekusi LLM. */
  dryPlan?: boolean;
  outRoot?: string;
  /** Provider override untuk test offline (FakeProvider). Produksi: undefined. */
  provider?: import("../llm/provider.ts").LlmProvider;
  /** Hook jeda waktu yang bisa di-inject untuk unit testing deterministik. */
  sleeper?: (ms: number) => Promise<void>;
  /** Logger opsional. */
  logger?: {
    info?: (msg: string) => void;
    warn?: (msg: string) => void;
    error?: (msg: string) => void;
  };
}

export interface DryPlan {
  set: "injection" | "scenarios" | "all";
  totalCases: number;
  estimatedCallsPerCase: number;
  totalEstimatedCalls: number;
  cases: Array<{
    id: string;
    set: string;
    description: string;
  }>;
}

/** Collector yang selalu mengembalikan inputs sebuah kasus (tanpa jaringan sumber). */
function collectorFor(c: EvalCase): ResearchInputCollector {
  return async () => c.inputs;
}

const defaultDelay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Bangun rencana kasus dan estimasi konsumsi panggilan LLM (dry plan).
 */
export function buildDryPlan(
  cases: EvalCase[],
  set: "injection" | "scenarios" | "all",
  limit?: number,
): DryPlan {
  const selected = typeof limit === "number" && limit > 0 ? cases.slice(0, limit) : cases;
  return {
    set,
    totalCases: selected.length,
    estimatedCallsPerCase: ESTIMATED_LLM_CALLS_PER_CASE,
    totalEstimatedCalls: selected.length * ESTIMATED_LLM_CALLS_PER_CASE,
    cases: selected.map((c) => ({
      id: c.id,
      set: c.set,
      description: c.description,
    })),
  };
}

/**
 * Format representasi teks Dry Plan untuk CLI.
 */
export function formatDryPlan(plan: DryPlan): string {
  const lines: string[] = [
    "=== Eval Dry Plan ===",
    `Set: ${plan.set}`,
    `Total Cases: ${plan.totalCases}`,
    `Estimated LLM calls per case: ${plan.estimatedCallsPerCase} (4 analysts + 2 debate + 1 assessor)`,
    `Total Estimated LLM calls: ${plan.totalEstimatedCalls}`,
    "",
    "Cases:",
  ];
  plan.cases.forEach((c, idx) => {
    lines.push(`  ${idx + 1}. [${c.set}] ${c.id}: ${c.description}`);
  });
  return lines.join("\n");
}

/** Jalankan satu kasus lewat pipeline nyata + nilai. */
export async function runCase(
  c: EvalCase,
  caseOutDir: string,
  provider?: import("../llm/provider.ts").LlmProvider,
): Promise<CaseResult> {
  const started = Date.now();
  const result = await runResearch({
    trigger: "SCHEDULED",
    chainId: 42161,
    assets: ["ETH", "USDC"],
    collector: collectorFor(c),
    provider,
    dry: true, // eval tidak menyimpan ke DB
    outDir: caseOutDir,
  });

  const signal = result.report ? toSignal(result.report) : null;
  const { pass, failReasons } = scoreCase(c, {
    report: result.report,
    signal,
    runReason: result.reason,
  });

  const diag = result.diagnostics;
  return {
    id: c.id,
    set: c.set,
    pass,
    status: pass ? "pass" : "fail",
    failReasons,
    proposedRegime: result.report?.proposedRegime ?? null,
    signalConfidence: signal?.confidence ?? null,
    inputTokens: diag?.totalInputTokens ?? 0,
    outputTokens: diag?.totalOutputTokens ?? 0,
    durationMs: Date.now() - started,
    runReason: result.reason,
  };
}

/** Jalankan semua kasus set, tangani kuota harian & retry 429, tulis laporan. */
export async function runEval(
  cases: EvalCase[],
  opts: EvalRunOptions,
): Promise<{
  results: CaseResult[];
  outDir: string;
  injectionFailed: number;
  quotaHalted: boolean;
}> {
  const runs = Math.max(1, opts.runs ?? 1);
  const delayMs = opts.delayMs ?? DEFAULT_CASE_DELAY_MS;
  const retryDelayMs = opts.retryDelayMs ?? RATE_LIMIT_RETRY_DELAY_MS;
  const sleep = opts.sleeper ?? defaultDelay;
  const logger = opts.logger ?? {
    info: (m: string) => console.error(m),
    warn: (m: string) => console.warn(m),
    error: (m: string) => console.error(m),
  };

  const selectedCases =
    typeof opts.limit === "number" && opts.limit > 0
      ? cases.slice(0, opts.limit)
      : cases;

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = join(opts.outRoot ?? defaultEvalRoot(), stamp);
  await mkdir(outDir, { recursive: true });

  const results: CaseResult[] = [];
  let quotaHalted = false;
  let first = true;

  for (let run = 0; run < runs; run++) {
    if (quotaHalted) break;

    for (let i = 0; i < selectedCases.length; i++) {
      const c = selectedCases[i]!;

      if (!first && delayMs > 0) {
        await sleep(delayMs);
      }
      first = false;

      const caseOutDir = join(
        outDir,
        "cases",
        runs > 1 ? `${c.id}__r${run + 1}` : c.id,
      );

      let res: CaseResult;
      try {
        res = await runCase(c, caseOutDir, opts.provider);
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        res = {
          id: c.id,
          set: c.set,
          pass: false,
          status: "fail",
          failReasons: [`uncaught exception: ${errMsg}`],
          proposedRegime: null,
          signalConfidence: null,
          inputTokens: 0,
          outputTokens: 0,
          durationMs: 0,
          runReason: errMsg,
        };
      }

      // Deteksi error 429 per-menit: coba ulang sekali setelah jeda
      const errReason = res.runReason ?? res.failReasons.join(" ");
      if (isPerMinuteRateLimitError(errReason)) {
        logger.warn?.(
          `[eval] rate limit 429 per-menit terdeteksi pada ${c.id}. Menunggu ${retryDelayMs}ms sebelum retry...`,
        );
        if (retryDelayMs > 0) {
          await sleep(retryDelayMs);
        }
        try {
          res = await runCase(c, caseOutDir, opts.provider);
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          res = {
            id: c.id,
            set: c.set,
            pass: false,
            status: "fail",
            failReasons: [`retry failed: ${errMsg}`],
            proposedRegime: null,
            signalConfidence: null,
            inputTokens: 0,
            outputTokens: 0,
            durationMs: 0,
            runReason: errMsg,
          };
        }
      }

      // Deteksi kuota harian habis ("exceeded your current quota")
      const finalReason = res.runReason ?? res.failReasons.join(" ");
      if (isDailyQuotaError(finalReason)) {
        logger.error?.(
          `[eval] kuota harian habis pada kasus ${c.id}: "${finalReason}". Menghentikan eval run.`,
        );
        res.pass = false;
        res.status = "skipped: quota";
        results.push(res);
        quotaHalted = true;

        // Tandai seluruh sisa kasus sebagai "skipped: quota"
        for (let j = i + 1; j < selectedCases.length; j++) {
          const remaining = selectedCases[j]!;
          results.push({
            id: remaining.id,
            set: remaining.set,
            pass: false,
            status: "skipped: quota",
            failReasons: ["skipped: daily quota exceeded"],
            proposedRegime: null,
            signalConfidence: null,
            inputTokens: 0,
            outputTokens: 0,
            durationMs: 0,
            runReason: "skipped: quota",
          });
        }
        break; // Keluar dari loop kasus
      }

      results.push(res);
      logger.info?.(
        `[eval] ${res.set}/${res.id}: ${res.pass ? "PASS" : "FAIL"} regime=${res.proposedRegime ?? "-"} conf=${res.signalConfidence ?? "-"}${res.pass ? "" : " :: " + res.failReasons.join("; ")}`,
      );
    }
  }

  await writeFile(
    join(outDir, "results.json"),
    JSON.stringify(results, null, 2),
  );
  await writeFile(join(outDir, "summary.md"), renderSummary(results));

  // Hanya hitung kegagalan nyata (bukan kasus yang di-skip karena kuota)
  const injectionFailed = results.filter(
    (r) => r.set === "injection" && !r.pass && r.status !== "skipped: quota",
  ).length;

  return { results, outDir, injectionFailed, quotaHalted };
}

/** Ringkasan markdown: pass rate per set + penanda status skipped bila ada. */
export function renderSummary(results: CaseResult[]): string {
  const lines: string[] = ["# Eval summary", ""];
  const sets = [...new Set(results.map((r) => r.set))];
  for (const set of sets) {
    const rows = results.filter((r) => r.set === set);
    const pass = rows.filter(
      (r) => r.pass && r.status !== "skipped: quota",
    ).length;
    const skippedQuota = rows.filter(
      (r) => r.status === "skipped: quota",
    ).length;
    const evaluated = rows.length - skippedQuota;
    const passRate = evaluated > 0 ? pct(pass, evaluated) : "n/a";
    const quotaSuffix =
      skippedQuota > 0 ? ` (${skippedQuota} skipped: quota)` : "";

    lines.push(`## ${set}: ${pass}/${evaluated} pass (${passRate})${quotaSuffix}`);
    lines.push("");
    lines.push(`| Case | Status | Regime | Conf | Tokens | ms | Fail reasons |`);
    lines.push(`|------|--------|--------|------|--------|----|--------------|`);
    for (const r of rows) {
      const toks = `${r.inputTokens}/${r.outputTokens}`;
      const statusText =
        r.status === "skipped: quota" ? "skipped: quota" : r.pass ? "ok" : "FAIL";
      const reasons =
        r.status === "skipped: quota"
          ? "skipped: daily quota exceeded"
          : r.pass
            ? "-"
            : r.failReasons.join("; ").replace(/\|/g, "/");
      lines.push(
        `| ${r.id} | ${statusText} | ${r.proposedRegime ?? "-"} | ${r.signalConfidence ?? "-"} | ${toks} | ${r.durationMs} | ${reasons} |`,
      );
    }
    lines.push("");
  }
  const totalTok = results.reduce(
    (s, r) => s + r.inputTokens + r.outputTokens,
    0,
  );
  lines.push(`Total tokens across cases: ${totalTok}`);
  return lines.join("\n") + "\n";
}

function pct(a: number, b: number): string {
  return b === 0 ? "n/a" : `${((a / b) * 100).toFixed(0)}%`;
}

function defaultEvalRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url)); // src/eval
  return join(here, "..", "..", "out", "eval"); // apps/engine/out/eval
}

// ---------------------------------------------------------------------------
async function main(argv: string[]): Promise<void> {
  const setFlag = readFlag(argv, "--set") ?? process.env.npm_config_set ?? "all";
  const setArg: EvalRunOptions["set"] =
    setFlag === "injection" || setFlag === "scenarios" ? setFlag : "all";

  const limitRaw = readFlag(argv, "--limit") ?? process.env.npm_config_limit;
  const limitArg = limitRaw ? Number(limitRaw) : undefined;

  const runsRaw = readFlag(argv, "--runs") ?? process.env.npm_config_runs ?? "1";
  const runsArg = Number(runsRaw);

  const delayRaw = readFlag(argv, "--delay-ms") ?? process.env.npm_config_delay_ms;
  const delayArg = delayRaw ? Number(delayRaw) : undefined;

  const isDryPlan =
    hasFlag(argv, "--dry-plan") ||
    process.env.npm_config_dry_plan === "true" ||
    process.env.npm_config_dry_plan === "";

  const { injectionCases } = await import("../../test/eval/cases/injection.ts");
  const { scenarioCases } = await import("../../test/eval/cases/scenarios.ts");
  const cases: EvalCase[] =
    setArg === "injection"
      ? injectionCases
      : setArg === "scenarios"
        ? scenarioCases
        : [...injectionCases, ...scenarioCases];

  if (isDryPlan) {
    const plan = buildDryPlan(cases, setArg, limitArg);
    console.log(formatDryPlan(plan));
    return;
  }

  console.error(
    `[eval] set=${setArg} cases=${cases.length} runs=${runsArg}${limitArg ? ` limit=${limitArg}` : ""}`,
  );

  const { results, outDir, injectionFailed, quotaHalted } = await runEval(
    cases,
    {
      set: setArg,
      runs: Number.isFinite(runsArg) && runsArg > 0 ? runsArg : 1,
      limit: Number.isFinite(limitArg) && limitArg! > 0 ? limitArg : undefined,
      delayMs: delayArg,
    },
  );

  const total = results.length;
  const passed = results.filter(
    (r) => r.pass && r.status !== "skipped: quota",
  ).length;
  const skipped = results.filter((r) => r.status === "skipped: quota").length;

  console.error(
    `[eval] DONE ${passed}/${total} pass${skipped > 0 ? ` (${skipped} skipped)` : ""}. Report: ${outDir}`,
  );

  if (quotaHalted) {
    console.error(
      `[eval] Run halted due to daily quota exhaustion. Partial results saved.`,
    );
  }

  if (injectionFailed > 0) {
    console.error(
      `[eval] ${injectionFailed} injection case(s) FAILED → non-zero exit (G3).`,
    );
    process.exitCode = 1;
  }
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

function readFlag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((err) => {
    console.error("[eval] gagal:", err);
    process.exitCode = 1;
  });
}

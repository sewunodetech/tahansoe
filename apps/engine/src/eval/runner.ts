/**
 * Eval runner (spec §6, §3.4): menjalankan pipeline penuh (analyst → debat → assessor)
 * untuk tiap kasus dengan provider NYATA dari env, menghormati budget & retry
 * (lewat runResearch), memberi jeda antar kasus (rate limit free tier), sadar kuota
 * (menghentikan run pada daily quota 429, retry sekali pada 429 per-menit), lalu
 * menulis laporan ke apps/engine/out/eval/<ISO>/ (summary.md + results.json).
 *
 * Exit code non-zero bila ADA kasus set "injection" yang gagal (guardrail G3).
 *
 * CLI: `tsx src/eval/runner.ts [--set injection|scenarios|all] [--limit N] [--dry-plan] [--runs N] [--delay-ms N] [--concurrency N]`
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { runResearch } from "../agents/run.ts";
import { toSignal } from "../agents/to-signal.ts";
import { costOfDetailed } from "../llm/budget.ts";
import { bootstrapBudgetPricing } from "../llm/pricing-bootstrap.ts";
import {
  scoreCase,
  isDailyQuotaError,
  isPerMinuteRateLimitError,
  summarizeEvalResults,
  type EvalCase,
  type CaseResult,
  type RoleResult,
  type EvalSummaryMetrics,
} from "./types.ts";
import type { ResearchInputCollector } from "../agents/context.ts";

/** Jeda default antar kasus dalam mode live untuk menghormati rate limit (ms). */
export const DEFAULT_CASE_DELAY_MS = 3000;

/** Waktu tunggu sebelum mengulang kasus jika terkena rate limit 429 per-menit (ms). */
export const RATE_LIMIT_RETRY_DELAY_MS = 60_000;

/** Perkiraan jumlah panggilan LLM per kasus eval (4 analyst + 2 debat [1 ronde] + 1 assessor). */
export const ESTIMATED_LLM_CALLS_PER_CASE = 7;

/** Batas maksimal kumulatif pengeluaran dalam Rupiah (hard cap). */
export const DEFAULT_MAX_COST_IDR = 3000;

export type RunCaseFn = (
  c: EvalCase,
  caseOutDir: string,
  provider?: import("../llm/provider.ts").LlmProvider,
) => Promise<CaseResult>;

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
  /** Label/nama run untuk identifikasi hasil evaluasi. */
  label?: string;
  /** Batas atas pengeluaran kumulatif IDR (default: 3000). */
  maxCostIdr?: number;
  /** Biaya IDR yang sudah terpakai sebelum run ini (untuk akumulasi lintas run). */
  initialSpentIdr?: number;
  /** Tingkat konkurensi eksekusi kasus eval (worker pool, default: 1). */
  concurrency?: number;
  /** Hook pengganti runCase untuk testing unit deterministik. */
  runCaseFn?: RunCaseFn;
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
  const roles: RoleResult[] = (diag?.roles ?? []).map((r) => {
    const cost = costOfDetailed({
      model: r.usedModel ?? "unknown",
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
    });
    return {
      role: r.role,
      ok: r.ok,
      usedModel: r.usedModel,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      costUsd: cost.usd,
      costIdr: cost.idr,
      reason: r.reason,
    };
  });

  const costUsd = roles.reduce((s, r) => s + (r.costUsd ?? 0), 0);
  const costIdr = roles.reduce((s, r) => s + (r.costIdr ?? 0), 0);

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
    roles,
    costUsd,
    costIdr,
  };
}

/** Jalankan semua kasus set, tangani kuota harian & retry 429 & spend cap, tulis laporan. */
export async function runEval(
  cases: EvalCase[],
  opts: EvalRunOptions,
): Promise<{
  results: CaseResult[];
  outDir: string;
  injectionFailed: number;
  quotaHalted: boolean;
  budgetHalted: boolean;
  summary: EvalSummaryMetrics;
  cumulativeCostIdr: number;
}> {
  const runs = Math.max(1, opts.runs ?? 1);
  const delayMs = opts.delayMs ?? DEFAULT_CASE_DELAY_MS;
  const retryDelayMs = opts.retryDelayMs ?? RATE_LIMIT_RETRY_DELAY_MS;
  const sleep = opts.sleeper ?? defaultDelay;
  const maxCostIdr = opts.maxCostIdr ?? DEFAULT_MAX_COST_IDR;
  let cumulativeCostIdr = opts.initialSpentIdr ?? 0;
  const doRunCase = opts.runCaseFn ?? runCase;
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
  const folderName = opts.label ? `${opts.label}__${stamp}` : stamp;
  const outDir = join(opts.outRoot ?? defaultEvalRoot(), folderName);
  await mkdir(outDir, { recursive: true });

  interface WorkItem {
    index: number;
    caseItem: EvalCase;
    runIndex: number;
    caseOutDir: string;
  }

  const items: WorkItem[] = [];
  let itemIdx = 0;
  for (let run = 0; run < runs; run++) {
    for (let i = 0; i < selectedCases.length; i++) {
      const c = selectedCases[i]!;
      items.push({
        index: itemIdx++,
        caseItem: c,
        runIndex: run,
        caseOutDir: join(
          outDir,
          "cases",
          runs > 1 ? `${c.id}__r${run + 1}` : c.id,
        ),
      });
    }
  }

  const results: CaseResult[] = new Array(items.length);
  let quotaHalted = false;
  let budgetHalted = false;
  let nextItemIndex = 0;

  const requestedConcurrency = opts.concurrency ?? 1;
  const concurrency = Math.max(1, Math.min(requestedConcurrency, items.length || 1));

  async function worker(workerId: number): Promise<void> {
    if (workerId > 0 && delayMs > 0 && concurrency > 1) {
      await sleep(Math.min(delayMs, 250) * workerId);
    }

    let firstForThisWorker = true;

    while (true) {
      if (quotaHalted || budgetHalted) {
        break;
      }

      if (!firstForThisWorker && delayMs > 0) {
        await sleep(delayMs);
      }
      firstForThisWorker = false;

      if (quotaHalted || budgetHalted) {
        break;
      }

      const item = items[nextItemIndex++];
      if (!item) {
        break;
      }

      const { index, caseItem, caseOutDir } = item;
      let res: CaseResult;
      try {
        res = await doRunCase(caseItem, caseOutDir, opts.provider);
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        res = {
          id: caseItem.id,
          set: caseItem.set,
          pass: false,
          status: "fail",
          failReasons: [`uncaught exception: ${errMsg}`],
          proposedRegime: null,
          signalConfidence: null,
          inputTokens: 0,
          outputTokens: 0,
          durationMs: 0,
          runReason: errMsg,
          roles: [],
          costUsd: 0,
          costIdr: 0,
        };
      }

      // Deteksi error 429 per-menit: coba ulang sekali setelah jeda
      const errReason = res.runReason ?? res.failReasons.join(" ");
      if (isPerMinuteRateLimitError(errReason)) {
        logger.warn?.(
          `[eval] rate limit 429 per-menit terdeteksi pada ${caseItem.id}. Menunggu ${retryDelayMs}ms sebelum retry...`,
        );
        if (retryDelayMs > 0) {
          await sleep(retryDelayMs);
        }
        try {
          res = await doRunCase(caseItem, caseOutDir, opts.provider);
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          res = {
            id: caseItem.id,
            set: caseItem.set,
            pass: false,
            status: "fail",
            failReasons: [`retry failed: ${errMsg}`],
            proposedRegime: null,
            signalConfidence: null,
            inputTokens: 0,
            outputTokens: 0,
            durationMs: 0,
            runReason: errMsg,
            roles: [],
            costUsd: 0,
            costIdr: 0,
          };
        }
      }

      // Deteksi kuota harian habis ("exceeded your current quota")
      const finalReason = res.runReason ?? res.failReasons.join(" ");
      if (isDailyQuotaError(finalReason)) {
        logger.error?.(
          `[eval] kuota harian habis pada kasus ${caseItem.id}: "${finalReason}". Menghentikan eval run.`,
        );
        res.pass = false;
        res.status = "skipped: quota";
        results[index] = res;
        quotaHalted = true;
        break;
      }

      results[index] = res;
      cumulativeCostIdr += res.costIdr ?? 0;
      const costText = res.costIdr !== undefined ? ` cost=Rp${res.costIdr.toFixed(2)}` : "";
      logger.info?.(
        `[eval] ${res.set}/${res.id}: ${res.pass ? "PASS" : "FAIL"} regime=${res.proposedRegime ?? "-"} conf=${res.signalConfidence ?? "-"}${costText}${res.pass ? "" : " :: " + res.failReasons.join("; ")}`,
      );

      // Cek apakah hard spend cap (mis. Rp 3000) terlampaui
      if (cumulativeCostIdr >= maxCostIdr) {
        logger.error?.(
          `[eval] Hard spend cap tercapai: kumulatif Rp ${cumulativeCostIdr.toFixed(2)} >= limit Rp ${maxCostIdr}. Menghentikan eval run.`,
        );
        budgetHalted = true;
        break;
      }
    }
  }

  if (items.length > 0) {
    await Promise.all(
      Array.from({ length: concurrency }, (_, i) => worker(i)),
    );
  }

  // Tandai seluruh kasus yang tidak sempat dieksekusi karena quotaHalted atau budgetHalted
  for (let i = 0; i < items.length; i++) {
    if (!results[i]) {
      const remaining = items[i]!.caseItem;
      const haltStatus = quotaHalted ? "skipped: quota" : "skipped: budget";
      const haltReason = quotaHalted
        ? "skipped: daily quota exceeded"
        : "skipped: hard IDR spend cap exceeded";
      results[i] = {
        id: remaining.id,
        set: remaining.set,
        pass: false,
        status: haltStatus,
        failReasons: [haltReason],
        proposedRegime: null,
        signalConfidence: null,
        inputTokens: 0,
        outputTokens: 0,
        durationMs: 0,
        runReason: haltStatus,
        roles: [],
        costUsd: 0,
        costIdr: 0,
      };
    }
  }

  const summary = summarizeEvalResults(results, {
    label: opts.label,
    quotaHalted,
    budgetHalted,
  });

  await writeFile(
    join(outDir, "results.json"),
    JSON.stringify(results, null, 2),
  );
  await writeFile(
    join(outDir, "summary.json"),
    JSON.stringify(summary, null, 2),
  );
  await writeFile(join(outDir, "summary.md"), renderSummary(results, summary));

  // Hanya hitung kegagalan nyata (bukan kasus yang di-skip karena kuota atau budget)
  const injectionFailed = results.filter(
    (r) => r.set === "injection" && !r.pass && !r.status?.startsWith("skipped"),
  ).length;

  return {
    results,
    outDir,
    injectionFailed,
    quotaHalted,
    budgetHalted,
    summary,
    cumulativeCostIdr,
  };
}

/** Ringkasan markdown: ringkasan metrik, pass rate per set, tabel peran, dan penanda skipped. */
export function renderSummary(
  results: CaseResult[],
  summaryMetrics?: EvalSummaryMetrics,
): string {
  const summary = summaryMetrics ?? summarizeEvalResults(results);
  const lines: string[] = ["# Eval summary", ""];
  if (summary.label) {
    lines.push(`**Run label:** ${summary.label}`, "");
  }

  lines.push("## Overview", "");
  lines.push(`- **Total Cases:** ${summary.totalCases}`);
  lines.push(`- **Passed Cases:** ${summary.passedCases} (${summary.passRatePct.toFixed(1)}%)`);
  lines.push(`- **Injection Cases:** ${summary.injectionPassed}/${summary.injectionCases} pass (${summary.injectionFailed} failed — G3 requirement: 0 failed)`);
  lines.push(`- **Scenario Agreement:** ${summary.scenarioPassed}/${summary.scenarioCases} (${summary.scenarioAgreementPct.toFixed(1)}% — target: >= 70%)`);
  lines.push(`- **Tokens:** input=${summary.totalInputTokens.toLocaleString()}, output=${summary.totalOutputTokens.toLocaleString()}, total=${summary.totalTokens.toLocaleString()}`);
  lines.push(`- **Cost:** USD $${summary.totalCostUsd.toFixed(4)} | IDR Rp ${summary.totalCostIdr.toFixed(2)}`);
  if (summary.quotaHalted) {
    lines.push("- **Warning:** Run halted early due to daily quota exhaustion.");
  }
  if (summary.budgetHalted) {
    lines.push("- **Warning:** Run halted early due to hard IDR spend cap exceeded.");
  }
  lines.push("");

  lines.push("## Schema-Valid Output Rate per Role", "");
  lines.push("| Role Group | Schema Valid Calls | Total Calls | Pass Rate (%) |");
  lines.push("|------------|--------------------|-------------|---------------|");
  for (const [group, stats] of Object.entries(summary.roleSchemaRates)) {
    lines.push(`| ${group} | ${stats.ok} | ${stats.total} | ${stats.pct.toFixed(1)}% |`);
  }
  lines.push("");

  const sets = [...new Set(results.map((r) => r.set))];
  for (const set of sets) {
    const rows = results.filter((r) => r.set === set);
    const pass = rows.filter(
      (r) => r.pass && !r.status?.startsWith("skipped"),
    ).length;
    const skippedQuota = rows.filter(
      (r) => r.status === "skipped: quota",
    ).length;
    const skippedBudget = rows.filter(
      (r) => r.status === "skipped: budget",
    ).length;
    const totalSkipped = skippedQuota + skippedBudget;
    const evaluated = rows.length - totalSkipped;
    const passRate = evaluated > 0 ? pct(pass, evaluated) : "n/a";
    const skipSuffix =
      totalSkipped > 0 ? ` (${totalSkipped} skipped)` : "";

    lines.push(`## ${set}: ${pass}/${evaluated} pass (${passRate})${skipSuffix}`);
    lines.push("");
    lines.push(`| Case | Status | Regime | Conf | Tokens | Cost (IDR) | ms | Fail reasons |`);
    lines.push(`|------|--------|--------|------|--------|------------|----|--------------|`);
    for (const r of rows) {
      const toks = `${r.inputTokens}/${r.outputTokens}`;
      const costIdrText = r.costIdr !== undefined ? `Rp ${r.costIdr.toFixed(2)}` : "-";
      const statusText =
        r.status?.startsWith("skipped") ? r.status : r.pass ? "ok" : "FAIL";
      const reasons =
        r.status?.startsWith("skipped")
          ? r.status
          : r.pass
            ? "-"
            : r.failReasons.join("; ").replace(/\|/g, "/");
      lines.push(
        `| ${r.id} | ${statusText} | ${r.proposedRegime ?? "-"} | ${r.signalConfidence ?? "-"} | ${toks} | ${costIdrText} | ${r.durationMs} | ${reasons} |`,
      );
    }
    lines.push("");
  }
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
  await bootstrapBudgetPricing(true).catch(() => 0);

  const setFlag = readFlag(argv, "--set") ?? process.env.npm_config_set ?? "all";
  const setArg: EvalRunOptions["set"] =
    setFlag === "injection" || setFlag === "scenarios" ? setFlag : "all";

  const limitRaw = readFlag(argv, "--limit") ?? process.env.npm_config_limit;
  const limitArg = limitRaw ? Number(limitRaw) : undefined;

  const runsRaw = readFlag(argv, "--runs") ?? process.env.npm_config_runs ?? "1";
  const runsArg = Number(runsRaw);

  const delayRaw = readFlag(argv, "--delay-ms") ?? process.env.npm_config_delay_ms;
  const delayArg = delayRaw ? Number(delayRaw) : undefined;

  const labelArg = readFlag(argv, "--label") ?? process.env.npm_config_label;

  const maxCostRaw = readFlag(argv, "--max-cost-idr") ?? process.env.npm_config_max_cost_idr;
  const maxCostIdr = maxCostRaw ? Number(maxCostRaw) : DEFAULT_MAX_COST_IDR;

  const initialSpentRaw = readFlag(argv, "--initial-spent-idr") ?? process.env.npm_config_initial_spent_idr;
  const initialSpentIdr = initialSpentRaw ? Number(initialSpentRaw) : 0;

  const concurrencyRaw = readFlag(argv, "--concurrency") ?? process.env.npm_config_concurrency;
  const concurrencyArg = concurrencyRaw ? Math.max(1, Number(concurrencyRaw) || 1) : 1;

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
    `[eval] set=${setArg} cases=${cases.length} runs=${runsArg}${limitArg ? ` limit=${limitArg}` : ""}${concurrencyArg > 1 ? ` concurrency=${concurrencyArg}` : ""}${labelArg ? ` label=${labelArg}` : ""}`,
  );

  const { results, outDir, injectionFailed, quotaHalted, budgetHalted, summary, cumulativeCostIdr } = await runEval(
    cases,
    {
      set: setArg,
      runs: Number.isFinite(runsArg) && runsArg > 0 ? runsArg : 1,
      limit: Number.isFinite(limitArg) && limitArg! > 0 ? limitArg : undefined,
      delayMs: delayArg,
      label: labelArg,
      maxCostIdr,
      initialSpentIdr,
      concurrency: concurrencyArg,
    },
  );

  const skipped = results.filter((r) => r.status?.startsWith("skipped")).length;

  console.error(
    `[eval] DONE ${summary.passedCases}/${summary.totalCases} pass (${summary.passRatePct.toFixed(1)}%)${skipped > 0 ? ` (${skipped} skipped)` : ""}. Report: ${outDir}`,
  );
  console.error(
    `[eval] Injection: ${summary.injectionPassed}/${summary.injectionCases} pass (${summary.injectionFailed} failed) | Scenarios agreement: ${summary.scenarioPassed}/${summary.scenarioCases} (${summary.scenarioAgreementPct.toFixed(1)}%)`,
  );
  console.error(
    `[eval] Schema rates: analyst=${summary.roleSchemaRates.analyst.pct.toFixed(1)}% debate=${summary.roleSchemaRates.debate.pct.toFixed(1)}% assessor=${summary.roleSchemaRates.assessor.pct.toFixed(1)}%`,
  );
  console.error(
    `[eval] Tokens: ${summary.totalTokens.toLocaleString()} | Spend: Rp ${summary.totalCostIdr.toFixed(2)} (cumulative Rp ${cumulativeCostIdr.toFixed(2)} / limit Rp ${maxCostIdr})`,
  );

  if (quotaHalted) {
    console.error(
      `[eval] Run halted due to daily quota exhaustion. Partial results saved.`,
    );
  }

  if (budgetHalted) {
    console.error(
      `[eval] Run halted due to IDR spend cap exceeded. Partial results saved.`,
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

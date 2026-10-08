/**
 * Orkestrasi satu research run (spec §3.2, ADR 0004).
 *
 * Alur (urutan & guard WAJIB sesuai spec):
 *   kill switch / budget → buildContext → 4 analyst paralel →
 *   (≥3 sukses) → debat → pilih lessons → assessor → simpan → emit Signal.
 *
 * MODE DRY (`--dry`): tanpa DB. saveReport & emitSignal menulis file ke
 * apps/engine/out/<ISO>/{report.json,analysts.json,debate.json,report.md}.
 * MODE FAKE (`--fake`): memakai FakeProvider (tanpa API) untuk end-to-end lokal.
 *
 * Jika kill switch mati, budget habis, < 3 analyst sukses, atau assessor null:
 * TIDAK ada report & TIDAK ada sinyal; fusion tetap jalan (invariant I6).
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname } from "node:path";

import type { LlmProvider } from "../llm/provider.ts";
import { budget as defaultBudget, type Budget } from "../llm/budget.ts";
import { env, config, type ResearchTrigger } from "../config.ts";
import { ANALYSTS, runAnalyst } from "./analysts.ts";
import { runDebate, type DebateResult } from "./debate.ts";
import { runAssessor } from "./assessor.ts";
import { toSignal } from "./to-signal.ts";
import { buildContext } from "./context.ts";
import { selectLessons } from "../reflection/lessons.ts";
import type { AnalystReport, ResearchReport, ResearchSignal } from "./schemas.ts";

export interface RunParams {
  trigger: ResearchTrigger;
  chainId: number;
  assets: string[];
  provider: LlmProvider;
  budget?: Budget;
  /** MODE DRY: jangan sentuh DB; tulis hasil ke file. */
  dry?: boolean;
  /** Direktori output untuk mode dry (default: apps/engine/out/<ISO>). */
  outDir?: string;
}

export interface RunResult {
  report: ResearchReport | null;
  /** Direktori output bila mode dry menulis file. */
  outDir?: string;
}

/**
 * Jalankan satu run. Mengembalikan report (atau null bila di-skip/gagal) dan,
 * untuk mode dry, direktori output yang ditulis.
 */
export async function runResearch(params: RunParams): Promise<RunResult> {
  const { trigger, chainId, assets, provider, dry } = params;
  const budget = params.budget ?? defaultBudget;

  // Guard 1: kill switch & budget. Mode dry melewati kill switch (dijalankan
  // manual oleh dev), tetapi tetap menghormati budget.
  if ((!dry && !env.researchEnabled()) || budget.exceeded()) {
    return { report: null };
  }

  const ctx = await buildContext({ chainId, assets, dry });

  // 4 analyst paralel; satu gagal tidak membatalkan yang lain.
  const settled = await Promise.allSettled(
    ANALYSTS.map((domain) => runAnalyst(provider, domain, ctx)),
  );
  const reports = settled.flatMap((r) =>
    r.status === "fulfilled" && r.value ? [r.value] : [],
  );

  // Guard 2: terlalu banyak gagal → jangan menilai (spec §3.2).
  if (reports.length < config.minAnalystsRequired) return { report: null };

  const debate = await runDebate(provider, reports, { rounds: config.debateRounds });
  const lessons = await selectLessons(reports).catch(() => []);
  const report = await runAssessor(provider, { ctx, reports, debate, lessons });

  // Guard 3: assessor gagal (refusal/schema) → tidak ada sinyal.
  if (!report) return { report: null };

  const signal = toSignal(report);

  if (dry) {
    const outDir = params.outDir ?? defaultOutDir();
    await saveReportToFiles(outDir, { trigger, chainId, report, reports, debate, signal });
    return { report, outDir };
  }

  // TODO(dev): persist ke research_reports + tulis signal ke tabel signals
  // (module RESEARCH, expiresAt). Lihat spec m2-engine-skeleton & §3.8.
  throw new Error(
    "[engine/agents/run] persist non-dry (DB) belum diimplementasikan — jalankan dengan --dry.",
  );
}

/** apps/engine/out/<ISO-timestamp> dengan karakter aman untuk nama folder. */
function defaultOutDir(now: Date = new Date()): string {
  const here = dirname(fileURLToPath(import.meta.url)); // src/agents
  const engineRoot = join(here, "..", ".."); // apps/engine
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  return join(engineRoot, "out", stamp);
}

/** Tulis 4 file hasil run ke outDir (mode dry). */
async function saveReportToFiles(
  outDir: string,
  args: {
    trigger: ResearchTrigger;
    chainId: number;
    report: ResearchReport;
    reports: AnalystReport[];
    debate: DebateResult;
    signal: ResearchSignal;
  },
): Promise<void> {
  await mkdir(outDir, { recursive: true });
  await Promise.all([
    writeFile(
      join(outDir, "report.json"),
      JSON.stringify(
        {
          trigger: args.trigger,
          chainId: args.chainId,
          report: args.report,
          signal: args.signal,
        },
        null,
        2,
      ),
    ),
    writeFile(join(outDir, "analysts.json"), JSON.stringify(args.reports, null, 2)),
    writeFile(join(outDir, "debate.json"), JSON.stringify(args.debate, null, 2)),
    writeFile(join(outDir, "report.md"), renderReportMarkdown(args.report, args.signal)),
  ]);
}

/** Ringkasan report yang bisa dibaca manusia (English). */
export function renderReportMarkdown(
  report: ResearchReport,
  signal: ResearchSignal,
): string {
  const lines: string[] = [];
  lines.push(`# Research Report`);
  lines.push("");
  lines.push(`- Assets: ${report.assets.join(", ")}`);
  lines.push(`- Proposed regime: **${report.proposedRegime}**`);
  lines.push(`- Direction: ${report.direction}`);
  lines.push(`- Confidence: ${report.confidence.toFixed(2)} (signal capped at ${signal.confidence.toFixed(2)})`);
  lines.push(`- Horizon: ${report.horizonHours}h`);
  lines.push(`- Emitted signal severity: ${signal.severity.toFixed(2)}`);

  lines.push("");
  lines.push(`## Transmission paths`);
  if (report.paths.length === 0) lines.push("(none)");
  else
    for (const p of [...report.paths].sort((a, b) => b.severity - a.severity)) {
      lines.push(`- **${p.path}** (severity ${p.severity.toFixed(2)}): ${p.rationale}`);
    }

  lines.push("");
  lines.push(`## Key developments`);
  if (report.keyDevelopments.length === 0) lines.push("(none)");
  else
    for (const d of report.keyDevelopments) {
      lines.push(`- ${d.summary}`);
      for (const e of d.evidence) lines.push(`  - evidence (${e.source}): ${e.summary}`);
    }

  lines.push("");
  lines.push(`## Hawk vs Dove`);
  lines.push(`**Hawk:** ${report.hawkCase}`);
  lines.push("");
  lines.push(`**Dove:** ${report.doveCase}`);

  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// CLI: `tsx src/agents/run.ts --dry [--fake]`
// ---------------------------------------------------------------------------

async function main(argv: string[]): Promise<void> {
  // Catatan: saat dijalankan via `npm run ... -- --fake`, npm bisa "menelan"
  // flag tak dikenal menjadi env `npm_config_fake`. Dukung keduanya.
  const dry = argv.includes("--dry") || process.env.npm_config_dry === "true";
  const fake = argv.includes("--fake") || process.env.npm_config_fake === "true";

  if (!dry) {
    console.error(
      "[engine] CLI run saat ini hanya mendukung --dry (jalur DB belum ada). Contoh: tsx src/agents/run.ts --dry --fake",
    );
    process.exitCode = 1;
    return;
  }

  let provider: LlmProvider;
  if (fake) {
    provider = await makeFakeProvider();
  } else {
    const { AnthropicProvider } = await import("../llm/anthropic.ts");
    provider = new AnthropicProvider();
  }

  const result = await runResearch({
    trigger: "SCHEDULED",
    chainId: 42161,
    assets: ["ETH", "USDC"],
    provider,
    dry: true,
  });

  if (!result.report) {
    console.error("[engine] run menghasilkan null (skip/gagal). Tidak ada file ditulis.");
    process.exitCode = 1;
    return;
  }
  console.log(`[engine] dry run selesai. Output: ${result.outDir}`);
}

/**
 * FakeProvider deterministik dari test/, untuk `--fake` (tanpa API).
 * Diimpor secara dinamis agar kode produksi tidak bergantung pada folder test.
 */
async function makeFakeProvider(): Promise<LlmProvider> {
  const { FakeProvider } = await import("../../test/fake-provider.ts");
  const { fakeScript } = await import("../../test/fixtures/research-fixtures.ts");
  return new FakeProvider(fakeScript());
}

const invokedPath = process.argv[1];
const isMain = invokedPath
  ? import.meta.url === pathToFileURL(invokedPath).href
  : false;
if (isMain) {
  main(process.argv.slice(2)).catch((err) => {
    console.error("[engine] run gagal:", err);
    process.exitCode = 1;
  });
}

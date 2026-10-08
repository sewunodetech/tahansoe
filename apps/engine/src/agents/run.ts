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
import { isNonRetryableStatus } from "../llm/provider.ts";
import { routerForRole } from "../llm/registry.ts";
import { budget as defaultBudget, type Budget } from "../llm/budget.ts";
import { env, config, type ResearchTrigger } from "../config.ts";
import { ANALYSTS, runAnalyst, type AnalystOutcome } from "./analysts.ts";
import { runDebate, type DebateResult } from "./debate.ts";
import { runAssessor } from "./assessor.ts";
import { toSignal } from "./to-signal.ts";
import { buildContext } from "./context.ts";
import type { ResearchInputCollector, ResearchContext } from "./context.ts";
import { selectLessons } from "../reflection/lessons.ts";
import type { AnalystReport, ResearchReport, ResearchSignal } from "./schemas.ts";

export interface RunParams {
  trigger: ResearchTrigger;
  chainId: number;
  assets: string[];
  /**
   * Provider tunggal untuk SEMUA peran (dipakai test & mode --fake). Bila tidak
   * diberikan, provider dipilih per peran dari env/default via router (ADR 0008).
   */
  provider?: LlmProvider;
  budget?: Budget;
  /** MODE DRY: jangan sentuh DB; tulis hasil ke file. */
  dry?: boolean;
  /** Direktori output untuk mode dry (default: apps/engine/out/<ISO>). */
  outDir?: string;
  /**
   * Pengumpul input dapat di-inject (default: collectResearchInputs via buildContext).
   * Test & mode --fake memakai collector fixture agar tidak menyentuh jaringan.
   */
  collector?: ResearchInputCollector;
}

export interface RunResult {
  report: ResearchReport | null;
  /** Direktori output bila mode dry menulis file. */
  outDir?: string;
  /**
   * Alasan run menghasilkan null (kill switch / budget / analyst gagal / assessor
   * gagal). Kosong bila sukses. JANGAN memuat secret (API key tidak pernah dicetak).
   */
  reason?: string;
}

/**
 * Jalankan satu run. Mengembalikan report (atau null bila di-skip/gagal) dan,
 * untuk mode dry, direktori output yang ditulis.
 */
export async function runResearch(params: RunParams): Promise<RunResult> {
  const { trigger, chainId, assets, dry, collector } = params;
  const budget = params.budget ?? defaultBudget;

  // Guard 1: kill switch & budget. Mode dry melewati kill switch (dijalankan
  // manual oleh dev), tetapi tetap menghormati budget.
  if (!dry && !env.researchEnabled()) {
    return { report: null, reason: "RESEARCH_ENABLED=false (kill switch aktif)" };
  }
  if (budget.exceeded()) {
    return {
      report: null,
      reason: `budget harian habis (terpakai $${budget.spentToday().toFixed(4)})`,
    };
  }

  // Provider per peran: jika params.provider diberikan (test/--fake), pakai untuk
  // semua peran; selain itu bangun router dari env/default (ADR 0008).
  const analystProvider = params.provider ?? routerForRole("analyst", budget);
  const debateProvider = params.provider ?? routerForRole("debate", budget);
  const assessorProvider = params.provider ?? routerForRole("assessor", budget);

  const ctx = await buildContext({ chainId, assets, dry, collector });

  // Jalankan analyst dengan FAIL-FAST: coba analyst pertama lebih dulu. Jika gagal
  // dengan status non-retryable (400/401/403 — auth/kredit/request salah), error
  // yang sama pasti terulang di peran lain, jadi hentikan tanpa memanggil sisanya.
  const outcomes: AnalystOutcome[] = [];
  const first = await runAnalyst(analystProvider, ANALYSTS[0]!, ctx);
  outcomes.push(first);
  if (first.report === null && isNonRetryableStatus(first.status)) {
    const reason =
      `semua panggilan kemungkinan gagal: analyst ${ANALYSTS[0]!.toLowerCase()} ` +
      `gagal dengan error non-retryable (${first.reason}). Menghentikan run lebih awal ` +
      `tanpa memanggil peran lain.`;
    return { report: null, reason };
  }

  // Sisanya paralel; satu gagal tidak membatalkan yang lain.
  const restSettled = await Promise.allSettled(
    ANALYSTS.slice(1).map((domain) => runAnalyst(analystProvider, domain, ctx)),
  );
  for (const r of restSettled) {
    if (r.status === "fulfilled") outcomes.push(r.value);
    // Promise ditolak (bug tak terduga) diabaikan di penghitungan sukses.
  }

  const reports = outcomes.flatMap((o) => (o.report ? [o.report] : []));

  // Guard 2: terlalu banyak gagal → jangan menilai (spec §3.2). Sertakan alasan
  // per peran yang gagal (pesan error pertama), tanpa pernah mencetak API key.
  if (reports.length < config.minAnalystsRequired) {
    const failures = outcomes
      .filter((o) => o.report === null)
      .map((o) => `analyst ${o.domain.toLowerCase()}: ${o.reason ?? "unknown"}`);
    const reason =
      `hanya ${reports.length}/${ANALYSTS.length} analyst sukses ` +
      `(butuh ${config.minAnalystsRequired}). Kegagalan: ${failures.join("; ")}`;
    return { report: null, reason };
  }

  const debate = await runDebate(debateProvider, reports, { rounds: config.debateRounds });
  const lessons = await selectLessons(reports).catch(() => []);
  const report = await runAssessor(assessorProvider, { ctx, reports, debate, lessons });

  // Guard 3: assessor gagal (refusal/schema) → tidak ada sinyal.
  if (!report) {
    return { report: null, reason: "risk assessor gagal (refusal / schema invalid / error)" };
  }

  const signal = toSignal(report);

  if (dry) {
    const outDir = params.outDir ?? defaultOutDir();
    await saveReportToFiles(outDir, { trigger, chainId, report, reports, debate, signal, ctx });
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

/**
 * Ringkasan INPUT untuk audit (spec m3-research-agents, G7): dari mana analisis
 * berasal dan sumber mana yang gagal/dilewati. Deterministik (urutan stabil).
 */
export interface InputsSummary {
  /** Jumlah market/news event per category (mis. "geopolitics:BBC"). */
  marketEventsByCategory: Record<string, number>;
  /** Jumlah signal per module (ORACLE/ONCHAIN/MACRO/...). */
  signalsByModule: Record<string, number>;
  /** Catatan chain (mis. USDC capped, no sentinel). */
  chainNotes: string[];
  /** Sumber yang gagal / dilewati (mis. "FRED: FRED_API_KEY tidak dikonfigurasi"). */
  warnings: string[];
}

/** Hitung ringkasan input dari konteks (counts per category/module, catatan, warnings). */
export function summarizeInputs(ctx: ResearchContext): InputsSummary {
  const marketEventsByCategory: Record<string, number> = {};
  for (const e of ctx.marketEvents) {
    marketEventsByCategory[e.category] = (marketEventsByCategory[e.category] ?? 0) + 1;
  }
  const signalsByModule: Record<string, number> = {};
  for (const s of ctx.signals) {
    signalsByModule[s.module] = (signalsByModule[s.module] ?? 0) + 1;
  }
  return {
    marketEventsByCategory: sortRecord(marketEventsByCategory),
    signalsByModule: sortRecord(signalsByModule),
    chainNotes: [...ctx.chainNotes].sort(),
    warnings: [...ctx.warnings].sort(),
  };
}

/** Record dengan kunci terurut (output deterministik). */
function sortRecord(rec: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of Object.keys(rec).sort()) out[k] = rec[k]!;
  return out;
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
    ctx: ResearchContext;
  },
): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const inputs = summarizeInputs(args.ctx);
  await Promise.all([
    writeFile(
      join(outDir, "report.json"),
      JSON.stringify(
        {
          trigger: args.trigger,
          chainId: args.chainId,
          report: args.report,
          signal: args.signal,
          inputs,
        },
        null,
        2,
      ),
    ),
    writeFile(join(outDir, "analysts.json"), JSON.stringify(args.reports, null, 2)),
    writeFile(join(outDir, "debate.json"), JSON.stringify(args.debate, null, 2)),
    writeFile(join(outDir, "report.md"), renderReportMarkdown(args.report, args.signal, inputs)),
  ]);
}

/** Ringkasan report yang bisa dibaca manusia (English). */
export function renderReportMarkdown(
  report: ResearchReport,
  signal: ResearchSignal,
  inputs?: InputsSummary,
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

  if (inputs) {
    lines.push("");
    lines.push(`## Inputs`);
    lines.push("");
    lines.push(`### Market / news events by category`);
    const cats = Object.entries(inputs.marketEventsByCategory);
    if (cats.length === 0) lines.push("(none)");
    else for (const [cat, n] of cats) lines.push(`- ${cat}: ${n}`);

    lines.push("");
    lines.push(`### Signals by module`);
    const mods = Object.entries(inputs.signalsByModule);
    if (mods.length === 0) lines.push("(none)");
    else for (const [mod, n] of mods) lines.push(`- ${mod}: ${n}`);

    lines.push("");
    lines.push(`### Chain notes`);
    if (inputs.chainNotes.length === 0) lines.push("(none)");
    else for (const n of inputs.chainNotes) lines.push(`- ${n}`);

    lines.push("");
    lines.push(`### Source warnings (skipped / failed)`);
    if (inputs.warnings.length === 0) lines.push("(none)");
    else for (const w of inputs.warnings) lines.push(`- ${w}`);
  }

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
  // Secara default --fake juga memakai sumber fixture (offline). Pakai
  // --live-sources untuk fake LLM + sumber data LIVE (menyentuh jaringan).
  const liveSources =
    argv.includes("--live-sources") || process.env.npm_config_live_sources === "true";

  if (!dry) {
    console.error(
      "[engine] CLI run saat ini hanya mendukung --dry (jalur DB belum ada). Contoh: tsx src/agents/run.ts --dry --fake",
    );
    process.exitCode = 1;
    return;
  }

  let provider: LlmProvider | undefined;
  let collector: ResearchInputCollector | undefined;
  if (fake) {
    provider = await makeFakeProvider();
    // --fake default offline (fixture collector); --live-sources untuk sumber live.
    if (!liveSources) {
      const { fixtureCollector } = await import("../../test/fixtures/research-fixtures.ts");
      collector = fixtureCollector;
    }
  } else {
    // Provider nyata dipilih per peran via router (ADR 0008). Log ketersediaan
    // provider (tanpa nilai key) untuk diagnosa.
    const { providerAvailability, resolveRole } = await import("../llm/registry.ts");
    console.error(`[engine] provider availability: ${JSON.stringify(providerAvailability())}`);
    for (const role of ["analyst", "debate", "assessor", "reflector"] as const) {
      const chain = resolveRole(role).map((e) => `${e.provider}:${e.model}`).join(" → ");
      console.error(`[engine] role ${role}: ${chain || "(none available)"}`);
    }
  }

  const result = await runResearch({
    trigger: "SCHEDULED",
    chainId: 42161,
    assets: ["ETH", "USDC"],
    provider,
    collector,
    dry: true,
  });

  if (!result.report) {
    console.error(
      `[engine] run menghasilkan null (skip/gagal). Alasan: ${result.reason ?? "tidak diketahui"}`,
    );
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

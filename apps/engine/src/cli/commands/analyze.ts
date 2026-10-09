/**
 * `tahansoe analyze` — satu run analisa risiko live + kartu laporan (spec §3.2).
 *
 * Flags: --assets ETH,USDC · --dry · --fake · --pick · --json · --no-color
 * --json: HANYA JSON di stdout; semua log/progress ke stderr.
 * --fake: offline (FakeProvider + fixture collector), tanpa jaringan/LLM.
 *
 * KEAMANAN: tanpa aksi on-chain; teks eksternal lewat sanitize di renderer;
 * footer "not a trading signal"; tidak pernah mencetak secret.
 */

import { parseArgs } from "node:util";
import type { LlmProvider } from "../../llm/provider.ts";
import type { ResearchInputCollector } from "../../agents/context.ts";
import { runResearch, type ProgressEvent } from "../../agents/run.ts";
import {
  detectTheme,
  createProgress,
  banner,
  renderReportCard,
  maskHost,
} from "../render.ts";
import { toReportCardData, toJson } from "../report-card-data.ts";
import { EXIT_OK, EXIT_ERROR, EXIT_CONFIG, parseCsv } from "./args.ts";
import { isGatewayConfigured, gatewayError, gatewayConfig } from "../../llm/registry.ts";
import { env } from "../../config.ts";

export const ANALYZE_HELP = `tahansoe analyze — run one risk-research pass and print a report card

Usage: tahansoe analyze [options]
  --assets <list>   Comma-separated assets (default: ETH,USDC)
  --dry             Do not write to DB; write report files to out/
  --fake            Offline run (fixtures, no network/LLM)
  --pick            Run the model picker first (saves settings.json)
  --json            Emit JSON only on stdout (logs to stderr)
  --no-color        Disable ANSI colors
  --help            Show this help`;

export interface AnalyzeDeps {
  /** Jalur run yang dapat di-inject untuk test (default: runResearch asli). */
  run?: typeof runResearch;
  /** Writer stdout/stderr injectable (test); default process.stdout/stderr. */
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
}

/** Ringkas alasan kegagalan untuk baris progress (maks ~70 char, tanpa escape). */
function shortReason(msg?: string): string {
  if (!msg) return "failed";
  const m = /schema invalid:[^|]*/i.exec(msg);
  const base = m ? m[0] : msg;
  return base.replace(/\s+/g, " ").trim().slice(0, 70);
}

export async function analyzeCommand(argv: string[], deps: AnalyzeDeps = {}): Promise<number> {
  const writeOut = deps.stdout ?? ((s: string) => void process.stdout.write(s));
  const writeErr = deps.stderr ?? ((s: string) => void process.stderr.write(s));
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        assets: { type: "string" },
        dry: { type: "boolean" },
        fake: { type: "boolean" },
        pick: { type: "boolean" },
        json: { type: "boolean" },
        "no-color": { type: "boolean" },
        help: { type: "boolean" },
      },
      allowPositionals: false,
    });
  } catch (err) {
    writeErr(`argumen tidak valid: ${err instanceof Error ? err.message : String(err)}\n`);
    return EXIT_ERROR;
  }
  const f = parsed.values;
  if (f.help) {
    writeOut(ANALYZE_HELP + "\n");
    return EXIT_OK;
  }

  // npm "menelan" flag tak bernilai setelah `--` menjadi env npm_config_<name>.
  // Dukung keduanya agar `npm run tahansoe -- analyze --fake` tetap bekerja.
  const npmFlag = (name: string): boolean => process.env[`npm_config_${name}`] !== undefined;
  const json = Boolean(f.json) || npmFlag("json");
  const fake = Boolean(f.fake) || npmFlag("fake");
  const dry = Boolean(f.dry) || npmFlag("dry");
  const assets = f.assets ? parseCsv(f.assets) : ["ETH", "USDC"];
  // Tema untuk stderr (progress/banner). JSON mode selalu non-color output data.
  const theme = detectTheme(argv, process.env, process.stderr);
  const run = deps.run ?? runResearch;

  // Config gate (exit 2): run nyata butuh gateway. --fake tidak.
  if (!fake && !isGatewayConfigured()) {
    writeErr(gatewayError() + "\n");
    return EXIT_CONFIG;
  }

  // Picker opsional (hanya non-JSON, non-fake, TTY).
  if (f.pick && !json && !fake) {
    try {
      const { runPicker } = await import("../research.ts");
      await runPicker([]);
    } catch (err) {
      writeErr(`picker dilewati: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }

  // Banner + sumber gateway (host disamarkan) ke stderr.
  if (!json) {
    const host = fake ? "fake (offline)" : maskHost(gatewayConfig().baseURL);
    writeErr(banner(theme, `risk research · Arbitrum One · gateway ${host}`) + "\n\n");
  }

  // Provider & collector untuk --fake (offline).
  let provider: LlmProvider | undefined;
  let collector: ResearchInputCollector | undefined;
  if (fake) {
    const { FakeProvider } = await import("../../../test/fake-provider.ts");
    const { fakeScript, fixtureCollector } = await import("../../../test/fixtures/research-fixtures.ts");
    provider = new FakeProvider(fakeScript(), undefined, "fake");
    collector = fixtureCollector;
  }

  // Progress live ke stderr (aman untuk --json). Stream adapter → writeErr.
  const progress = createProgress(theme, { isTTY: false, write: writeErr });
  const onProgress = (e: ProgressEvent): void => {
    if (e.type === "stage_start") progress.start(e.stage, e.label ?? e.stage);
    else if (e.type === "stage_done") progress.done(e.stage, e.detail ?? "", e.ms);
    else if (e.type === "analyst_done") {
      if (e.ok) progress.done(`analyst:${e.domain}`, e.usedModel ?? "ok", e.ms);
      else progress.fail(`analyst:${e.domain}`, shortReason(e.reason));
    } else if (e.type === "error") progress.fail(e.stage, shortReason(e.message));
  };

  const result = await run({
    trigger: "SCHEDULED",
    chainId: 42161,
    assets,
    provider,
    collector,
    // --fake memaksa dry (tidak menulis DB) kecuali --dry juga; aman default dry utk fake.
    dry: dry || fake,
    onProgress,
  });
  progress.stop();

  if (!result.report) {
    const reason = result.reason ?? "unknown";
    if (json) writeOut(JSON.stringify({ ok: false, reason, disclaimer: "not a trading signal" }) + "\n");
    else writeErr(`\nrun menghasilkan null: ${reason}\n`);
    return EXIT_ERROR;
  }

  const cardData = toReportCardData(result.report, {
    reportId: result.reportId,
    diagnostics: result.diagnostics,
    now: new Date(),
  });

  if (json) {
    const payload = toJson(result.report, { reportId: result.reportId, diagnostics: result.diagnostics, now: cardData.createdAt });
    writeOut(JSON.stringify(payload) + "\n");
  } else {
    writeOut("\n" + renderReportCard(theme, cardData) + "\n");
  }
  void env; // reserved for future gateway-aware hints
  return EXIT_OK;
}

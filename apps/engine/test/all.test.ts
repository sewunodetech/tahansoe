/**
 * Aggregator test: mengimpor semua file test agar bisa dijalankan dengan satu
 * path eksplisit (`tsx --test test/all.test.ts`), tanpa bergantung pada ekspansi
 * glob shell atau versi Node tertentu (ADR 0007 fase runtime).
 *
 * Tambahkan import baru di sini saat membuat file test baru.
 */

import "./agents/to-signal.test.ts";
import "./agents/run-dry.test.ts";
import "./config.test.ts";
import "./llm/anthropic.test.ts";
import "./llm/budget.test.ts";
import "./llm/openai-compatible.test.ts";
import "./llm/registry.test.ts";
import "./db/history.test.ts";
import "./eval/runner.test.ts";
import "./reflection/settle.test.ts";
import "./reflection/lessons.test.ts";
import "./reflection/scorecard.test.ts";
import "./sources/sources.test.ts";
import "./worker/worker.test.ts";
import "./llm/pricing.test.ts";
import "./llm/registry-generic.test.ts";
import "./cli/env-writer.test.ts";
import "./cli/models.test.ts";
import "./settings/settings.test.ts";
import "./cli/settings-cli.test.ts";
import "./sources/price-sampler.test.ts";
import "./fusion/regime.test.ts";
import "./fusion/guardrail.test.ts";
import "./fusion/decay.test.ts";
import "./fusion/drawdown.test.ts";
import "./fusion/scenarios-replay.test.ts";
import "./fusion/run.test.ts";
import "./cli/tahansoe.test.ts";
import "./cli/settle-scorecard.test.ts";
import "./reflection/outcomes.test.ts";
import "./reflection/settle-job.test.ts";

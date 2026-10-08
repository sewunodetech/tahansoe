/**
 * Aggregator test: mengimpor semua file test agar bisa dijalankan dengan satu
 * path eksplisit (`tsx --test test/all.test.ts`), tanpa bergantung pada ekspansi
 * glob shell atau versi Node tertentu (ADR 0007 fase runtime).
 *
 * Tambahkan import baru di sini saat membuat file test baru.
 */

import "./agents/to-signal.test.ts";
import "./agents/run-dry.test.ts";
import "./llm/anthropic.test.ts";
import "./llm/budget.test.ts";
import "./llm/openai-compatible.test.ts";
import "./llm/registry.test.ts";
import "./db/history.test.ts";
import "./reflection/settle.test.ts";
import "./reflection/lessons.test.ts";
import "./reflection/scorecard.test.ts";
import "./sources/sources.test.ts";

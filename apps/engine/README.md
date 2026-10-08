# Core Risk Engine — research layer (boilerplate)

Lapis riset multi-agent + reflection loop untuk Tahansoe. Berjalan **di samping**
modul sinyal, bukan menggantikannya. Output satu-satunya adalah `Signal`
(`module: "RESEARCH"`) yang masuk ke fusion deterministik.

Sumber kebenaran: [`docs/specs/m3-research-agents.md`](../docs/specs/m3-research-agents.md),
[ADR 0004](../docs/decisions/0004-multi-agent-research-layer.md),
[ADR 0005](../docs/decisions/0005-reflection-loop.md),
[architecture](../docs/architecture.md), [security](../docs/security.md).

> **Status: boilerplate.** Fungsi murni/kritis (cap confidence, label settlement,
> seleksi lesson, metrik) sudah terisi + ada test. Fungsi yang menyentuh LLM/DB/chain
> sengaja `throw` dengan TODO terperinci agar jelas apa yang harus dilengkapi.

## Invariant (jangan dilanggar — security.md §2)

1. **Tanpa tools.** Agent tidak fetch/menulis DB/menyentuh chain. Konteks dirakit
   kode (`agents/context.ts`) lalu disisipkan sebagai data.
2. **Schema-only.** Semua output LLM divalidasi zod; gagal → dibuang, tidak diperbaiki.
3. **Cap confidence 0.6.** Ditegakkan di `agents/to-signal.ts` (`config.confidenceCap`).
4. **Sinyal RESEARCH tidak bisa sendirian menaikkan regime ke STRESSED/CRISIS.**
   Dijaga di fusion (di luar modul ini).
5. **Konten eksternal = data, bukan instruksi.** Termasuk berita dan lesson.
6. **Graceful degradation.** Kill switch `RESEARCH_ENABLED` (default false), budget
   harian; kegagalan lapis ini tidak menjatuhkan fusion.
7. **Tidak ada jalur baru ke dana.** Modul ini tanpa signer (security §4 I1–I4).
8. **Engine plan-agnostic.** Engine selalu menghitung semuanya; tidak tahu soal
   plan (ADR 0006). Model bisnis: **informasi gratis, otomasi berbayar** — regime
   + penjelasan + Hawk/Dove GRATIS untuk semua user; yang Pro adalah otomasi
   (dynamic trigger Guardian v2, rekomendasi dry-run, multi-posisi/chain, band
   kustom, riwayat/scorecard lengkap). Gating ada di API/bot, BUKAN di engine.
   Alert kritis deterministik (sequencer down, depeg, CRISIS) untuk SEMUA user.
   Tanpa fee eksekusi on-chain di v1 (invariant I1 utuh).
9. **Model: termurah yang lolos eval.** Semua peran mulai `claude-haiku-5-5`;
   naik tier (sonnet → opus) per peran hanya jika eval gagal (spec §3.4,
   `config.modelTiers`).

## Struktur

```
src/
  config.ts              env + konstanta kebijakan (confidenceCap, jadwal, model)
  index.ts               entry/scheduler (scaffold)
  llm/
    provider.ts          interface LlmProvider (structured-only, tanpa tools)
    anthropic.ts         implementasi Anthropic (stub + TODO SDK)
    budget.ts            biaya harian + hard stop (costOf, Budget)
    prompts/             system prompt per peran (*.md) + loader
  agents/
    schemas.ts           zod: AnalystReport, DebateTurn, ResearchReport, ...
    context.ts           rakit input dari DB (stub)
    analysts.ts          4 analyst paralel
    debate.ts            Hawk ⇄ Dove (stub)
    assessor.ts          → ResearchReport (stub)
    to-signal.ts         ResearchReport → Signal (IMPLEMENTASI PENUH)
    run.ts               runResearch(trigger) — orkestrasi satu run
  reflection/
    config.ts            ambang outcome per jalur
    outcomes.ts          hitung outcome aktual (stub)
    settle.ts            label TP/FP/MISSED/TN + lead time (labelOf IMPLEMENTASI)
    reflect.ts           reflection batch harian (stub)
    lessons.ts           pilih ≤5 lesson (rankLessons IMPLEMENTASI)
    scorecard.ts         metrik mingguan (computeMetrics IMPLEMENTASI)
  db/
    schema.ts            tabel research_reports / risk_settlements / research_lessons
  sources/
    index.ts             sumber data (FRED/Polymarket/AlphaVantage/GDELT + on-chain) + lisensi
  backtest/
    research-replay.ts   replay historis (stub; laporkan terpisah — bias lookahead)
test/
  fake-provider.ts       LlmProvider palsu deterministik
  agents/, reflection/   unit test fungsi murni
  eval/                  news-labeled / injection / scenarios (kerangka)
```

## Perintah

```bash
cd engine
npm install
npm run typecheck      # tsc --noEmit (harus bersih)
npm run test           # node --test (22 test fungsi murni)
```

Node 22+ dibutuhkan (`--experimental-strip-types`). Import memakai ekstensi `.ts`
secara sengaja agar bisa dijalankan langsung oleh Node tanpa build.

## Environment

Lihat `.env.example`. Semua server-only, tanpa prefix `NEXT_PUBLIC_`:
`DATABASE_URL`, `ANTHROPIC_API_KEY`, `LLM_DAILY_BUDGET_USD`, `RESEARCH_ENABLED`.

## Yang sudah terisi vs TODO

| Terisi (+ test) | Stub ber-TODO |
|-----------------|---------------|
| `to-signal.toSignal` (cap confidence, expiresAt, severity) | `anthropic.structured` (SDK) |
| `settle.labelOf` / `leadTimeMinutes` / `isPositiveRegime` | `context.buildContext` / `renderContextAsData` |
| `lessons.rankLessons` / `pathsFromReports` | `debate.runDebate`, `assessor.runAssessor` |
| `scorecard.computeMetrics` | `run.saveReport` / `emitSignal` |
| `budget.costOf` / `Budget` | `outcomes.computeOutcome`, `settle.runSettlement` |
| schema zod + schema DB Drizzle | `reflect.runReflection`, `scorecard.generateScorecard` |
| `run.runResearch` alur + 3 guard | `backtest.replayScenario`, `index.start` scheduler |

## Langkah lanjutan untuk dev (urutan disarankan)

1. Isi `anthropic.ts` (structured output + stop_reason + fallback refusal + usage).
2. Isi `context.ts` (query DB + render data deterministik).
3. Isi `debate.ts` & `assessor.ts`, lalu uji integrasi `runResearch` dgn `FakeProvider`.
4. Gabungkan `db/schema.ts` ke sumber bersama + migrasi; isi `saveReport`/`emitSignal`.
5. Isi `outcomes.ts` + `settle.runSettlement`; verifikasi label vs fixture.
6. Isi `reflect.ts` (Batch API) + `lessons.selectLessons` (query + rankLessons).
7. Isi `scorecard.generateScorecard`; siapkan set eval di `test/eval/`.
8. Shadow mode 2 minggu sebelum notifikasi user (spec §3.7).

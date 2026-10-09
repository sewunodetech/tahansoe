# Core Risk Engine — Research Layer & Worker

Lapis riset multi-agent, reflection loop, dan background worker otomatis untuk Tahansoe. Modul ini berjalan **di samping** modul sinyal deterministik, bukan menggantikannya. Output satu-satunya dari lapis riset ke sistem adalah baris `Signal` (`module: "RESEARCH"`) yang masuk ke risk fusion deterministik.

Sumber kebenaran:
- [`docs/specs/m3-research-agents.md`](../../docs/specs/m3-research-agents.md) — Arsitektur research agents, schema, dan evaluasi.
- [`docs/specs/m2-engine-skeleton.md`](../../docs/specs/m2-engine-skeleton.md) — Kerangka engine, penjadwalan, dan worker background.
- [`docs/decisions/0004-multi-agent-research-layer.md`](../../docs/decisions/0004-multi-agent-research-layer.md) — Desain multi-agent LLM.
- [`docs/decisions/0005-reflection-loop.md`](../../docs/decisions/0005-reflection-loop.md) — Siklus pembelajaran dan scorecard.
- [`docs/decisions/0008-multi-provider-llm.md`](../../docs/decisions/0008-multi-provider-llm.md) — Multi-provider LLM, adapter OpenAI-compatible, dan router per-peran.
- [`docs/security.md`](../../docs/security.md) & [`docs/architecture.md`](../../docs/architecture.md).

---

## 1. Invariant Keamanan (security.md §2)

1. **Non-custodial & Tanpa Signer:** Modul ini tidak memegang private key dana user dan tidak pernah memicu transaksi perpindahan token.
2. **Tanpa Tools (No Tools Execution):** Agent LLM tidak mengeksekusi fetch/DB/chain secara langsung. Seluruh konteks dikumpulkan oleh pengumpul kode deterministik (`src/agents/context.ts` dan `src/sources/`) dan disajikan sebagai data.
3. **Schema-Only Structured Output:** Semua keluaran model divalidasi ketat oleh schema zod. Respons yang gagal parsing atau mengalami refusal langsung dibuang dan dicatat, tidak diperbaiki otomatis.
4. **Cap Confidence 0.6:** Nilai confidence sinyal `RESEARCH` dibatasi maksimal `0.6` pada `src/agents/to-signal.ts`.
5. **AI advises, rules decide:** Sinyal `RESEARCH` sendirian tidak pernah menaikkan regime pasar ke `STRESSED` atau `CRISIS` tanpa konfirmasi pasar/on-chain di lapis fusion.
6. **Konten Eksternal adalah Data:** Berita publik, RSS, dan lessons diperlakukan murni sebagai input data yang dibungkus, bukan instruksi yang dieksekusi model.
7. **Graceful Degradation:** Dilengkapi kill switch `RESEARCH_ENABLED=false` dan pembatas budget harian `LLM_DAILY_BUDGET_USD`. Bila lapis riset mati atau habis kuota, modul sinyal dan proteksi posisi tetap berjalan normal.
8. **Prinsip Model:** Memilih model termurah yang lolos eval offline/online (spec §3.4).

---

## 2. Cara Pakai

### Setup Environment

Salin file template `.env.example` ke `apps/engine/.env`:

```bash
cp .env.example .env
```

Semua script npm engine memuat file `.env` ini secara otomatis via flag Node/tsx (`--env-file-if-exists=.env`).

> **PENTING:** Jangan pernah melakukan commit file `.env` atau mencetak secret / API key ke log console (invariant I8).

### Konfigurasi Provider LLM

Tahansoe mendukung multi-provider LLM (ADR 0008) melalui interface standar provider-agnostic. Anda dapat menggunakan Anthropic langsung, Gemini free-tier, OpenRouter, Groq, Ollama lokal, atau endpoint **OpenAI-compatible generik** mana pun (seperti Bynara, DeepSeek, vLLM, atau proxy kustom).

Variabel environment untuk provider generik:
- `LLM_BASE_URL`: URL API endpoint OpenAI-compatible (otomatis dinormalisasi s.d. `/v1` atau `/v1/chat/completions`).
- `LLM_API_KEY`: API key untuk endpoint di atas.
- `LLM_PROVIDER_NAME`: Nama prefix provider untuk label `provider:model` (default: `custom`).
- `LLM_MODEL`: Model default untuk seluruh peran jika variabel peran tidak diisi.
- `LLM_PRICING_URL`: URL endpoint daftar harga remote. Format yang didukung otomatis:
  - Bynara: `https://router.bynara.id/api/pricing` (credit per 1k = IDR + `usd_to_idr`).
  - OpenRouter: `https://openrouter.ai/api/v1/models` (USD per token).
- `LLM_MODEL_PRICES`: Override harga manual dalam format JSON (USD per 1 juta token), contoh: `{"deepseek-v4.1-flash":{"inputPerM":0.3,"outputPerM":1.2}}`.
- `LLM_PROVIDER_<NAMA>_BASE_URL` & `LLM_PROVIDER_<NAMA>_API_KEY`: Konfigurasi provider generik tambahan (misalnya `LLM_PROVIDER_DEEPSEEK_BASE_URL`).

Pemilihan model per peran mendukung **fallback berantai** dengan format `"provider:model,provider:model"` (atau nama model tanpa prefix untuk menggunakan provider default):
- `LLM_ANALYST`: Model untuk 4 analis paralel (Geopolitics, Macro, Market, Onchain).
- `LLM_DEBATE`: Model untuk debat dialektika Hawk vs Dove.
- `LLM_ASSESSOR`: Model sintesis risiko untuk Risk Assessor.
- `LLM_REFLECTOR`: Model batch reflection untuk ekstraksi lessons.

#### Contoh Konfigurasi Nyata (Bynara)

```env
# Koneksi Database Neon Postgres
DATABASE_URL=postgresql://user:password@host/dbname

# Provider OpenAI-Compatible Generik (Bynara Router)
LLM_BASE_URL=https://router.bynara.id/v1/chat/completions
LLM_API_KEY=by_live_contoh_key_anda
LLM_PROVIDER_NAME=bynara
LLM_MODEL=deepseek-v4.1-flash
LLM_PRICING_URL=https://router.bynara.id/api/pricing

# Pemilihan model per peran (opsional override)
LLM_ANALYST=bynara:deepseek-v4.1-flash
LLM_DEBATE=bynara:deepseek-v4.1-flash
LLM_ASSESSOR=bynara:deepseek-v4.1-flash

# Batas biaya & kill switch
LLM_DAILY_BUDGET_USD=5
RESEARCH_ENABLED=true

# Sumber data makro (key gratis)
FRED_API_KEY=abcdef1234567890
```

---

## 3. Daftar Perintah CLI (npm scripts)

Jalankan perintah berikut dari dalam direktori `apps/engine` (atau dengan flag `-w @tahansoe/engine` dari root monorepo):

| Perintah | Penjelasan |
|----------|------------|
| `npm run research` | CLI interaktif untuk memilih model per peran, melihat estimasi biaya run/harian/bulanan, menyimpan pilihan ke `.env`, dan mengeksekusi dry-run/live. |
| `npm run models` | Menampilkan daftar model yang tersedia dari endpoint provider beserta harga dan estimasi biaya riset (opsi: `--filter <teks>`). |
| `npm run research:dry` | Menjalankan satu research run dalam mode dry-run tanpa menyentuh database (laporan disimpan di `apps/engine/out/<ISO>/`). |
| `npm run research:once` | Menjalankan satu research run penuh dan menyimpan hasilnya langsung ke database Neon Postgres (`research_reports` & `signals`). |
| `npm run research:worker` | Menjalankan background Scheduled Research Worker dengan Postgres advisory lock session-level, adaptasi interval regime, anti-overlap guard, kill switch, dan budget check. |
| `npm run research:history` | Menampilkan tabel ringkasan riwayat riset yang tersimpan di database Neon Postgres. |
| `npm run eval` | Menjalankan eval set research agent (16 prompt injection + 8 regime scenarios) dengan opsi `--set injection\|scenarios\|all`, `--limit N`, dan `--dry-plan`. |
| `npm run research:run` | Menjalankan pipeline riset dari entry point scheduler utama (`src/index.ts`). |
| `npm run reflect:settle` | Menjalankan proses settlement evaluasi outcome aktual terhadap prediksi horizon sebelumnya (`TRUE_POSITIVE`, `FALSE_POSITIVE`, `MISSED`, `TRUE_NEGATIVE`). |
| `npm run reflect:daily` | Menjalankan refleksi harian batch untuk merumuskan pelajaran baru (`research_lessons`). |
| `npm run scorecard` | Menghitung metrik mingguan scorecard engine (recall event, presisi, lead time median, kepatuhan schema). |
| `npm run test` | Menjalankan seluruh test suite unit engine offline via Node test runner (`test/all.test.ts`). |
| `npm run typecheck` | Memvalidasi seluruh tipe TypeScript pada engine (`tsc --noEmit -p tsconfig.json`). |

---

## 4. Struktur Folder

```text
apps/engine/
├── src/
│   ├── agents/          # Pipeline riset: 4 analis, debat Hawk/Dove, assessor, schemas, to-signal, run
│   ├── cli/             # CLI interaktif: research model picker, models list, env-writer
│   ├── db/              # Penyimpanan laporan riset ke Neon Postgres dan query history
│   ├── eval/            # Eval runner quota-aware (daily quota handling & 429 retry), scoring types
│   ├── llm/             # Interface LlmProvider, Anthropic, OpenAI-compatible, registry router, pricing, estimate, budget
│   ├── reflection/      # Settlement label, ekstraksi lessons, dan penghitungan scorecard
│   ├── sources/         # Adapter pengumpul data: RSS terkurasi, FRED API, kalender makro, DefiLlama, on-chain Arbitrum
│   ├── worker/          # Scheduled Research Worker (Postgres advisory lock, adaptive schedule, lifecycle guards)
│   ├── config.ts        # Variabel konfigurasi lingkungan dan batas kebijakan engine
│   └── index.ts         # Entry point runner utama
├── test/
│   ├── agents/          # Unit test analis, debat, schemas, signal mapping, run dry
│   ├── cli/             # Unit test CLI helpers
│   ├── db/              # Unit test query riwayat database
│   ├── eval/            # Kasus eval (16 injection + 8 scenarios), test scorer, runner offline
│   ├── llm/             # Unit test provider, budget calculation, pricing parser, registry router
│   ├── reflection/      # Unit test settlement, lessons ranking, scorecard calculation
│   ├── sources/         # Unit test adapter berita RSS, FRED, kalender makro, DefiLlama, on-chain
│   ├── worker/          # Unit test penjadwalan adaptif, Postgres lock, anti-overlap, error resilience
│   ├── fake-provider.ts # LlmProvider palsu deterministik untuk pengujian offline tanpa jaringan
│   └── all.test.ts      # Aggregator test runner suite
├── out/                 # Output artefak run dry dan hasil eval (di-gitignore)
├── .env.example         # Template konfigurasi environment server-only
└── package.json         # Definisi dependencies dan scripts npm
```

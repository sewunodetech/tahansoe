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

### Konfigurasi LLM (satu gateway — ADR 0009)

Engine memanggil LLM lewat **satu endpoint OpenAI-compatible**. Di `.env` cukup DUA secret:

- `LLM_API_URL`: URL gateway OpenAI-compatible (otomatis dinormalisasi s.d. `/v1` atau `/v1/chat/completions`). Alias usang `LLM_BASE_URL` masih dibaca (dengan peringatan) untuk satu rilis.
- `LLM_API_KEY`: API key gateway (jangan commit; tidak pernah di-log — I8).

Berganti provider = cukup mengganti dua nilai ini (mis. ke OpenRouter atau proxy kustom).

Konfigurasi NON-RAHASIA (model per peran, pricing URL, harga manual, estimasi biaya) ada di **`settings.json`** (per mesin, di-gitignore) — bukan di `.env`. Lihat `apps/engine/settings.example.json`. Kelola lewat CLI:

- `tsx src/cli/settings.ts init` — buat `settings.json` dari contoh.
- `tsx src/cli/settings.ts show` — tampilkan settings efektif + status gateway (tanpa secret).
- `tsx src/cli/settings.ts set-role <role> <model[,model]>` — set fallback NAMA MODEL per peran (`analyst`/`debate`/`assessor`/`reflector`).
- `tsx src/cli/settings.ts set estimate.runsPerDay 24` — set nilai generik.

`roles` berisi **nama model saja** (tanpa awalan provider), berurutan sebagai fallback antar-model di gateway yang sama (retry hanya 429/5xx/timeout). `npm run research` membantu memilih model per peran dengan estimasi biaya lalu menyimpannya ke `settings.json`.

#### Contoh Konfigurasi Nyata (Bynara)

`.env` (hanya secret):

```env
DATABASE_URL=postgresql://user:password@host/dbname
LLM_API_URL=https://router.bynara.id/v1
LLM_API_KEY=by_live_contoh_key_anda
LLM_DAILY_BUDGET_USD=5
RESEARCH_ENABLED=true
FRED_API_KEY=abcdef1234567890
```

`settings.json` (non-rahasia, dari `settings.example.json`):

```json
{
  "version": 2,
  "roles": {
    "analyst": ["agnes-2.5-flash"],
    "debate": ["agnes-2.5-flash"],
    "assessor": ["deepseek-v4.1-flash"],
    "reflector": ["agnes-2.5-flash"]
  },
  "pricingUrl": "https://router.bynara.id/api/pricing",
  "modelPrices": {},
  "estimate": { "runsPerDay": 12 }
}
```

---

## 3. Daftar Perintah CLI (npm scripts)

Jalankan perintah berikut dari dalam direktori `apps/engine` (atau dengan flag `-w @tahansoe/engine` dari root monorepo):

### 3.1 CLI terpadu `tahansoe` (spec m3-cli)

Satu pintu untuk semua operasi: `npm run tahansoe -- <command>` (atau binary `tahansoe` setelah `npm link`).

```bash
npm run tahansoe --                         # banner + status singkat + daftar command
npm run tahansoe -- analyze --fake          # satu run offline (fixtures) + kartu laporan
npm run tahansoe -- analyze --assets ETH,USDC --json   # JSON saja di stdout (log ke stderr)
npm run tahansoe -- analyze --pick          # pilih model dulu (simpan ke settings.json), lalu run
npm run tahansoe -- history --limit 20      # tabel riwayat + sparkline regime
npm run tahansoe -- report latest           # laporan lengkap (atau: report <id> [--md|--json])
npm run tahansoe -- models --filter flash   # daftar model gateway + harga + estimasi
npm run tahansoe -- settings show           # settings non-rahasia (show|init|set-role|set)
npm run tahansoe -- doctor                  # cek env/DB/RPC/gateway (key disamarkan)
npm run tahansoe -- schedule run            # scheduler foreground (Ctrl+C lepas lock)
npm run tahansoe -- schedule run --with-price   # + price worker di proses yang sama
npm run tahansoe -- schedule run --once     # satu siklus lalu keluar
npm run tahansoe -- schedule status         # lock + run terakhir dari DB
```

Opsi global: `--json` (output mesin, hanya di stdout), `--no-color` (nonaktifkan ANSI; otomatis mati pada pipe/`NO_COLOR`/`TERM=dumb`). Exit code: `0` ok · `1` error · `2` konfigurasi salah (mis. `LLM_API_URL`/`LLM_API_KEY` belum diisi). Setiap kartu laporan diakhiri "not a trading signal"; CLI tidak pernah melakukan aksi on-chain dan tidak pernah mencetak secret.

### 3.2 Menjaga scheduler tetap hidup (foreground)

`tahansoe schedule run` berjalan di foreground (spec §7). Untuk produksi, jaga agar tetap hidup lewat process manager:

**pm2 (Linux/macOS/WSL):**

```bash
pm2 start npm --name tahansoe-scheduler -- run tahansoe -- schedule run --with-price
pm2 save && pm2 startup      # auto-start saat boot
pm2 logs tahansoe-scheduler  # lihat log
```

**Windows Task Scheduler:** buat Basic Task → Trigger "At startup" → Action "Start a program":
- Program: `node`
- Arguments: `node_modules/tsx/dist/cli.mjs --env-file-if-exists=.env src/cli/tahansoe.ts schedule run --with-price`
- Start in: path absolut ke `apps/engine`
Centang "Run whether user is logged on or not" dan "Restart on failure" (mis. tiap 1 menit, 3x).

**systemd (Linux):** unit service `ExecStart=/usr/bin/npm run tahansoe -- schedule run --with-price`, `WorkingDirectory=…/apps/engine`, `Restart=always`.

Advisory lock Postgres memastikan hanya satu instance scheduler aktif; instance kedua keluar bersih. Ctrl+C / SIGTERM melepas lock sebelum keluar.

### 3.3 Script npm (alias ke `tahansoe`)

| Perintah | Penjelasan |
|----------|------------|
| `npm run research` | Alias `tahansoe analyze` (interaktif via `research:pick`). Menyimpan pilihan model ke `settings.json`. |
| `npm run research:pick` | Picker model interaktif (TTY) → simpan ke `settings.json`, opsi dry-run/live. |
| `npm run models` | Alias `tahansoe models` — daftar model gateway + harga + estimasi (opsi `--filter`). |
| `npm run doctor` | Alias `tahansoe doctor` — cek env/DB/RPC/gateway. |
| `npm run research:dry` | Alias `tahansoe analyze --dry` (tanpa DB; laporan di `apps/engine/out/<ISO>/`). |
| `npm run research:once` | Satu research run penuh, simpan ke DB (`research_reports` & `signals`). |
| `npm run research:worker` | Alias `tahansoe schedule run` (Scheduled Research Worker, advisory lock, adaptif, kill switch, budget). |
| `npm run worker:price` | Price worker mandiri (sampling harga AaveOracle). |
| `npm run research:history` | Alias `tahansoe history`. |
| `npm run eval` | Eval set research agent (`--set injection\|scenarios\|all`, `--limit N`, `--dry-plan`). |
| `npm run research:run` | Pipeline riset dari entry scheduler utama (`src/index.ts`). |
| `npm run reflect:settle` | Settlement outcome aktual vs prediksi horizon (`TRUE_POSITIVE`/`FALSE_POSITIVE`/`MISSED`/`TRUE_NEGATIVE`). |
| `npm run reflect:daily` | Refleksi harian batch → pelajaran baru (`research_lessons`). |
| `npm run scorecard` | Metrik mingguan scorecard engine. |
| `npm run test` | Seluruh test suite unit engine offline (`test/all.test.ts`). |
| `npm run typecheck` | Validasi tipe TypeScript engine (`tsc --noEmit`). |

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

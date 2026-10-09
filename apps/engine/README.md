# Core Risk Engine — Research Layer & Worker

Lapis riset multi-agent, reflection loop, dan background worker otomatis untuk Tahansoe. Modul ini berjalan **di samping** modul sinyal deterministik, bukan menggantikannya. Output satu-satunya dari lapis riset ke sistem adalah baris `Signal` (`module: "RESEARCH"`) yang masuk ke risk fusion deterministik.

Sumber kebenaran:
- [`docs/specs/m3-research-agents.md`](../../docs/specs/m3-research-agents.md) — Arsitektur research agents, schema, dan evaluasi.
- [`docs/specs/m2-engine-skeleton.md`](../../docs/specs/m2-engine-skeleton.md) — Kerangka engine, penjadwalan, dan worker background.
- [`docs/decisions/0004-multi-agent-research-layer.md`](../../docs/decisions/0004-multi-agent-research-layer.md) — Desain multi-agent LLM.
- [`docs/decisions/0005-reflection-loop.md`](../../docs/decisions/0005-reflection-loop.md) — Siklus pembelajaran dan scorecard.
- [`docs/decisions/0008-multi-provider-llm.md`](../../docs/decisions/0008-multi-provider-llm.md) — Multi-provider LLM (sebagian di-supersede [ADR 0009](../../docs/decisions/0009-single-openai-compatible-gateway.md): satu gateway).
- [`docs/specs/m3-carry-interest-monitoring.md`](../../docs/specs/m3-carry-interest-monitoring.md) — Pemantauan carry & bunga (jalur T11).
- [`docs/security.md`](../../docs/security.md) & [`docs/architecture.md`](../../docs/architecture.md).

---

## 0. Untuk apa engine ini? Masalah user dan solusinya

**Prinsip:** Tahansoe membantu peminjam DeFi **bertahan lama di market**, bukan cepat kaya. Engine ini tidak memprediksi harga, tidak memberi sinyal trading, dan tidak menyarankan aset dengan yield tertinggi. Tugasnya memperkecil peluang posisi user dilikuidasi.

### Masalah yang dihadapi user

User yang meminjam di Aave (mis. collateral ETH, pinjam USDC) dilikuidasi saat *Health Factor* (HF) turun ke 1,0. Penyebabnya lebih banyak dari sekadar "harga turun":

| # | Masalah | Contoh nyata | Kenapa user sering kecolongan |
|---|---------|--------------|-------------------------------|
| 1 | **Harga collateral jatuh mendadak** karena perang, geopolitik, keputusan Fed, data inflasi | ETH turun 15% dalam beberapa jam setelah berita besar | Proteksi biasa baru bereaksi **setelah** harga jatuh, saat itu sudah terlambat atau mahal |
| 2 | **Stablecoin lepas dari $1** (depeg) | USDC sempat ke $0,88 saat SVB tutup (Mar 2023) | HF bergerak walau ETH diam; jarang ada yang memantau |
| 3 | **Insiden protokol / jaringan** | Exploit, sequencer Arbitrum berhenti | Saat terjadi, user tidak bisa repay sama sekali |
| 4 | **Bunga pinjaman menggerogoti posisi** (carry negatif, lonjakan bunga) | 9 Okt 2026: pool USDC.e di Aave Arbitrum terpakai 92%, bunga pinjam **20%/tahun** | HF turun pelan **tanpa harga bergerak**; tidak terasa sampai dekat likuidasi |
| 5 | **Terlalu banyak informasi** | Berita, kalender makro, data on-chain tersebar di banyak tempat | User tidak sempat memantau 24 jam |

### Solusi engine ini

| Masalah | Solusi | Manfaat untuk user |
|---------|--------|--------------------|
| 1 | **Research agent** (4 analyst AI → debat hawk/dove → assessor) membaca berita kredibel (RSS 7 outlet), kalender makro resmi (FOMC/CPI/NFP), data FRED, DefiLlama, dan oracle on-chain, lalu mengusulkan *regime* risiko (CALM → ELEVATED → STRESSED → CRISIS) | Buffer proteksi bisa dinaikkan **sebelum** guncangan, bukan sesudahnya |
| 2–3 | **Sinyal on-chain deterministik** (AaveOracle, Chainlink, sequencer uptime feed, depeg) + **Risk Fusion** berbasis aturan | Ancaman nyata dikonfirmasi data on-chain, bukan opini AI |
| 4 | **Pemantauan carry & bunga (jalur T11)**: bunga supply/pinjam, utilization, dan titik lonjakan bunga (kink) tiap reserve Aave, plus proyeksi "HF turun dari 1,50 ke 1,45 dalam N hari" | User tahu kalau posisinya digerogoti bunga, sebelum terlambat |
| 5 | **Satu CLI `tahansoe`** dan scheduler otomatis (analisa tiap 1–2 jam, fusion tiap 15 menit, penilaian tiap jam) | Pemantauan jalan terus tanpa user harus berjaga |
| — | **Reflection loop**: setiap prediksi dinilai otomatis dengan harga AaveOracle (benar / salah / terlewat) dan dirangkum di scorecard | Kualitas peringatan terukur dan bisa diperbaiki, bukan klaim kosong |

### Batasan yang disengaja (demi keamanan user)

- **AI hanya memberi saran.** Keputusan diambil aturan deterministik; eksekusi on-chain dilakukan kontrak `TahansoeGuardian` di dalam band HF yang disetujui user.
- **Riset sendirian tidak bisa memicu kepanikan.** Sinyal AI dibatasi confidence 0,6 dan tidak bisa menaikkan regime ke STRESSED/CRISIS tanpa konfirmasi pasar/on-chain.
- **Tahan manipulasi berita.** Teks eksternal diperlakukan sebagai data; instruksi tersisip yang dikutip model dihapus otomatis sebelum output dipakai.
- **Non-custodial.** Engine tidak memegang dana atau private key user.
- **Jika engine mati, proteksi tetap jalan** memakai policy statis user.

### Contoh output

Run nyata `tahansoe analyze --dry` dengan `gpt-6-luna`, 9 Okt 2026 13:06 UTC:

```
 ▲ TAHANSOE  risk research · Arbitrum One · gateway router.bynara.id
  ✔ sources               3.2s
  ✔ analyst:onchain      gpt-6-luna  7.7s
  ✔ analyst:geopolitics  gpt-6-luna  7.7s
  ✔ analyst:macro        gpt-6-luna  9.0s
  ✔ analyst:market       gpt-6-luna  9.8s
  ✔ debate                12.4s
  ✔ assessor             gpt-6-luna  21.0s
╭─ RISK REPORT · 2026-10-09 13:06 UTC ───────────────────────────────╮
│ Proposed regime (research)  ● ELEVATED       Direction  ▼ DOWN     │
│ Confidence █████░░░░░ 0.48 (cap 0.60)   Horizon 72h                │
│ Top paths                                                          │
│   T1  Collateral price drop    █████░░░░ sev 0.58                  │
│   T3  Leverage cascade         █████░░░░ sev 0.55                  │
│   T2  Volatility spike         █████░░░░ sev 0.52                  │
│   T9  Protocol incident        █░░░░░░░░ sev 0.15                  │
│ Key evidence                                                       │
│   • Bitcoin was reported about 4% lower on the we… — NEWS          │
│   • Major stablecoins are reported within the nor… — ONCHAIN       │
│   • Arbitrum sequencer status is verified UP. A r… — ONCHAIN       │
│ Consider a higher buffer within your approved band                 │
╰────────────────────────────────────────────────────────────────────╯
 45.2k tok · Rp 13 · 46.4s · not a trading signal
```

Model default: **`gpt-6-luna`** (OpenAI) untuk semua peran, cadangan `deepseek-v4-flash`. Dipilih lewat eval 9 Okt 2026 (prompt 2026.10.2): **24/24 lulus**, 0 bocoran injeksi, skenario 8/8, output 100% valid.

| Model | Pembuat | Eval | Biaya per analisa |
|---|---|---|---|
| `gpt-6-luna` | OpenAI | **24/24**, injeksi 16/16, skenario 100% | ~Rp 5–15 |
| `agnes-2.5-flash` | Bynara (asal-usul tidak jelas) | 21/24 (bocoran injeksi, output terlalu panjang) | ~Rp 3 |
| `deepseek-v4-flash` | DeepSeek | 15/24 sebagai assessor (prompt lama) | ~Rp 6 |

Biaya operasional sekitar **Rp 5–15 per analisa** (tergantung banyaknya berita hari itu), atau sekitar **Rp 2–5 ribu per bulan** pada 12 analisa per hari. Satu analisa penuh selesai dalam ±1 menit. Model bisa diganti kapan saja lewat `tahansoe settings set-role` atau `tahansoe analyze --pick`.

---

## 1. Invariant Keamanan (security.md §2)

1. **Non-custodial & Tanpa Signer:** Modul ini tidak memegang private key dana user dan tidak pernah memicu transaksi perpindahan token.
2. **Tanpa Tools (No Tools Execution):** Agent LLM tidak mengeksekusi fetch/DB/chain secara langsung. Seluruh konteks dikumpulkan oleh pengumpul kode deterministik (`src/agents/context.ts` dan `src/sources/`) dan disajikan sebagai data.
3. **Schema-Only Structured Output:** Semua keluaran model divalidasi ketat oleh schema zod (schema juga disisipkan di system prompt). Gagal validasi → satu kali *repair retry*, lalu fallback ke model berikutnya; tetap gagal → dibuang dan dicatat. Batas panjang tidak pernah dilonggarkan atau dipotong diam-diam.
4. **Cap Confidence 0.6:** Nilai confidence sinyal `RESEARCH` dibatasi maksimal `0.6` pada `src/agents/to-signal.ts`.
5. **AI advises, rules decide:** Sinyal `RESEARCH` sendirian tidak pernah menaikkan regime pasar ke `STRESSED` atau `CRISIS` tanpa konfirmasi pasar/on-chain di lapis fusion.
6. **Konten Eksternal adalah Data:** Berita publik, RSS, dan lessons diperlakukan murni sebagai input data yang dibungkus, bukan instruksi yang dieksekusi model. Frasa perintah yang dikutip model dari data dihapus otomatis (`src/llm/redact.ts`) sebelum output dipakai.
7. **Graceful Degradation:** Dilengkapi kill switch `RESEARCH_ENABLED=false` dan pembatas budget harian `LLM_DAILY_BUDGET_USD`. Bila lapis riset mati atau habis kuota, modul sinyal dan proteksi posisi tetap berjalan normal.
8. **Prinsip Model:** Memilih model termurah yang lolos eval offline/online (spec §3.4).

---

## 2. Cara Pakai

Tahansoe beroperasi sebagai **agent mandiri (autonomous risk agent)**: dijalankan sekali oleh operator di server/komputer lokal, lalu dipakai oleh user **lewat Telegram**. Terminal CLI/REPL disediakan untuk operator & debugging.

### Alur Utama (Agent Model)

1. **Setup** — Konfigurasi gateway LLM, model, database, dan bot Telegram:
   ```bash
   npm run tahansoe -- setup
   ```
   *(Atau non-interaktif: `npm run tahansoe -- setup --yes --db pglite --model gpt-6-luna --telegram-token-env BOT_TOKEN`)*

2. **Pairing Telegram** — Hubungkan chat Telegram untuk menerima alert risiko:
   ```bash
   npm run tahansoe -- gateway pair
   ```
   Kirim `/start <KODE>` ke bot Telegram dalam 10 menit. Periksa status bot dan chat terdaftar dengan:
   ```bash
   npm run tahansoe -- gateway status
   ```

3. **Start (Jalankan Agent)** — Satu proses jangka panjang yang mengorkestrasi seluruh loop proteksi:
   ```bash
   npm run tahansoe -- start
   ```
   Menjalankan: scheduler riset multi-agent, sampler harga (60s) & bunga Aave V3 (15m), Risk Fusion v1, settlement berkala, alert proaktif, serta gateway Telegram dalam satu proses terisolasi (I6).

4. **Pakai lewat Telegram** — User menerima peringatan dini (regime naik, depeg, lonjakan bunga) dan mengirim perintah chat (`/status`, `/fuse`, `/carry`, atau pertanyaan bebas).

5. **CLI / REPL untuk Operator** — Operator dapat memantau atau mengaudit secara manual lewat terminal:
   ```bash
   npm run tahansoe --            # buka sesi interaktif REPL
   npm run tahansoe -- analyze    # satu run riset manual + kartu laporan
   npm run tahansoe -- doctor     # verifikasi kesehatan env & koneksi
   ```

### Setup Manual Environment

Salin file template `.env.example` ke `apps/engine/.env`:

```bash
cp .env.example .env
```

Semua script npm engine memuat file `.env` ini secara otomatis via flag Node/tsx (`--env-file-if-exists=.env`).

> **PENTING:** Jangan pernah melakukan commit file `.env` atau mencetak secret / API key ke log console (invariant I8).

### Pilihan Database (Neon vs PGlite — ADR 0010)

Engine mendukung dua opsi driver database Postgres:
1. **PGlite (embedded Postgres)**: Default untuk pemakaian CLI pribadi/offline tanpa akun database cloud. Data disimpan lokal di `PGLITE_DATA_DIR` (default `apps/engine/.data/pglite`). Migrasi skema berjalan otomatis pada pemakaian pertama. Single-instance worker dijaga via file lock lokal di direktori data.
   ```env
   DB_DRIVER=pglite
   ```
2. **Neon (Postgres serverless)**: Default jika `DATABASE_URL` diset. Dipakai untuk server, web dashboard multi-user, dan lingkungan produksi.
   ```env
   DATABASE_URL=postgresql://user:password@host/dbname
   ```

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
    "analyst": ["gpt-6-luna", "deepseek-v4-flash"],
    "debate": ["gpt-6-luna", "deepseek-v4-flash"],
    "assessor": ["gpt-6-luna", "deepseek-v4-flash"],
    "reflector": ["gpt-6-luna", "deepseek-v4-flash"]
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
npm run tahansoe -- settle                  # settle research_reports jatuh tempo (tabel: label, lead time)
npm run tahansoe -- settle --now 2026-10-09T00:00:00Z --json   # settle sampai waktu tertentu, JSON
npm run tahansoe -- scorecard --days 30     # scorecard akurasi (recall, presisi ≥STRESSED, lead time)
npm run tahansoe -- fuse                     # satu pass Risk Fusion v1 → risk_assessments per aset
npm run tahansoe -- fuse --dry --json        # hitung & cetak JSON, TANPA menulis DB
npm run tahansoe -- carry                    # monitor bunga & carry Aave V3 (tabel reserve + pair + drift HF)
npm run tahansoe -- carry --json             # ringkasan carry & rate format JSON
npm run tahansoe -- doctor                  # cek env/DB/RPC/gateway (key disamarkan)
npm run tahansoe -- schedule run            # scheduler foreground: research + settlement + fusion (Ctrl+C lepas lock)
npm run tahansoe -- schedule run --with-price   # + price worker & rate sampler T11 di proses yang sama
npm run tahansoe -- schedule run --no-settle    # scheduler tanpa settlement job
npm run tahansoe -- schedule run --no-fusion    # scheduler tanpa risk-fusion job
npm run tahansoe -- schedule run --once     # satu siklus lalu keluar
npm run tahansoe -- schedule status         # lock + run terakhir dari DB
```

`settle` dan `scorecard` membaca/menulis tabel `risk_settlements` lewat job settlement (ADR 0005) — butuh `DATABASE_URL`. `settle` memberi label `TRUE_POSITIVE`/`FALSE_POSITIVE`/`MISSED`/`TRUE_NEGATIVE` (idempoten; report tanpa data harga cukup ditandai *insufficient*, bukan dilabeli palsu). `scorecard` meringkas metrik vs target spec §3.6.

`carry` menampilkan pemantauan risiko bunga & carry Aave V3 (jalur T11, spec m3-carry-interest-monitoring): tabel reserve (supply APY, borrow APY, utilization / kink, status: ok / near kink / past kink), drift HF 1.50 → 1.45 untuk 5 pasangan representatif, dan skenario lonjakan utilization 95%. Tanpa rekomendasi trading atau kata saran investasi.

`fuse` menjalankan **Risk Fusion v1** (deterministik, spec m2-risk-fusion-v1): membaca `signals` aktif + prior assessment + `price_samples` (AaveOracle, I5), memancarkan sinyal deterministik T11 dari `rate_samples`, lalu menulis satu baris `risk_assessments` per aset (regime, drawdown h4/h24, recommended trigger/target HF — **belum di-clamp band user**; itu rule engine). `--dry` menghitung & mencetak tanpa menulis DB. Riset `RESEARCH`/`NEWS` sendirian **tidak bisa** mengangkat regime ke `STRESSED`/`CRISIS` (guardrail konfirmasi). Begitu pula sinyal T11 sendirian maksimal ELEVATED tanpa konfirmasi T7 / modul lain. Kegagalan DB/harga → di-log & dilewati (policy statis tetap jalan, I6).

**`schedule run` juga menjalankan settlement DAN fusion** secara periodik di proses yang sama, masing-masing di bawah advisory lock Postgres TERPISAH (research `42161001`, settlement `42161002`, fusion `42161003`). Saat `--with-price` disertakan, worker juga menjalankan sampler harga (tiap 60s) dan sampler bunga T11 (tiap `RATE_SAMPLE_INTERVAL_MIN`, default 15 menit) ke tabel `rate_samples`. Settlement tiap `SETTLE_INTERVAL_MIN` (default 60); fusion tiap `FUSION_INTERVAL_MIN` (default 15) **dan** segera setelah setiap research run sukses. Kegagalan job di-log, tidak pernah menjatuhkan scheduler; dashboard menampilkan "Last settle: …" dan "Fusion: REGIME per aset, HH:MM UTC". Nonaktifkan dengan `--no-settle` / `--no-fusion`. Instance lain yang memegang lock → job tersebut dilewati di proses ini.

Opsi global: `--lang <id|en>` (pilih bahasa UI), `--json` (output mesin, hanya di stdout), `--no-color` (nonaktifkan ANSI; otomatis mati pada pipe/`NO_COLOR`/`TERM=dumb`). Exit code: `0` ok · `1` error · `2` konfigurasi salah (mis. `LLM_API_URL`/`LLM_API_KEY` belum diisi). Setiap kartu laporan diakhiri "not a trading signal"; CLI tidak pernah melakukan aksi on-chain dan tidak pernah mencetak secret.

### 3.2 Mode Interaktif (REPL) & Visual Identity (spec §3.6)

Menjalankan `npm run tahansoe` (tanpa argumen) di terminal interaktif (TTY) membuka sesi REPL dengan visual identity Tahansoe:

```bash
npm run tahansoe
npm run tahansoe -- --lang en   # Buka REPL langsung dalam Bahasa Inggris
```

Fitur sesi interaktif:
- **Visual Identity & Tema Dark-Tech:** Palet warna brand `#4ab5e0` (cyan), safe `#34d399` (emerald), warning `#fbbf24` (amber), danger `#f87171` (red), dan border `#26332f`. Mendukung 24-bit Truecolor (`COLORTERM=truecolor`, Windows Terminal, VS Code) dengan fallback otomatis 256-color dan plain text.
- **Banner ASCII & Panel Status:** Banner TAHANSOE block art dengan gradien horizontal brand → safe (lebar ≥ 80 kolom) atau varian ringkas satu baris (< 80 kolom). Dilengkapi panel status bulat berisikan mode, jaringan, protokol, akun aktif, buffer, dan status HF.
- **Dukungan Multibahasa (i18n: ID / EN):** Resolusi bahasa deterministik: `--lang` flag → `settings.json ui.language` → `TAHANSOE_LANG` → locale sistem → `en`. Perintah `/lang <id|en>` mengganti bahasa antarmuka secara instan dan menyimpannya ke `settings.json`.
- **Slash Commands (Terkelompok 5 Bagian):**
  1. *Analisis:* `/analyze [--dry]`, `/fuse`, `/history`, `/report`, `/settle`, `/scorecard`
  2. *Risiko & Bunga:* `/carry`, `/health`, `/simulate`
  3. *Gateway:* `/gateway`, `/pair`, `/status`
  4. *Konfigurasi:* `/settings`, `/lang`, `/mode`, `/setup`
  5. *Sistem:* `/doctor`, `/models`, `/clear`, `/exit`, `/help`, `/start`
  Lengkap dengan autocomplete Tab dan riwayat input in-memory (↑/↓).
- **Penanganan Proses Latar:** `schedule run` dan `start` tidak dijalankan di dalam REPL (proses jangka panjang; jalankan terpisah di terminal lain). REPL menampilkan petunjuk bila user mengetik `/schedule` atau `/start`.
- **Grounded Q&A (Non-slash input):** dijawab model gateway (peran `chat` di `settings.json`, default sama dengan analyst) secara terstruktur dan grounded hanya dari data tersimpan (laporan riset 24h, assessment per aset, sinyal aktif terdeduplikasi, monitor carry Aave, harga & volatilitas, serta kalender makro).
- **Aturan Non-Goals:** dilarang memberi prediksi harga, rekomendasi beli/jual, ranking yield, saran pindah aset, atau jaminan anti-likuidasi. Pertanyaan tersebut ditolak singkat disertai penjelasan risiko posisi yang relevan.
- **Helper Scripting (`ask`):** untuk menjalankan tanya-jawab satu kali tanpa REPL (berguna untuk scripting dan CI):

```bash
npm run tahansoe -- ask "kenapa USDC ELEVATED?"
npm run tahansoe -- ask "harus beli token apa biar untung?" --json
```

### 3.3 Menjaga scheduler tetap hidup (foreground)

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

### 3.4 Script npm (alias ke `tahansoe`)

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
| `npm run settle` | Alias `tahansoe settle` — settlement report jatuh tempo (ADR 0005). |
| `npm run scorecard` | Alias `tahansoe scorecard` — metrik akurasi engine (recall/presisi/lead time). |
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

# Spec: Tahansoe CLI (`tahansoe`) — analisa langsung & scheduler dari terminal

- **Milestone:** M3 (research agents) — tooling operator/developer
- **Status:** In progress (REPL & grounded Q&A selesai; setup wizard pending)
- **Pemilik:** Kiro (shell + command), Antigravity (renderer + test), Claude Code (review)
- **Terkait:** [m3-research-agents](m3-research-agents.md), [m2-risk-fusion-v1](m2-risk-fusion-v1.md), [ADR 0009](../decisions/0009-single-openai-compatible-gateway.md), [ADR 0010](../decisions/0010-local-pglite-database-option.md), [ADR 0006](../decisions/0006-business-model-free-info-paid-automation.md)

## 1. Tujuan

Saat ini engine punya 15 script npm yang terpisah (`research`, `research:once`, `research:worker`, `research:history`, `models`, `settings`, `eval`, …). Spec ini menyatukannya menjadi **satu CLI `tahansoe`** yang menarik dan informatif. Dengan CLI ini operator bisa (a) menjalankan analisa risiko langsung dan melihat proses tiap agent secara live, (b) menjalankan scheduler analisa berkala dengan dashboard terminal, dan (c) membuka riwayat/laporan, model, dan settings dari satu pintu.

### 1.1 Catatan Implementasi (9 Okt 2026)

- **Command terimplementasi:** `analyze` (dengan live progress dan kartu laporan), `schedule` (`run`/`status` dengan `--once` dan `--with-price`), `history`, `report`, `doctor`, `models`, `settings`, `eval`, `carry`, `fuse`, `settle`, `scorecard`, `ask`.
- **Mode interaktif (REPL) & Q&A:** Mode REPL (`tahansoe` tanpa argumen di TTY) dan command `tahansoe ask "<pertanyaan>"` telah terimplementasi dengan grounded Q&A (data laporan, sinyal aktif, rate_samples, makro) dan penolakan tegas atas permintaan prediksi harga / sinyal trading (non-goals).
- **Deviasi tata letak renderer:** Seluruh helper rendering terminal (banner, box, bar, sparkline, progress, kartu laporan, penyamaran host, sanitasi teks) ditempatkan terpusat di `apps/engine/src/cli/render.ts` (bukan di subfolder `src/cli/ui/` seperti rencana awal). Deviasi ini menyederhanakan pemeliharaan file tanpa mengurangi cakupan unit test maupun fungsionalitas UI.
- **Pending di backlog:** Wizard interaktif `tahansoe setup` untuk inisialisasi awal provider DB (PGlite/Neon) dan API key.

## 2. Scope

**Termasuk:**
- Entry point tunggal `apps/engine/src/cli/tahansoe.ts`, script `npm run tahansoe -- <cmd>` dan `bin` `tahansoe` (lewat `npm link` lokal).
- Subcommand: `analyze`, `schedule`, `history`, `report`, `models`, `settings`, `eval`, `doctor`.
- Renderer terminal: banner, progress per tahap pipeline, kartu laporan, tabel, timeline regime.
- Mode `--json` di semua command yang mengeluarkan data (untuk scripting/cron).
- Script npm lama tetap ada sebagai alias tipis selama satu rilis.

**Tidak termasuk:**
- TUI layar penuh (ink/blessed), daemon/service OS, notifikasi Telegram (fitur terpisah).
- Eksekusi on-chain apa pun dari CLI (invariant I2: AI advises, rules decide, contract enforces).
- Gating berbayar: info riset gratis (ADR 0006).

## 3. Desain

### 3.1 Daftar command

| Command | Fungsi | Pengganti script |
|---------|--------|------------------|
| `tahansoe` (tanpa argumen) | Banner + status singkat (regime terakhir, model aktif, scheduler on/off) + daftar command | — |
| `tahansoe analyze [--assets ETH,USDC] [--dry] [--fake] [--pick] [--json]` | Satu run analisa live, lalu kartu laporan | `research`, `research:once`, `research:dry` |
| `tahansoe schedule [run\|status] [--once]` | `run`: scheduler foreground + dashboard live; `status`: lock, run terakhir, run berikutnya, budget | `research:worker` (+ `worker:price` via `--with-price`) |
| `tahansoe history [--limit 20] [--json]` | Tabel riwayat laporan + sparkline regime | `research:history` |
| `tahansoe report <id\|latest> [--json\|--md]` | Laporan lengkap: ringkasan, jalur T1–T10, bukti + sumber, debat Hawk/Dove, biaya | — |
| `tahansoe models [--filter x]` | Daftar model gateway + harga + estimasi biaya/bulan | `models` |
| `tahansoe settings [show\|set-role\|set\|init]` | Settings non-rahasia (`settings.json`) | `settings` |
| `tahansoe eval [--cases …]` | Jalankan set eval | `eval` |
| `tahansoe doctor` | Cek env (`LLM_API_URL`/`KEY` ada, tanpa mencetak nilai), DB, RPC, FRED, gateway `/models` | — |

### 3.2 Mockup `analyze`

```
 ▲ TAHANSOE  risk research · Arbitrum One · gateway router.bynara.id
 ─────────────────────────────────────────────────────────────────────
 ✔ Sources      RSS 7/7 · FRED 4 · Macro cal 3 · DefiLlama · On-chain     2.1s
 ✔ Analysts     macro ✔  geopolitics ✔  crypto-market ✔  onchain ✔       6.4s
 ✔ Debate       hawk ⇄ dove · 1 round                                     3.0s
 ◐ Assessor     deepseek-v4.1-flash …

 ╭─ RISK REPORT · 2026-10-09 14:02 UTC ─────────────────────────────╮
 │  Regime     ● ELEVATED        Direction  ▼ DOWN                 │
 │  Confidence ██████░░░░ 0.55 (cap 0.60)   Horizon 24h            │
 │                                                                 │
 │  Top paths                                                      │
 │   T2 Macro rates shock      ███████░░  sev 0.7                  │
 │   T7 Geopolitical risk-off  █████░░░░  sev 0.5                  │
 │                                                                 │
 │  Key evidence                                                   │
 │   • FOMC in 2 days, CPI above consensus   — Fed, BLS            │
 │   • Stablecoin supply flat 7d             — DefiLlama           │
 │                                                                 │
 │  Suggested buffer: raise trigger HF within your approved band   │
 ╰─────────────────────────────────────────────────────────────────╯
  saved #a91f… · 46.8k tok · Rp 41 · 11.5s · not a trading signal
```

### 3.3 Mockup `schedule run`

```
 ▲ TAHANSOE scheduler · lock held · Ctrl+C to stop
 Regime 24h  ▁▁▂▂▂▃▃▂  CALM → ELEVATED
 Last run    14:02 UTC  ELEVATED ▼  #a91f…  11.5s
 Next run    in 58:12  (ELEVATED → every 60m)
 Budget      $0.08 / $5.00 today  ▏░░░░░░░░░
 Price feed  ETH 2,412.30 · USDC 1.0000 (capped) · 30s ago
 ── log ────────────────────────────────────────────
 14:02 ✔ run ok  ELEVATED ▼ conf 0.55  46.8k tok
 12:02 ✔ run ok  CALM →    conf 0.40  44.1k tok
```

Pada non-TTY (cron, pipe) tidak ada animasi; satu baris log per run (format worker sekarang).

### 3.4 Teknis

- **Parsing argumen:** `node:util` `parseArgs` (tanpa framework CLI).
- **Dependensi baru (kecil, terpopuler, tanpa native):** `picocolors` (warna) dan `@clack/prompts` (prompt picker model + spinner). Semua kotak/bar/sparkline dibuat sendiri di `src/cli/ui/` sebagai fungsi murni `string → string` supaya bisa di-unit-test.
- **Struktur:**
  ```
  src/cli/
    tahansoe.ts          # entry: dispatch subcommand
    commands/            # analyze.ts, schedule.ts, history.ts, report.ts, models.ts, settings.ts, eval.ts, doctor.ts
    ui/                  # theme.ts (warna per regime), box.ts, bar.ts, sparkline.ts, table.ts, progress.ts, format.ts
  ```
- **Progress live:** `runResearch` menerima callback opsional `onProgress(event)` (`stage_start`, `stage_done`, `analyst_done`, `error`) tanpa mengubah logika pipeline. Worker juga memakai hook ini.
- **Scheduler:** `schedule run` membungkus `research-worker.ts` yang sudah ada (advisory lock, jadwal adaptif, budget, kill switch). Logika penjadwalan tidak ditulis ulang; CLI hanya menyediakan logger/renderer. `--with-price` sekaligus menjalankan price worker di proses yang sama.
- **Aksesibilitas:** hormati `NO_COLOR`, `--no-color`, lebar terminal (`process.stdout.columns`, min 60), fallback ASCII jika `TERM=dumb`. Exit code: 0 ok, 1 error, 2 config salah (mis. env LLM hilang).
- **Warna regime:** CALM hijau, ELEVATED kuning, STRESSED oranye/magenta, CRISIS merah. Selaras dengan token di `DESIGN.md` bila ada padanannya.

### 3.5 Mode interaktif (REPL) — tambahan 9 Okt 2026

`tahansoe` tanpa argumen di terminal interaktif (TTY) membuka sesi seperti CLI AI agent. Non-TTY tetap mencetak banner + daftar command (perilaku lama).

```
 ▲ TAHANSOE  risk research · Arbitrum One · gpt-6-luna
 Last: ELEVATED (ETH, USDC) · 14:06 UTC · 8 active signals
 Type /help for commands, or ask a question about the latest analysis.

 › /carry
 (tabel carry seperti `tahansoe carry`)
 › kenapa USDC ELEVATED?
 USDC is ELEVATED mainly because of on-chain interest-rate stress, not price:
 • USDC.e pool 92.1% utilized, past its 90% kink (borrow APR 18.3%)  [signal ONCHAIN T11, 14:06]
 • Negative carry WETH→USDC −4.7%/yr → HF 1.50→1.45 in ~265 days     [rate_samples 14:00]
 Research (14:01) proposed ELEVATED with confidence 0.48 (cap 0.60).
 informational · not investment advice
```

**Slash command** (memanggil fungsi command yang sudah ada, tanpa proses baru): `/analyze [--dry]`, `/fuse`, `/carry`, `/history`, `/report [id|latest]`, `/settle`, `/scorecard`, `/models`, `/settings`, `/doctor`, `/status`, `/help`, `/clear`, `/exit`. Autocomplete dengan Tab, riwayat input dengan ↑/↓. `schedule run` tidak tersedia di REPL (proses jangka panjang; jalankan terpisah).

**Tanya-jawab (Q&A):**
- Dijawab model gateway (peran baru `chat` di `settings.json`, default sama dengan analyst) **hanya dari data tersimpan**: laporan riset terbaru + 24 jam terakhir, risk assessment terbaru per aset, sinyal aktif, `rate_samples` terbaru/carry, ringkasan `price_samples`, kalender makro mendatang. Konteks dirakit kode (deterministik), bukan oleh model; tanpa tools.
- Jawaban mengikuti bahasa pertanyaan user (Indonesia/Inggris). System prompt berbahasa Inggris.
- Wajib menyebut sumber per poin (jenis data + waktu), dan menyatakan "data tidak tersedia, jalankan /analyze" bila konteks kosong atau basi (> 6 jam).
- Dilarang: prediksi harga, saran beli/jual, ranking yield, saran pindah aset, janji anti-likuidasi (positioning: bertahan lama, bukan cepat kaya). Pertanyaan semacam itu dijawab dengan penolakan singkat + penjelasan risiko posisi yang relevan.
- Riwayat percakapan dalam sesi (maks. 10 giliran) ikut dikirim; tidak disimpan ke DB.
- Output melewati `redactInstructions` (data berita bisa berisi injeksi) dan disanitasi dari kode ANSI sebelum dicetak. Biaya per jawaban dicatat di budget harian dan ditampilkan kecil di bawah jawaban.

### 3.6 Tampilan & bahasa (permintaan user 2026-10-10, gaya Hermes/OpenClaw)

**Identitas visual** (token dari `DESIGN.md`; truecolor bila didukung, fallback 256/16 warna, polos bila `NO_COLOR`/non-TTY):
- **Banner ASCII** "TAHANSOE" (huruf blok) dengan gradien brand `#4ab5e0` → `#34d399` + tagline "non-custodial liquidation-risk agent · Arbitrum". Versi ringkas otomatis bila terminal < 80 kolom; tanpa banner untuk `--json` dan non-TTY.
- **Warna semantik konsisten**: brand `#4ab5e0` (aksen/judul), safe `#34d399` (CALM/OK), warning `#fbbf24` (ELEVATED), danger `#f87171` (STRESSED/CRISIS), teks sekunder `#c8bca9`, garis `#26332f`. Satu modul tema (`src/cli/ui/theme.ts`), dipakai semua command.
- **Komponen**: kartu/panel ber-border bulat, header bagian, badge regime, progress/spinner seragam, tabel rapi, baris status (model · gateway · DB · regime terakhir), footer tip. Ikon unicode dengan fallback ASCII bila terminal tidak mendukung.
- **Layar sambutan REPL**: banner + panel status (regime per aset, sinyal aktif, data basi/segar, gateway on/off, model) + 3 saran perintah. `/help` dikelompokkan (Analisa · Risiko & Bunga · Gateway · Konfigurasi · Sistem).

**Bahasa (i18n):**
- Dua bahasa UI: **`id`** (Indonesia) dan **`en`** (Inggris). Semua teks UI CLI/REPL/wizard lewat katalog `src/cli/i18n/{id,en}.ts` dengan kunci bertipe (TypeScript memastikan kedua katalog lengkap).
- Prioritas: flag `--lang id|en` → `settings.json` `ui.language` → env `TAHANSOE_LANG` → locale sistem (`Intl`) → `en`.
- Ganti bahasa: `tahansoe settings set ui.language id`, REPL `/lang id|en` (tersimpan), dan langkah pertama di `tahansoe setup`.
- Yang **tidak** diterjemahkan: prompt LLM (tetap Inggris, aturan repo), output `--json`, kode/istilah teknis (HF, regime, T1–T11). Jawaban tanya-jawab tetap mengikuti bahasa pertanyaan.
- Pesan bot Telegram ikut `ui.language` sebagai default (per-chat `/lang` menyusul di gateway).

## 4. Dampak keamanan

- REPL Q&A (§3.5): model tanpa tools, konteks dirakit kode, output diredaksi + disanitasi, tidak ada aksi on-chain dari REPL; batas Non-Goals ditegakkan di prompt dan dicek di eval (pertanyaan "harus beli apa?" → penolakan).

- I2: CLI hanya membaca dan menulis laporan riset/settings; tidak ada aksi on-chain, tanpa private key.
- I5/I8: kartu laporan menampilkan konten eksternal (judul berita) sebagai **teks**. Karakter kontrol/ANSI dari sumber eksternal **dibuang** sebelum dicetak, untuk mencegah injeksi escape sequence ke terminal.
- I8: `doctor` dan semua output tidak pernah mencetak `LLM_API_KEY`, `DATABASE_URL`, atau URL RPC lengkap (host disamarkan).
- Positioning: setiap kartu laporan diakhiri "not a trading signal". Tidak ada bahasa "buy/sell".

## 5. Kriteria penerimaan

- [x] `npm run tahansoe -- analyze --fake` menampilkan progress + kartu laporan tanpa jaringan/LLM.
- [x] `analyze --json` mengeluarkan JSON valid saja di stdout (log ke stderr).
- [x] `schedule run` memakai worker yang ada; Ctrl+C melepas lock dengan bersih; `schedule status` membaca DB.
- [x] `history`, `report latest`, `models`, `settings`, `doctor` berfungsi; output non-TTY tanpa kode ANSI.
- [x] Teks eksternal dengan escape ANSI disanitasi (ada test).
- [x] Script npm lama tetap jalan (alias).
- [x] Typecheck 0 error, `npm test` hijau.
- [x] Mode REPL interaktif dan grounded Q&A (`tahansoe ask` / REPL chat) terimplementasi dengan guardrail non-goals.
- [ ] Wizard `tahansoe setup` (konfigurasi interaktif DB PGlite/Neon & gateway LLM; pending di backlog).

## 6. Rencana test

- Unit renderer `ui/*` (snapshot string dengan warna dimatikan): box, bar, sparkline, table, pemotongan lebar.
- Unit parser argumen per command, sanitasi ANSI, penyamaran host.
- Integrasi `analyze --fake --json` dan `schedule run --once` dengan runner mock.
- Verifikasi manual: Windows Terminal + PowerShell, Git Bash, pipe ke file.

## 7. Keputusan (pertanyaan terbuka yang sudah dijawab)

| Pertanyaan | Keputusan |
|------------|-----------|
| Nama binary | `tahansoe` |
| Mode scheduler | Foreground saja; dijalankan terus lewat pm2 / Task Scheduler / systemd (didokumentasikan di README) |
| Dependensi baru | Disetujui: `picocolors`, `@clack/prompts`. Box/bar/sparkline/table ditulis sendiri |

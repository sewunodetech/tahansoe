# Status Proyek

**Last updated:** 9 Oktober 2026
**Milestone aktif:** M2 (Core Risk Engine v1 / Research Layer) dan M1 (Integrasi on-chain web) — lihat [PRD §10](prd.md#10-roadmap-eksekusi)

> Perbarui file ini di akhir setiap pekerjaan: pindahkan item yang selesai, tambahkan gap baru, dan tulis next step.

---

## Sudah jalan

### Web, Dashboard & Kontrak
- Landing page + dashboard (positions, history, bot, chat placeholder, settings)
- Login wallet via SIWE + session cookie
- Simulation engine di dashboard (drift harga ETH, HF, pemilihan strategi)
- Linking & notifikasi Telegram dari antarmuka web
- Skema database (Drizzle) + script migrasi di `packages/db`
- `TahansoeGuardian` v1: hot reserve repay, unit + fuzz test, fork test Aave V3 Arbitrum Sepolia
- Guardian v1 ter-deploy di Arbitrum Sepolia: `0x1A5D249A8e711E2288AdD7c01e31Eb7FFB05D97E`
- Dokumentasi & workflow agent (PRD v0.3, BRD, architecture, security, ADR)
- Struktur monorepo npm workspaces (ADR 0007): `apps/web`, `apps/engine`, `packages/db`, `packages/domain`
- **Pilihan Database Lokal: PGlite di Samping Neon (ADR 0010):** Dual-driver di `@tahansoe/db` via env `DB_DRIVER` (`pglite` vs `neon`). PGlite embedded Postgres berbasis WASM (`@electric-sql/pglite`) dengan penyimpanan lokal di `PGLITE_DATA_DIR` (default `apps/engine/.data/pglite`, gitignored) dan auto-migrasi skema idempoten. Single-instance advisory lock untuk worker/scheduler diimplementasikan via file lock lokal (`lock-${key}.json`, PID + heartbeat, stale takeover >2 menit atau dead PID). `apps/web` tetap di Neon; CLI engine dapat berjalan offline tanpa akun cloud DB. Unit & integration test lulus 100% di kedua driver.

### Core Risk Engine & Research Agents (M3)
- **Pipeline Riset Multi-Agent Penuh:** 4 analis domain paralel (Geopolitics, Macro, Market, Onchain) $\rightarrow$ debat dialektika Hawk vs Dove $\rightarrow$ sintesis Risk Assessor $\rightarrow$ pemetaan ke `Signal` (`RESEARCH`, confidence cap $\le 0.6$).
- **Adapter Sumber Data Gratis & Kredibel:**
  - RSS feed outlet berita terkurasi (BBC World, Al Jazeera, The Guardian, CNBC Economy, Federal Reserve, CoinDesk, The Block).
  - FRED API untuk data makro ekonomi resmi (suku bunga Fed Funds, CPI, kurva yield 10Y-2Y).
  - Kalender makro resmi: jadwal FOMC dari federalreserve.gov (horizon 30 hari) dan rilis CPI/NFP dari data rilis FRED.
  - DefiLlama API untuk monitoring peg stablecoin (USDC, USDT, DAI, FRAX) dan insiden hack/exploit protokol DeFi dengan scaling ukuran dan relevansi Tahansoe.
  - On-chain Arbitrum One: pembacaan oracle Aave vs Chainlink proxy dan Sequencer Uptime Feed.
- **Single LLM Gateway OpenAI-Compatible (9 Okt 2026 — ADR 0009):**
  - Menggantikan konfigurasi multi-provider yang kompleks (men-supersede sebagian ADR 0008).
  - Environment server hanya membutuhkan dua secret: `LLM_API_URL` dan `LLM_API_KEY`. Berganti provider cukup mengganti dua nilai ini tanpa menyentuh kode.
  - Konfigurasi model per peran (`analyst`, `debate`, `assessor`, `reflector`) dan harga token disimpan di `settings.json` v2 (non-rahasia, di-gitignore) sebagai daftar nama model murni (*plain model names*) dengan fallback berantai.
  - JSON Schema di-embed langsung ke dalam system prompt, didukung toleransi ekstraksi teks, 1x repair retry jika schema tidak valid, lalu fallback ke model berikutnya.
  - Perhitungan budget harian terintegrasi dinamis dengan harga gateway (`settings.modelPrices` > `pricingUrl` > fallback konservatif).
- **CLI Terpadu `tahansoe` (9 Okt 2026 — [spec m3-cli](specs/m3-cli.md)):**
  - Satu pintu interaksi terminal operator (`apps/engine/src/cli/tahansoe.ts`, helper terpusat di `render.ts`).
  - Mendukung subcommand lengkap: `analyze` (live progress per tahap + kartu laporan), `schedule` (`run` foreground dengan advisory lock & live dashboard, `status`), `history`, `report` (`<id|latest>` format `--md` atau `--json`), `doctor`, `models`, `settings`, `eval`, `carry`, `fuse`, `settle`, `scorecard`, `ask`.
  - Mode interaktif (REPL) dengan slash commands dan grounded Q&A (`tahansoe ask` / REPL chat) dengan guardrail penolakan trading/prediksi harga.
- **Carry & Interest-Rate Monitoring — jalur T11 (9 Okt 2026, [spec](specs/m3-carry-interest-monitoring.md)):**
  - Tabel `rate_samples` + sampler bunga Aave V3 Arbitrum tiap 15 menit (`RATE_SAMPLE_INTERVAL_MIN`), on-chain via Pool/strategy (I5).
  - Pemancar sinyal deterministik T11 (`src/signals/emit.ts`): kink proximity, lonjakan bunga (≥ 2× atau > 20% APR stablecoin), carry negatif 5 pasangan representatif; T7 bila utilization ≥ 98%. Guardrail: T11 tanpa konfirmasi lain maksimal ELEVATED (dihitung dari modul terkonfirmasi saja; property test).
  - `tahansoe carry`: tabel reserve + "HF 1.50 → 1.45 dalam N hari" + skenario lewat kink; tanpa kata ranking/saran investasi (test).
  - Verifikasi live: USDC.e util 92,1% (borrow 18–20%), GHO 93%, USDC native 91,7% lewat kink; WETH→USDC carry −4,7%/thn (≈ 265 hari ke HF 1.45). Fusion ETH/USDC naik CALM → ELEVATED dari sinyal on-chain.
- **Modul Sinyal Deterministik & Deduplikasi (9 Okt 2026, [spec](specs/m2-deterministic-signal-modules.md), commit 1803000):**
  - Modul deterministik lengkap memancarkan sinyal terkonfirmasi via `src/signals/emit.ts`:
    - `ORACLE`: Sequencer uptime (T10, down = 1.0, grace period 1 jam = 0.7), staleness & deviasi AaveOracle vs Chainlink proxy (T8).
    - `ONCHAIN`: Depeg stablecoin USDC/USDT/DAI > 1% (T4, linear s.d. 5%), suku bunga dekat kink & negative carry (T11), reserve kering (T7).
    - `MACRO`: Event ekonomi resmi FOMC, CPI, NFP dalam rentang 48 jam mendatang (T1/T2, severity 0.4–0.6, horizon terstruktur).
  - **Stable dedupe keys:** Menggunakan `getSignalDedupeKey(s)` (`${module}:${primaryPath}:${asset}:${type}`) untuk mencegah penggandaan skor sinyal di tabel `signals` saat fusion tick berulang (15 menit).
  - **Risk Fusion v1 Terintegrasi:** Menggabungkan sinyal terkonfirmasi (`ONCHAIN`, `ORACLE`, `MACRO`) dan sinyal `RESEARCH`. Guardrail deterministik menjamin sinyal riset AI unconfirmed (cap confidence 0.60) tidak pernah bisa menaikkan regime ke `STRESSED`/`CRISIS` sendirian tanpa konfirmasi pasar nyata. Status sinyal dan hasil fusion dapat langsung diinspeksi via `tahansoe fuse`.
- **Pemilihan model final (9 Okt 2026, prompt 2026.10.2 + redaksi instruksi):** `gpt-6-luna` (OpenAI) lolos eval **24/24** (injeksi 16/16 tanpa bocoran, skenario 8/8, schema 100%), biaya eval Rp 110 (~Rp 4,6 per kasus). Dipakai sebagai default semua peran, cadangan `deepseek-v4-flash`. `agnes-2.5-flash` ditinggalkan karena asal-usul model tidak jelas dan masih ada bocoran injeksi/overrun schema.
  - Mengonsumsi ~36.5k token dengan biaya operasional sangat efisien (~Rp6/run) dan menghasilkan proposal regime `CALM`.
- **Penyimpanan Database Neon Postgres:** Tabel `research_reports` (dengan diagnostik per-peran audit G7) dan `signals` (`RESEARCH`), serta skrip inspeksi riwayat `tahansoe history`.
- **Scheduled Background Research Worker:**
  - Single-instance enforcement via PostgreSQL session advisory lock (`pg_try_advisory_lock(42161001)` pada koneksi direct non-pooler) mencegah tabrakan proses.
  - Penjadwalan adaptif berdasarkan regime hasil terakhir (`CALM` $\rightarrow$ 2 jam; `ELEVATED`/`STRESSED`/`CRISIS` $\rightarrow$ 1 jam; dapat dioverride lewat env).
  - Guard anti-overlap, kill switch `RESEARCH_ENABLED=false`, proteksi budget harian `LLM_DAILY_BUDGET_USD`, logging terformat satu baris per run, dan shutdown bersih pada `SIGINT`/`SIGTERM`.
- **Eval Set & Runner Sadar Kuota:**
  - 16 kasus prompt injection (menguji ketahanan guardrail G3 dan kebocoran instruksi) + 8 kasus skenario pasar acuan dengan rentang regime yang disepakati.
  - Runner eval dengan kesadaran kuota dan konkurensi: worker pool `--concurrency N` (default 1), jeda antar kasus (`DEFAULT_CASE_DELAY_MS`), deteksi error kuota harian (menghentikan run, menandai kasus tersisa `skipped: quota`, menulis laporan parsial), hard spend cap IDR (`--max-cost-idr`, default Rp 3000), dan retry otomatis pada rate limit 429 per-menit.
  - Opsi CLI lengkap: `--set injection|scenarios|all`, `--limit N`, `--concurrency N`, `--label <name>`, `--initial-spent-idr N`, dan `--dry-plan` untuk perencanaan offline.
  - 17 unit test offline lulus 100% menggunakan `FakeProvider` dan fake `runCase` deterministik.
- **Hasil Benchmark Evaluasi Gateway Bynara (9 Okt 2026 — Prompt v2026.10.2):**
  - **Combo A-v2 (`all agnes-2.5-flash`):** Pass rate 87.5% (21/24), Scenario Agreement 87.5% (7/8, target $\ge 70\%$ terpenuhi), Injection 14/16 pass, Biaya Rp 76.53 (~Rp 3.19/kasus).
  - Terbukti sebagai kombinasi paling murah dan andal dibandingkan opsi lain (`deepseek-v4-flash` jauh lebih rentan kebocoran prompt injeksi dan 6-7x lebih mahal).
- **Scheduled Settlement & Scorecard Pipeline (ADR 0005, spec §3.5 & §3.6):**
  - Evaluasi deterministik hasil prediksi research agent (`TRUE_POSITIVE`, `FALSE_POSITIVE`, `MISSED`, `TRUE_NEGATIVE`) menggunakan sampel harga AaveOracle (I5) dan sinyal on-chain.
  - Guard kelengkapan jendela data (toleransi batas awal/akhir 30 menit, celah internal maks 60 menit) menghindari penyimpanan label spekulatif/palsu di database.
  - Eksekusi idempotent (`runSettlementJob`) aman terhadap eksekusi berulang tanpa duplikasi baris di `risk_settlements`.
  - Scorecard generator & CLI tabel ASCII (`apps/engine/src/cli/scorecard.ts`) menghitung Recall, Presisi (≥ STRESSED), Median Lead Time, dan pelacakan laporan yang kekurangan data.
  - 31 unit test offline lulus 100% dan terverifikasi live pada database Neon.
- **CLI Mode Interaktif (REPL) & Tanya-Jawab Grounded (`tahansoe ask` & REPL) (9 Okt 2026 — spec m3-cli §3.5):**
  - Prompt interaktif terminal `tahansoe` tanpa argumen: REPL readline dengan banner, status line terkini, autocomplete Tab untuk slash commands (`/analyze`, `/fuse`, `/carry`, `/history`, `/report`, `/settle`, `/scorecard`, `/models`, `/settings`, `/doctor`, `/status`, `/help`, `/clear`, `/exit`).
  - Command non-interaktif `tahansoe ask "<question>"` (`--json`, `--no-color`) untuk scripting & verifikasi CI/CD.
  - Runtime pricing otomatis dibootstrap dari gateway pricing/settings (`bootstrapBudgetPricing`), menampilkan estimasi biaya aktual dalam IDR ("Rp 1" – "Rp 2") tanpa fallback warning palsu.
  - Pelacakan kesegaran data per-sumber (`report`, `assessments`, `signals`, `rate_samples`, `price_samples`) dengan ambang 6 jam; penanda eksplisit `STALE since <time>` diteruskan ke model, dan baris penutup otomatis mencantumkan sumber stale berserta rekomendasi refresh (`schedule run --with-price` atau `/analyze`).
  - Guardrail keamanan: penolakan ketat instruksi trading, saran investasi, prediksi harga token, dan jaminan anti-likuidasi (PRD §11); redaksi prompt injection tersisip (`redactInstructions`); sanitasi karakter kontrol terminal; footer "informational · not investment advice".
  - 20 unit test offline lulus 100% dan terverifikasi live dengan gateway Bynara / `gpt-6-luna`.

---

## Gap yang diketahui

### Evaluasi & Model LLM
- [ ] Batasan skema 800 karakter untuk `hawkCase`/`doveCase` terkadang ketat pada model selain `gpt-6-luna`; pertimbangkan relaksasi ke 1200 karakter bila diperlukan saat evaluasi model alternatif.

### Engine, Fusion & Settlement
- [ ] Scorecard belum direkap otomatis mingguan (settlement sendiri sudah berjalan tiap 60 menit di `tahansoe schedule run`, lock terpisah; data scorecard baru bermakna setelah scheduler jalan beberapa hari).
- [ ] Modul teknikal lanjutan M2 (volatilitas realized EWMA/GARCH, funding rate ekstrem, open interest perp DEX) belum diimplementasikan.
- [ ] Wizard interaktif `tahansoe setup` belum diimplementasikan (pending di backlog).
- [ ] Pengiriman notifikasi alert Telegram langsung dari server engine belum ada (saat ini masih dipicu dari browser di web app).
- [ ] Host deployment untuk long-running engine worker di lingkungan cloud/VPS belum dipilih.

### Produk Web & Kontrak (M1)
- [ ] Web app belum terhubung ke kontrak Guardian v1 (belum ada read/write on-chain langsung).
- [ ] Settings user masih disimpan di `localStorage`, belum tersinkronisasi ke kontrak atau database.
- [ ] Dashboard masih menampilkan data simulasi demo, bukan posisi borrow Aave asli dari wallet terhubung.
- [ ] Tabel `users` unik per `(wallet, chainId)` $\rightarrow$ perlu disederhanakan per wallet.
- [ ] Tabel `positions`, `policies`, `intents`, `notification_logs` belum aktif digunakan oleh web app.

### Kontrak & Keamanan
- [ ] `checkUpkeep` memakai daftar user statis di `checkData`; butuh registry/pagination on-chain.
- [ ] Satu policy & satu debt asset per user di v1.
- [ ] Kontrak Guardian v1 belum diaudit formal.
- [ ] Guardian v2 (risk band dinamis, pergeseran trigger via AI agent, flash loan) direncanakan untuk M4.

---

## Next steps (urutan disarankan)

1. **Wizard Interaktif `tahansoe setup` (Backlog prioritas):** Panduan CLI interaktif untuk inisialisasi `.env` (`LLM_API_URL`, `LLM_API_KEY`), pemilihan provider database (PGlite/Neon, [ADR 0010](decisions/0010-local-pglite-database-option.md)), verifikasi gateway via `/models`, dan verifikasi kesehatan sistem via `doctor`.
2. **Jalankan scheduler beberapa hari** (`tahansoe schedule run --with-price`) agar settlement otomatis (sudah tiap 60 menit) menghasilkan label `TRUE_POSITIVE`/`FALSE_POSITIVE`/`MISSED` nyata, lalu uji reflector (lessons) dan rekap scorecard mingguan.
3. **Implementasi Notifikasi Telegram Server:** Memindahkan trigger alert Telegram dari frontend browser ke engine worker agar alert tetap terkirim saat user tidak membuka web.
4. **Implementasi Integrasi Web On-chain (Spec M1):** Menghubungkan settings web ke `TahansoeGuardian` v1 (`approve` + `setPolicy`), membaca posisi Aave nyata via wagmi/viem, dan menyelesaikan transisi dashboard demo.
5. **Modul Teknikal Lanjutan M2:** Volatilitas realized (EWMA), funding rate ekstrem, dan open interest pada perp DEX Arbitrum.

---

## Backlog / ide

- **(Dikerjakan paling akhir, permintaan user 9 Okt 2026) `tahansoe setup` wizard:** input `LLM_API_URL` + `LLM_API_KEY` (tersembunyi) → tes `/models` → pilih model + estimasi biaya → simpan `settings.json`; pilih database & RPC; tutup dengan `doctor`. Secret hanya ke `.env` (gitignored), tidak pernah dicetak ulang.
- [x] **Pilihan database lokal (selesai — ADR 0010):** `DB_DRIVER=pglite` (Postgres embedded, data di `apps/engine/.data/`, tanpa server/akun — skema & query Drizzle tetap sama) di samping `DB_DRIVER=neon`. Auto-migrasi dan file advisory lock selesai.

- EIP-7702 untuk smart account tanpa migrasi wallet
- `repayWithATokens` sebagai opsi sumber dana tanpa modal idle
- API risk score untuk partner B2B
- Shadow mode 2 minggu research agents sebelum notifikasi Telegram diaktifkan untuk user

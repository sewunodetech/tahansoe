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
- **CLI Terpadu `tahansoe` (9 Okt 2026 — spec m3-cli):**
  - Satu pintu interaksi terminal operator (`apps/engine/src/cli/tahansoe.ts`, helper terpusat di `render.ts`).
  - Mendukung subcommand: `analyze` (live progress per tahap + kartu laporan), `schedule` (`run` foreground dengan PostgreSQL session advisory lock & live dashboard, `status`), `history`, `report` (`<id|latest>` format `--md` atau `--json`), `doctor`, `models`, `settings`, `eval`.
- **Live Run Perdana via Gateway Bynara (9 Okt 2026):**
  - Uji coba live penuh pertama kali berhasil menggunakan gateway Bynara dengan model `agnes-2.5-flash` untuk seluruh peran.
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

---

## Gap yang diketahui

### Evaluasi & Model LLM
- [ ] `hawkCase`/`doveCase` pada assessor terkadang melebihi batasan skema 800 karakter (`inj-ignore-schema`, `scn-protocol-exploit`); pertimbangkan relaksasi skema ke 1200 karakter atau penegasan instruksi ringkas.
- [ ] 1 kasus injeksi tersisa (`inj-unknown-source-claim`) masih membocorkan instruksi jarum ke output teks sintesis assessor pada `agnes-2.5-flash`.

### Engine, Fusion & Settlement
- [ ] Job settlement (`src/reflection/settle-job.ts`) belum dijadwalkan secara berkala di background scheduler (saat ini dijalankan manual via CLI / direct runner).
- [ ] Risk Fusion deterministik v1 (menggabungkan sinyal teknikal/on-chain dan sinyal `RESEARCH`) belum diintegrasikan penuh ke loop utama `apps/engine`.
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

1. **Jalankan Eval Live dengan Model Murah:** Menggunakan router OpenAI-compatible generik (mis. Bynara/OpenRouter) pada eval set injection & scenarios untuk menentukan kombinasi model per peran termurah yang lolos eval (spec §3.4).
2. **Implementasi Risk Fusion Deterministik v1 (M2):** Menggabungkan sinyal on-chain/teknikal dengan sinyal `RESEARCH`, menjamin aturan bahwa sinyal riset saja tidak pernah menaikkan regime ke `STRESSED`/`CRISIS` tanpa konfirmasi pasar.
3. **Automasi Settlement Terjadwal:** Mengaktifkan pengecekan outcome horizon di engine worker untuk menghasilkan label `TRUE_POSITIVE`/`FALSE_POSITIVE`/`MISSED` dan scorecard periodik.
4. **Implementasi Notifikasi Telegram Server:** Memindahkan trigger alert Telegram dari frontend browser ke engine worker agar alert tetap terkirim saat user tidak membuka web.
5. **Implementasi Integrasi Web On-chain (Spec M1):** Menghubungkan settings web ke `TahansoeGuardian` v1 (`approve` + `setPolicy`), membaca posisi Aave nyata via wagmi/viem, dan menyelesaikan transisi dashboard demo.

---

## Backlog / ide

- EIP-7702 untuk smart account tanpa migrasi wallet
- `repayWithATokens` sebagai opsi sumber dana tanpa modal idle
- API risk score untuk partner B2B
- Shadow mode 2 minggu research agents sebelum notifikasi Telegram diaktifkan untuk user

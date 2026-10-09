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
- **Multi-Provider LLM & Provider Generik (ADR 0008):**
  - Adapter `OpenAICompatibleProvider` (mendukung Gemini, Groq, OpenRouter, DeepSeek, Ollama, dan endpoint generik dari `LLM_BASE_URL` seperti Bynara/vLLM) + `AnthropicProvider`.
  - Router peran (`LLM_ANALYST`, `LLM_DEBATE`, `LLM_ASSESSOR`, `LLM_REFLECTOR`) dengan fallback berantai (`provider:model,provider:model`).
  - Integrasi daftar harga dinamis (`LLM_PRICING_URL`) membaca otomatis format Bynara dan OpenRouter, serta dukungan harga manual JSON (`LLM_MODEL_PRICES`).
  - Estimasi biaya riset berdasarkan profil token historis dari database atau baseline default.
  - CLI interaktif `npm run research` (pemilihan model per peran, pratinjau biaya, auto-write ke `.env`) dan CLI `npm run models` (`--filter`).
- **Penyimpanan Database Neon Postgres:** Tabel `research_reports` (dengan diagnostik per-peran audit G7) dan `signals` (`RESEARCH`), serta skrip inspeksi riwayat `npm run research:history`.
- **Scheduled Background Research Worker:**
  - Single-instance enforcement via PostgreSQL session advisory lock (`pg_try_advisory_lock(42161001)` pada koneksi direct non-pooler) mencegah tabrakan proses.
  - Penjadwalan adaptif berdasarkan regime hasil terakhir (`CALM` $\rightarrow$ 2 jam; `ELEVATED`/`STRESSED`/`CRISIS` $\rightarrow$ 1 jam; dapat dioverride lewat env).
  - Guard anti-overlap, kill switch `RESEARCH_ENABLED=false`, proteksi budget harian `LLM_DAILY_BUDGET_USD`, logging terformat satu baris per run, dan shutdown bersih pada `SIGINT`/`SIGTERM`.
- **Eval Set & Runner Sadar Kuota:**
  - 16 kasus prompt injection (menguji ketahanan guardrail G3 dan kebocoran instruksi) + 8 kasus skenario pasar acuan dengan rentang regime yang disepakati.
  - Runner eval dengan kesadaran kuota: jeda antar kasus (`DEFAULT_CASE_DELAY_MS`), deteksi error kuota harian (menghentikan run, menandai kasus tersisa `skipped: quota`, menulis laporan parsial), dan retry otomatis pada rate limit 429 per-menit.
  - Opsi CLI lengkap: `--set injection|scenarios|all`, `--limit N`, dan `--dry-plan` untuk perencanaan offline tanpa menyentuh API.
  - 13 unit test offline lulus 100% menggunakan `FakeProvider`.
- **Scheduled Settlement & Scorecard Pipeline (ADR 0005, spec §3.5 & §3.6):**
  - Evaluasi deterministik hasil prediksi research agent (`TRUE_POSITIVE`, `FALSE_POSITIVE`, `MISSED`, `TRUE_NEGATIVE`) menggunakan sampel harga AaveOracle (I5) dan sinyal on-chain.
  - Guard kelengkapan data (`insufficient_data` jika sampel harga tidak mencukupi horizon) menghindari penyimpanan label spekulatif/palsu di database.
  - Eksekusi idempotent (`runSettlementJob`) aman terhadap eksekusi berulang tanpa duplikasi baris di `risk_settlements`.
  - Scorecard generator & CLI tabel ASCII (`apps/engine/src/cli/scorecard.ts`) menghitung Recall, Presisi (≥ STRESSED), Median Lead Time, dan pelacakan laporan yang kekurangan data.
  - 26 unit test offline lulus 100% dan terverifikasi live pada database Neon.

---

## Gap yang diketahui

### Evaluasi & Model LLM
- [ ] Eval live penuh dengan model kandidat belum dijalankan secara komprehensif karena keterbatasan kuota free tier Gemini; perlu dijalankan menggunakan provider generik/Bynara berbayar untuk memvalidasi model termurah yang lolos eval (spec §3.4).
- [ ] Kualitas penalaran, ketahanan refusal pada topik sensitif, dan kepatuhan format JSON tiap model murah (DeepSeek, Llama 3.3, dsb.) belum diuji secara empiris di bawah beban live.

### Engine, Fusion & Settlement
- [ ] Risk Fusion deterministik v1 (menggabungkan sinyal teknikal/on-chain dan sinyal `RESEARCH`) belum diimplementasikan di `apps/engine`.
- [ ] Integrasi trigger runner terjadwal (cron/loop background) di server engine untuk memanggil `runSettlementJob` secara berkala bersamaan dengan worker utama.
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

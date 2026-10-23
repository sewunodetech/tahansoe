# 0012 — Satu database web & engine, broadcast riset outbound via bot Telegram web

- **Status:** Accepted (arahan user, 2026-10-23)
- **Tanggal:** 2026-10-23
- **Pengusul:** Engineering (Antigravity worker, atas arahan user)
- **Men-supersede:** Sebagian [ADR 0011](0011-postgres-only-gateway-only-chat.md) §2–§3 (chat gateway & Q&A). Mengubah [spec m3-channel-gateway-telegram](../specs/m3-channel-gateway-telegram.md) menjadi outbound-only broadcast di [spec m3-research-broadcast](../specs/m3-research-broadcast.md).

## Konteks

Audit sistem pada 23 Oktober 2026 ([plan riset broadcast](../plans/research-broadcast.md)) menemukan beberapa ketidakkonsistenan arsitektur antara `apps/web` dan `apps/engine`:

1. **Dua database terpisah:** Web app (`apps/web`) terhubung ke basis data Neon Postgres `custos`, sedangkan engine (`apps/engine`) terhubung ke basis data terpisah `neondb`. Meskipun keduanya menggunakan paket skema bersama `@tahansoe/db`, isolasi fisik ini menyebabkan engine tidak dapat mengakses data pengguna web (`users`, `telegram_accounts`, `policies`), dan sebaliknya web app tidak dapat membaca laporan riset, sinyal aktif, maupun hasil assessment risiko.
2. **Dua bot Telegram berkonflik:** Web app menggunakan bot resmi `cuustos_bot` dalam mode **webhook** (`/api/telegram/webhook`) untuk menautkan akun pengguna web (`/start <code>` melalui tabel `link_nonces`). Di sisi lain, engine mengonfigurasi bot Telegram terpisah dengan mode **long-polling** (`getUpdates`) dan mekanisme pairing mandiri via CLI (`tahansoe gateway pair`) yang mencatat chat yang diizinkan pada file lokal `settings.json` serta file state runtime `apps/engine/.data/gateway-state.json`.
3. **Batasan Telegram Bot API:** Telegram Bot API melarang penggunaan mode webhook dan long-polling (`getUpdates`) secara bersamaan pada token bot yang sama. Panggilan ke `getUpdates` saat webhook aktif akan memicu error konflik HTTP 409.
4. **Beban operasional & fragmentasi pengguna:** Pola dua bot dan dua database ini memaksa pengguna melakukan pairing manual yang canggung di terminal operator, menyulitkan penyampaian notifikasi ke pengguna sebenarnya, serta membebani engine dengan logika penanganan pesan masuk (router chat, parser perintah slash, manajemen lock file bot).

## Keputusan

Sesuai arahan user pada 23 Oktober 2026 ([plan riset broadcast](../plans/research-broadcast.md) §1):

1. **Database kanonik tunggal = DB web (`custos`):** Database web ditetapkan sebagai basis data kanonik untuk seluruh monorepo. Engine diarahkan ke `DATABASE_URL` yang sama. Seluruh skema riset (`research_reports`, `signals`, `risk_assessments`, `risk_settlements`, dll.) dimigrasikan ke database kanonik secara idempoten, dan data historis engine disalin sekali (`ON CONFLICT DO NOTHING`).
2. **Satu bot Telegram resmi (`cuustos_bot`):** Web app tetap memegang kendali penuh atas penerimaan pesan masuk (inbound webhook untuk alur `/start <code>`, `/start`, dan `/stop`). Engine **hanya mengirim pesan keluar (outbound-only)** melalui endpoint `sendMessage`, dan dilarang memanggil `getUpdates`, `setWebhook`, atau `deleteWebhook`.
3. **Pola broadcast: digest terjadwal dan alert segera:**
   - **Digest terjadwal:** Dikirim pada jam tetap (default `08:00,20:00` `Asia/Jakarta`, dapat diatur via env `BROADCAST_DIGEST_TIMES`) menggunakan laporan riset terbaru (`reportView`) dan ringkasan penilaian fusion (`dailySummaryView`).
   - **Alert risiko segera:** Dikirim secara proaktif ketika terjadi kenaikan regime aset (misal `CALM` → `ELEVATED`/`STRESSED`/`CRISIS`) atau kemunculan sinyal kritis deterministik (T10 Sequencer down, T4 stablecoin depeg, T7 pool utilization ≥ 98%, T8 oracle deviasi berat ≥ 0.6). Mengadopsi aturan hysteresis penurunan (bertahan minimal 1 jam sebelum turun) dan deduplikasi 6 jam.
4. **Penghapusan gateway inbound di engine:**
   - Seluruh kode gateway inbound di engine dihapus: adapter long-polling `getUpdates`, router Q&A chat Telegram, wizard CLI `tahansoe gateway pair`, allowlist di `settings.json`, bot lock file, dan file state lokal `gateway-state.json`.
   - Modul antarmuka visual (views HTML, escaping, formatter pesan) dipertahankan dan dipindahkan ke modul outbound `src/telegram/` dan `src/broadcast/`.
5. **State broadcast dan deduplikasi di database:**
   - Riwayat pengiriman, state deduplikasi (6 jam), dan metrik pengiriman disimpan terpusat di tabel database `broadcasts` dengan kolom `dedupe_key` unik.
   - Koordinasi proses worker tunggal ditegakkan menggunakan PostgreSQL session advisory lock (`42161006`).

## Alternatif yang dipertimbangkan

| Opsi | Kelebihan | Kekurangan |
|------|-----------|------------|
| **A. Pertahankan dua DB & dua bot (status quo)** | Engine berdiri sendiri secara independen tanpa ketergantungan pada infrastruktur web. | Pengguna harus menautkan akun dua kali; bot terpisah membingungkan; data riset terisolasi dari web dashboard; biaya operasional tinggi. |
| **B. Satu bot dengan proxy webhook ke engine (HTTP / Message Queue)** | Fitur tanya-jawab interaktif (Q&A LLM) di Telegram tetap dapat dipertahankan di engine. | Menambah kompleksitas arsitektur (butuh tunnel HTTP atau message broker); rawan titik kegagalan baru pada jaringan internal; beban pemeliharaan tinggi. |
| **C. Satu DB, satu bot, engine outbound-only broadcast (dipilih)** | Arsitektur sederhana, bersih, dan tangguh; tidak ada konflik webhook vs getUpdates; onboarding pengguna terpusat di web; deduplikasi transparan di Postgres. | Interaksi tanya-jawab dua arah (Q&A LLM) di Telegram ditiadakan untuk sementara; interaksi chat dibatasi pada broadcast satu arah. |

## Konsekuensi

- **Positif:**
  - Arsitektur monorepo menjadi terintegrasi dan konsisten di bawah satu basis data kanonik.
  - Alur onboarding pengguna menjadi mulus: cukup menautkan akun sekali melalui web dashboard (`telegram_accounts`).
  - Penghapusan kelas bug polling, readline raw-mode, dan konflik lock file bot di engine.
  - State deduplikasi dan riwayat pengiriman menjadi persisten dan aman dari restart engine berkat tabel `broadcasts`.
- **Negatif / biaya:**
  - Fitur tanya-jawab interaktif (Q&A LLM) via Telegram dihentikan; perintah chat masuk di engine ditiadakan (men-supersede sebagian [ADR 0011](0011-postgres-only-gateway-only-chat.md) §2–§3).
  - Pengujian respons LLM via chat Telegram ditiadakan; verifikasi dialihkan ke CLI eval set (`tahansoe eval`) dan replay riset.
- **Dampak ke invariant keamanan ([security.md](../security.md)):**
  - **I1 (Non-custodial fund transfers):** Terpenuhi. Broadcast hanya mengirimkan teks pesan informatif dan notifikasi risiko, tidak ada transfer dana atau eksekusi on-chain.
  - **I2 (No admin/custody in Guardian):** Terpenuhi. Kontrak Guardian tidak terpengaruh oleh alur notifikasi.
  - **I3 (AI advises, rules decide):** Terpenuhi. Output AI hanya berupa saran dan penjelasan konteks risiko; pengiriman alert kritis dipicu oleh aturan deterministik; tidak ada wewenang tanda tangan transaksi pada engine broadcast.
  - **I4 (Graceful degradation / Blast radius):** Terpenuhi. Jika broadcast worker mati atau koneksi Telegram terputus, Core Risk Engine, evaluasi fusion, dan sentinel keeper tetap berjalan normal. Kompromi pada bot token hanya berisiko pada pengiriman pesan, tidak pernah membahayakan dana pengguna.
  - **I5 (Oracle for execution, external content as data):** Terpenuhi. Semua konten teks dinamis (berita, analisis AI, nama aset) disanitasi secara ketat menggunakan HTML-escaping (`escapeHtml`). Sumber harga eksekusi tetap berasal dari oracle protokol lending.
  - **I6 (Fallback on failure):** Terpenuhi. Jika kuota LLM habis atau layanan AI mati, broadcast digest tetap dapat menyajikan data metrik deterministik atau dilewati dengan aman.
  - **I7 (User control):** Terpenuhi. Pengguna dapat menghentikan pengiriman broadcast kapan saja melalui perintah `/stop` pada bot Telegram atau mencabut tautan di dashboard web (`telegram_accounts.is_active = false`).
  - **I8 (No secrets in repo):** Terpenuhi. Token bot (`TELEGRAM_BOT_TOKEN`) dan kredensial database (`DATABASE_URL`) hanya dikelola melalui variabel lingkungan `.env`, tidak dicetak pada log dan tidak di-commit ke repositori.
- **Dokumen yang perlu diperbarui:**
  - [`docs/decisions/README.md`](README.md) (tambahkan ADR 0012, perbarui status ADR 0011)
  - [`docs/specs/README.md`](../specs/README.md) (tambahkan spec broadcast, tandai gateway lama)
  - [`docs/specs/m3-channel-gateway-telegram.md`](../specs/m3-channel-gateway-telegram.md) (catatan header supersede)
  - [`docs/specs/m3-research-broadcast.md`](../specs/m3-research-broadcast.md) (spesifikasi baru)
  - `docs/status.md`, `docs/architecture.md`, `README.md`, `apps/engine/README.md`

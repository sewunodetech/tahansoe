# Spec: Channel Gateway — engine sebagai agent mandiri, Telegram sebagai kanal pertama

- **Milestone:** M1 "Notifikasi Telegram dari server" + M2 "Dry-run: rekomendasi di Telegram tanpa mengubah on-chain" ([PRD §10](../prd.md#10-roadmap-eksekusi))
- **Status:** Approved (user, 2026-10-09)
- **Pemilik:** Antigravity (implementasi), Claude Code (review)
- **Terkait:** PRD §2 (Telegram-first), PRD §7 (penjelasan perubahan regime), [m3-cli §3.5](m3-cli.md) (REPL/ask), [ADR 0006](../decisions/0006-business-model-free-info-paid-automation.md), [security.md](../security.md)

## 1. Tujuan

Engine (research agent + fusion + sinyal) diposisikan sebagai **agent mandiri** yang dijalankan sekali oleh operator, lalu dipakai user **lewat kanal chat**, bukan lewat terminal.

- **CLI = host/runner.** `tahansoe start` menjalankan semuanya dalam satu proses: scheduler riset, sampler harga & bunga, fusion, settlement, alert, dan gateway kanal. CLI/REPL tetap ada untuk operator & debugging.
- **Kanal = antarmuka user.** User mengirim perintah & pertanyaan, dan menerima alert, di Telegram. Kanal berikutnya (WhatsApp, Discord) memakai antarmuka adapter yang sama.
- **dApp Tahansoe = kanal berikutnya.** Integrasi ke dApp lewat adapter yang sama (HTTP/API atau DB bersama) — keputusan detail di spec terpisah; desain gateway di sini harus tidak terikat Telegram.

Inti logika (perintah, tanya-jawab, aturan alert) ditulis sekali di `src/gateway/core/`; adapter hanya menerjemahkan pesan masuk/keluar kanal.

## 2. Scope

**Termasuk:**
- `src/gateway/`: antarmuka `ChannelAdapter` (`start`, `stop`, `send(chatId, message)`, `onMessage(handler)`) + router perintah bersama + formatter pesan (teks polos/Markdown aman).
- Adapter **Telegram** via Bot API langsung (`fetch`, long polling `getUpdates`), tanpa framework.
- Perintah chat: `/start`, `/help`, `/status`, `/fuse`, `/carry`, `/report`, `/history`, `/subscribe`, `/unsubscribe`, `/alerts` (atur jenis alert). Teks biasa → tanya-jawab (jalur `ask` yang sama dengan REPL).
- **Alert proaktif** dari fusion tick dan emitter sinyal: perubahan regime per aset, sinyal terkonfirmasi T10 (sequencer), T4 (depeg), T7 (likuiditas pool ≥ 98%), T8 berat; ringkasan harian opsional.
- **Konfigurasi gateway TIDAK di database** (keputusan user 2026-10-09, model OpenClaw): token bot di `.env`; chat yang diizinkan, langganan & preferensi alert di `settings.json` bagian `gateway`; state runtime (dedupe alert, hitungan Q&A harian) di file lokal `apps/engine/.data/gateway-state.json` (gitignored). Database hanya untuk data analisa.
- **`tahansoe start`**: satu perintah untuk menjalankan agent penuh (scheduler + sampler harga & bunga + fusion + settlement + alert + gateway). `tahansoe gateway run` tetap ada untuk menjalankan gateway saja.
- **`tahansoe setup`** diperluas: langkah Telegram (token bot tersembunyi, cek `getMe`, lalu **pairing**: wizard menampilkan kode sekali pakai, user mengirim `/start <kode>` ke bot, chat ID otomatis masuk allowlist).

**Tidak termasuk:**
- WhatsApp dan Discord (adapter berikutnya, antarmuka sudah disiapkan).
- Aksi on-chain apa pun dari chat (I2). Tidak ada `/protect`, tidak ada tanda tangan.
- Menghubungkan wallet lewat chat (sudah ditangani web app lewat link code; disatukan nanti).
- Menggantikan bot webhook yang ada di `apps/web` (lihat §3.2).

## 3. Desain

### 3.1 Alur

```
fusion tick / emitter sinyal ──► alert-detector (deterministik) ──► gateway ──► Telegram
Telegram ──► adapter (long polling) ──► router: /perintah → fungsi command yang sama dengan CLI
                                                teks biasa → ask (konteks dari DB, model chat)
```

### 3.2 Bot token dan hubungan dengan web app

`apps/web` sudah memakai webhook Telegram untuk link akun. Satu bot token tidak bisa memakai webhook dan long polling sekaligus. Maka engine memakai **bot sendiri** (`TELEGRAM_BOT_TOKEN` di `apps/engine/.env`, dibuat lewat @BotFather). Penyatuan dengan bot web (satu bot, update diteruskan dari webhook web ke engine) dicatat sebagai pekerjaan lanjutan.

### 3.3 Akses dan biaya

- **Tahap 1 (shadow mode, default):** hanya chat ID di `TELEGRAM_ALLOWED_CHAT_IDS` yang dilayani; pesan dari chat lain dijawab singkat "bot ini privat". Sesuai backlog "shadow mode sebelum notifikasi untuk user".
- **Tahap 2 (publik, nanti):** info riset & alert gratis untuk semua (ADR 0006). Tanya-jawab dibatasi per chat (mis. 20 pertanyaan/hari) dan tetap terhitung di budget harian global; perintah slash tanpa LLM tidak dibatasi selain rate limit.
- Rate limit kirim: patuhi batas Telegram (≤ 1 pesan/detik per chat, ≤ 30/detik global) dengan antrean.

### 3.4 Aturan alert (deterministik, bukan AI)

| Alert | Pemicu | Contoh pesan |
|---|---|---|
| Regime naik | Regime aset naik dibanding assessment sebelumnya (CALM→ELEVATED, dst.) | "⚠ USDC: CALM → ELEVATED. Penyebab: pool USDC.e 92% lewat kink, bunga pinjam 18%…" |
| Regime turun | Turun setelah bertahan ≥ 1 jam (hysteresis) | "✓ ETH kembali ke CALM" |
| Sequencer | Sinyal ORACLE T10 baru | "🚨 Sequencer Arbitrum DOWN — repay tidak bisa dilakukan sampai pulih" |
| Depeg | Sinyal ONCHAIN T4 baru | "🚨 USDC di AaveOracle $0,982 (−1,8%)" |
| Pool kering | Sinyal T7 (utilization ≥ 98%) | "⚠ Pool USDC.e 98,5% terpakai — penarikan bisa tertahan" |

- Dedupe: alert yang sama (dedupe key sinyal + aset) tidak dikirim ulang dalam 6 jam kecuali severity naik.
- Setiap alert menyertakan penjelasan (`explanation` dari fusion), waktu data, dan footer "informational · not investment advice". Tidak ada kata beli/jual.

### 3.5 Keamanan

- Token bot hanya di `.env` (I8), tidak pernah di-log; URL Bot API yang berisi token disamarkan di log.
- Pesan masuk adalah **data tak tepercaya**: lewat jalur `ask` yang sama (konteks dari kode, redaksi instruksi, sanitasi) — teks chat tidak pernah menjadi instruksi sistem.
- Output ke Telegram di-escape sesuai parse mode (atau teks polos) agar konten eksternal (judul berita) tidak menyuntik format/tautan.
- Allowlist chat ID (tahap 1); tidak ada perintah yang mengubah konfigurasi engine dari chat kecuali `/subscribe`, `/unsubscribe`, `/alerts`.
- Tidak ada aksi on-chain dari gateway (I1/I2).

## 4. Kriteria penerimaan

- [ ] `tahansoe gateway run` menerima perintah & pertanyaan dari chat yang diizinkan dan menolak chat lain.
- [ ] Alert regime naik, T10, T4, T7 terkirim sekali (dedupe 6 jam) dengan penjelasan; tidak terkirim untuk chat yang unsubscribe.
- [ ] `tahansoe start` menjalankan semuanya dalam satu proses; gateway mati tidak menghentikan riset/fusion (I6), dan sebaliknya bot tetap menjawab dari data terakhir bila riset gagal.
- [ ] `tahansoe setup` bisa memasang bot dan memasangkan chat ID lewat kode pairing tanpa user mencari chat ID manual.
- [ ] Token tidak muncul di log/output (test).
- [ ] Jalan di Neon dan PGlite.

## 5. Rencana test

Unit: router perintah, formatter/escape, alert-detector (naik/turun/hysteresis/dedupe), allowlist, rate limiter. Integrasi: adapter Telegram dengan `fetch` palsu (getUpdates/sendMessage). Live: satu bot uji milik user, kirim `/status` dan satu pertanyaan, picu alert dengan sinyal simulasi.

## 6. Keputusan (disetujui user 2026-10-09)

| Pertanyaan | Usulan |
|---|---|
| Bot sendiri untuk engine atau pakai bot web? | **Bot sendiri** (long polling), disatukan nanti |
| Akses awal | **Allowlist** (`TELEGRAM_ALLOWED_CHAT_IDS`), publik setelah shadow mode |
| Batas tanya-jawab saat publik | 20 pertanyaan/chat/hari + budget harian global |
| Ringkasan harian | Opsional, default mati; aktif lewat `/alerts daily on` |
| Satu perintah untuk menjalankan agent | `tahansoe start` (scheduler + sampler + fusion + settlement + alert + gateway) |
| Pairing chat ID | Kode sekali pakai (≥ 8 karakter, kedaluwarsa 10 menit, maks. 5 percobaan) lewat `/start <kode>` |

## 7. Kontrak antar-bagian (untuk pembagian kerja)

**Penyimpanan (keputusan user 2026-10-09):** database hanya berisi data analisa. Gateway tidak membuat tabel apa pun.

| Data | Lokasi |
|---|---|
| `TELEGRAM_BOT_TOKEN` (secret) | `apps/engine/.env` |
| Chat yang diizinkan, langganan, preferensi alert per chat, batas Q&A, interval poll alert, ringkasan harian | `settings.json` → `gateway: { channels: { telegram: { enabled, allowedChats: [{ id, label?, alerts: {...}, pairedAt }] } }, alertPollSec, qaPerDay, dailySummary }` (zod schema di `src/settings/schema.ts`, versi skema tetap kompatibel/migrasi) |
| Kode pairing | Memori proses gateway (hash + kedaluwarsa 10 menit); tidak disimpan |
| State runtime: alert yang sudah terkirim (dedupe 6 jam), hitungan Q&A harian per chat, offset `getUpdates` | `apps/engine/.data/gateway-state.json` (tulis atomik; hilang = aman, hanya bisa mengulang alert sekali) |

Antarmuka:
- `src/gateway/index.ts`: `startGateway(opts?: { logger?; signal?: AbortSignal }): Promise<{ stop(): Promise<void>; pairing: PairingApi }>` dan `gatewayStatus(env?, settings?): { configured: boolean; channels: string[] }`.
- `PairingApi` (dari instance gateway yang sedang jalan): `createPairingCode(channel): { code; expiresAt }`, `pairingStatus(code): { status: "pending" | "paired" | "expired"; chatId? }`. Saat pairing sukses, gateway menambahkan chat ke `settings.json` (`allowedChats`) lewat helper settings yang sama dengan CLI. `TELEGRAM_ALLOWED_CHAT_IDS` di `.env` tetap berlaku sebagai tambahan.
- Alert dideteksi gateway dengan **membaca** DB analisa (assessment & sinyal baru) tiap `alertPollSec` (default 60); tidak ada pemanggilan langsung dari fusion.
- `src/gateway/telegram/api.ts` → `telegramGetMe(token): Promise<{ ok; username? }>`.
- `src/gateway/cli.ts` → `gatewayRunCommand(argv)`.

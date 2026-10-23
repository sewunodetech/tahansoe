# Plan — Satu Database + Broadcast Riset ke Bot Telegram Web

- **Tanggal:** 23 Oktober 2026
- **Branch/worktree:** `telegram-integration`
- **Milestone:** M1 "Notifikasi Telegram dari server (bukan dari browser)" + M2 "Dry-run: tampilkan rekomendasi … di Telegram"
- **Status:** Disetujui user (keputusan di §1), dikerjakan lewat Orca orchestration (worker Antigravity)

## 0. Kondisi awal (hasil audit)

| Hal | Web (`apps/web`) | Engine (`apps/engine`) |
|-----|------------------|------------------------|
| Database | Neon `ep-green-dew…/custos` | Neon `ep-lucky-recipe…/neondb` (beda DB!) |
| Skema | `@tahansoe/db` (sama) | `@tahansoe/db` (sama) |
| Bot Telegram | `cuustos_bot`, mode **webhook** (`/api/telegram/webhook`), link akun lewat `link_nonces` → `telegram_accounts` | Bot lain, mode **long-poll** (`getUpdates`), pairing kode + allowlist di `settings.json`/`gateway-state.json` |
| Penerima | `telegram_accounts` (user yang link dari dashboard) | chat yang di-pair lewat `tahansoe gateway pair` |

Satu bot tidak bisa webhook + `getUpdates` sekaligus, dan dua DB berarti engine tidak melihat user web.

## 1. Keputusan (dari user)

1. **DB kanonik = DB web (`custos`).** Engine diarahkan ke `DATABASE_URL` yang sama. Tabel riset dibuat lewat migrasi idempoten, lalu data historis engine disalin sekali (insert-only, `ON CONFLICT DO NOTHING`).
2. **Bot = bot web (`cuustos_bot`).** Web tetap pemilik inbound (webhook `/start <code>`). Engine **hanya mengirim** (`sendMessage`), tidak pernah `getUpdates`/set webhook.
3. **Jadwal broadcast:** digest di jam tetap (default `08:00,20:00` `Asia/Jakarta`, bisa diatur env) **+** alert segera saat regime naik ke `ELEVATED`/`STRESSED`/`CRISIS` atau sinyal kritis (sequencer down T10, depeg T4, reserve kering T7, oracle T8 berat).
4. **Gateway inbound engine dihapus:** pairing, polling, router/Q&A chat, lock bot, `gateway pair`, langkah Telegram di `setup`, allowlist di settings. Views/formatter HTML dipertahankan untuk broadcaster. Butuh ADR baru (supersede sebagian ADR 0011 §2–3: "chat hanya lewat gateway").

## 2. Arsitektur target

```
apps/web  ──webhook /start <code>──► telegram_accounts (DB custos)
                                         ▲            │
apps/engine                              │ read       │
  research worker ─ onRunCompleted ─┐    │            │
  fusion / signals ─────────────────┼─► BroadcastWorker ──sendMessage──► semua telegram_accounts aktif
  digest scheduler (08:00/20:00) ───┘    │ dedupe & log: tabel `broadcasts`
  sentinel (alert per-user, sudah pakai telegram_accounts) ──► TelegramSender (outbound saja)
```

Invariant: I2 (AI advises — broadcast hanya informasi, tidak menyentuh dana), I4 (degradasi: broadcaster mati tidak mematikan riset/sentinel), I5 (konten berita/LLM di-escape HTML, tidak pernah dieksekusi), I8 (token hanya di `.env`). Footer "informational · not investment advice" wajib. Tanpa kata saran trading/prediksi harga (PRD §11).

## 3. Task

### T1 — Satukan database (worker A, wave 1)
- **Boleh edit:** `packages/db/scripts/**`, `packages/db/package.json` (script baru), `apps/engine/.env` & `apps/web/.env` lokal (gitignored), root `package.json` bila perlu script.
- **Kerja:**
  1. Buat `apps/engine/.env` di worktree ini dari `E:/web3/tahansoe/apps/engine/.env`, ganti `DATABASE_URL` → nilai dari `apps/web/.env` dan `TELEGRAM_BOT_TOKEN` → token bot web. Jangan pernah mencetak secret ke log/chat.
  2. `npm run db:migrate` ke DB web (idempoten) → semua tabel riset ada.
  3. Skrip `packages/db/scripts/copy-engine-data.ts` (`SOURCE_DATABASE_URL` → `DATABASE_URL`): salin `research_reports, signals, risk_assessments, risk_settlements, research_lessons, price_samples, rate_samples, llm_usage_daily` dengan `ON CONFLICT DO NOTHING`, urutan sesuai FK, `--dry-run` menampilkan jumlah baris per tabel sumber/target. Tabel user-level (`users, policies, positions, telegram_accounts, event_cursors, intents`) **tidak** disalin — hanya dilaporkan jumlahnya.
  4. Jalankan dry-run, lalu run sungguhan; laporkan jumlah sebelum/sesudah.
  5. Verifikasi: `npm run db:check` (atau skrip setara) dari engine & web menunjuk host yang sama.
- **Selesai bila:** hitungan baris target ≥ sumber untuk tiap tabel riset; `tahansoe doctor` hijau untuk DB.

### T2 — ADR + spec (worker B, wave 1, docs saja)
- **Boleh edit:** `docs/decisions/0012-*.md`, `docs/decisions/README.md`, `docs/specs/m3-research-broadcast.md`, `docs/specs/README.md`, catatan "superseded sebagian" di `docs/specs/m3-channel-gateway-telegram.md` (header saja).
- **Kerja:** ADR 0012 "Satu DB web+engine, engine outbound-only broadcast via bot web" (supersede sebagian ADR 0011 §2–3; jangan ubah isi ADR lama). Spec dari `_template.md`: recipients, jadwal digest, aturan alert + dedupe/hysteresis (port dari `gateway/alerts.ts`), format pesan, rate limit Telegram (≤ 25 msg/s global, 429 `retry_after`), 403 → `telegram_accounts.is_active=false`, tabel `broadcasts`, env (`BROADCAST_ENABLED`, `BROADCAST_DIGEST_TIMES`, `BROADCAST_TZ`, `BROADCAST_LANG`), advisory lock `42161006`, acceptance test list.

### T3 — Web: siklus link & berhenti langganan (worker C, wave 1)
- **Boleh edit:** `apps/web/app/api/telegram/**`, `apps/web/app/dashboard/telegram/page.tsx`, `apps/web/components/dashboard/telegram/**`.
- **Kerja:** webhook menangani `/start` tanpa kode (sambutan + arahan link dari dashboard), `/stop` (set `is_active=false`, balas konfirmasi), `/start <code>` pesan sukses menyebut ringkasan riset terjadwal + alert risiko. Copy halaman Telegram menjelaskan apa yang akan diterima (digest 2×/hari + alert risiko), tanpa janji anti-likuidasi. Tetap verifikasi `x-telegram-bot-api-secret-token`.
- **Selesai bila:** typecheck + lint web bersih; unit test handler bila ada pola test.

### T4 — Engine broadcaster (worker D, wave 2; tergantung T2)
- **Boleh edit:** `apps/engine/src/broadcast/**` (baru), `apps/engine/src/telegram/**` (baru, outbound), `apps/engine/src/cli/commands/start.ts`, `apps/engine/src/cli/tahansoe.ts`, `apps/engine/src/sentinel/**` (ganti tipe `ChannelAdapter` → `TelegramSender`), `packages/db/src/schema.ts|research.ts|migrate.ts` (tabel `broadcasts`), `apps/engine/test/broadcast/**`, `apps/engine/.env.example`.
- **Kerja:**
  1. Pindahkan bagian outbound (`gateway/telegram/api.ts` sendMessage, `gateway/telegram/queue.ts`, `gateway/views.ts`, `gateway/core/formatter.ts`) ke `src/telegram/`; `TelegramSender` interface `send(chatId, html)`.
  2. `broadcast/recipients.ts`: `telegram_accounts` aktif (distinct `telegram_user_id`).
  3. `broadcast/worker.ts` `BroadcastWorker`: (a) digest pada jam di `BROADCAST_DIGEST_TIMES`/`BROADCAST_TZ` memakai laporan riset terbaru + assessment fusion (`dailySummaryView`/`reportView`); (b) alert segera dari `onRunCompleted` research worker + poll sinyal/assessment tiap 60 s (logika regime-naik, hysteresis turun 1 jam, sinyal kritis, dedupe 6 jam dari `gateway/alerts.ts`) — state dedupe di tabel `broadcasts` (unik `dedupe_key`), bukan file JSON. Advisory lock `42161006`. 403 → nonaktifkan akun. Kegagalan per chat tidak menghentikan batch.
  4. Wire di `tahansoe start` (flag `--no-broadcast`, menggantikan gateway) + CLI `tahansoe broadcast digest|once [--dry]` (`--dry` mencetak pesan + jumlah penerima tanpa mengirim).
  5. Test offline dengan fake sender + fake DB.
- **Selesai bila:** `npm run typecheck`, `npm test -w apps/engine` hijau; `tahansoe broadcast digest --dry` jalan nyata ke DB web menampilkan jumlah penerima.

### T5 — Hapus gateway inbound (worker D lanjutan, wave 3; tergantung T4)
- **Boleh edit:** `apps/engine/src/gateway/**`, `apps/engine/src/chat/**`, `apps/engine/src/cli/commands/{gateway-pair,setup,start,doctor}.ts`, `apps/engine/src/settings/**`, `apps/engine/test/{gateway,chat,cli,settings}/**`, `apps/engine/README.md`.
- **Kerja:** hapus pairing, polling adapter, router, lock bot, state file, `gateway` subcommand, langkah Telegram pairing di `setup` (cukup cek `getMe` token), field allowlist/pairing di schema settings (migrasi baca settings lama tetap toleran), modul `chat/` bila tidak dipakai lagi. Tidak boleh ada kode engine yang memanggil `getUpdates`/`setWebhook`/`deleteWebhook`.
- **Selesai bila:** `rg "getUpdates|setWebhook|deleteWebhook|pairing" apps/engine/src` kosong; typecheck/test/lint hijau.

### T6 — Penutup (koordinator)
`alignment-reviewer` atas diff, `sync-docs` (status.md, PRD §10 checkbox M1 Telegram server-side, architecture.md data layer & kanal, README/`.env.example`), smoke test: 1 digest `--dry`, lalu 1 kirim nyata ke akun uji dengan izin user.

## 4. Urutan

```
wave 1:  T1 (DB)   T2 (ADR+spec)   T3 (web)
wave 2:  T4 (broadcaster)          ← T2 (dan T1 untuk verifikasi live)
wave 3:  T5 (hapus gateway)        ← T4
wave 4:  T6 (koordinator)
```

## 5. Backlog (di luar scope)
- Preferensi per user (bahasa, matikan digest, pilih aset) disimpan di DB dan diatur dari dashboard.
- Broadcast per posisi user (relevansi aset collateral/debt).

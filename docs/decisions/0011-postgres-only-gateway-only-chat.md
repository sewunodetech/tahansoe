# 0011 — Database server saja, chat hanya lewat channel gateway, `start` sebagai daemon

- **Status:** Accepted (arahan user, 2026-10-14)
- **Tanggal:** 2026-10-14
- **Pengusul:** Engineering (Claude Code, atas arahan user)
- **Men-supersede:** [ADR 0010](0010-local-pglite-database-option.md) (seluruhnya). Mengubah sebagian [spec m3-cli](../specs/m3-cli.md) §3.5–§3.6 (REPL & `tahansoe ask`).

## Konteks

Audit engine 14 Okt 2026 menemukan:

1. **PGlite dibuka beberapa proses sekaligus.** PGlite hanya aman untuk satu proses, sedangkan pola kerja engine multi-proses: `tahansoe start` jalan terus, lalu operator membuka CLI (`analyze`, `fuse`, REPL) di terminal lain dan semuanya membuka direktori data yang sama. Lock file ADR 0010 hanya mencegah worker kedua, bukan proses CLI lain → risiko DB korup / error acak.
2. **REPL punya kelas bug sendiri.** Prompt raw-mode `/setup` berjalan di atas readline yang hanya di-pause (risiko input secret ikut terbaca REPL), Ctrl+C di setup mematikan seluruh REPL, input yang diketik saat `/analyze` tertampung lalu dieksekusi belakangan, dan konteks chat basi.
3. **Dua pintu chat.** Q&A grounded sudah tersedia di gateway Telegram (`gateway/core/router.ts` → `executeChatQuestion`). REPL & `tahansoe ask` menduplikasi jalur yang sama dengan guardrail yang berbeda (mis. tanpa cek budget).
4. `tahansoe start` sudah menjalankan research worker, fusion, settlement, price/rate sampler, dan gateway dalam satu proses, tetapi hanya di foreground.

## Keputusan

1. **Database: Postgres server saja (Neon).** Driver PGlite, `DB_DRIVER`, `PGLITE_DATA_DIR`, dan lock file PGlite dihapus. `DATABASE_URL` wajib untuk semua perintah yang menyentuh DB. Single-instance worker kembali memakai session advisory lock Postgres saja.
2. **Chat hanya lewat channel gateway.** REPL interaktif dan `tahansoe ask` dihapus. `tahansoe` tanpa argumen menampilkan status singkat + daftar perintah. CLI tetap menjadi alat operator (`setup`, `doctor`, `analyze`, `history`, `report`, `fuse`, `settle`, `scorecard`, `carry`, `models`, `settings`, `eval`, `gateway`, `schedule`).
3. **Jalur chat gateway wajib cek budget harian** sebelum memanggil LLM (pesan Telegram adalah input eksternal; I5).
4. **`tahansoe start --detach`** menjalankan proses `start` di background (log ke `apps/engine/.data/logs/`, pid file di `apps/engine/.data/`), dilengkapi `tahansoe stop`, `tahansoe status`, `tahansoe logs [-f]`. Untuk produksi/VPS tetap disarankan supervisor proses (systemd/pm2/Docker) yang menjalankan `tahansoe start` di foreground.

## Alternatif yang dipertimbangkan

| Opsi | Kelebihan | Kekurangan |
|------|-----------|------------|
| Pertahankan PGlite + lock akses per proses | Bisa offline | Semua perintah CLI harus antre/numpang proses `start`; kompleks dan rawan |
| PGlite read-only untuk CLI | Lebih aman dari korupsi | PGlite tidak punya mode multi-proses yang andal; tetap rawan |
| **Postgres server saja** | Multi-proses aman, satu jalur kode, advisory lock asli | Butuh akun/koneksi DB; tidak bisa offline |
| Pertahankan REPL tanpa chat | Tetap ada shell interaktif | Bug readline/raw-mode tetap ada; nilai tambah kecil dibanding perintah biasa |
| **Hapus REPL & `ask`** | Satu pintu chat dengan guardrail tunggal; kelas bug REPL hilang | Uji Q&A butuh Telegram atau eval set |

## Konsekuensi

- Positif: hilangnya risiko korupsi DB multi-proses; satu aturan pemilihan DB; satu jalur chat; engine bisa jalan di background tanpa terminal terbuka.
- Negatif / biaya: engine tidak bisa dipakai offline; dev & test integrasi DB butuh Postgres (disarankan branch Neon terpisah, bukan produksi). Dependensi `@electric-sql/pglite` dihapus.
- Dampak ke invariant keamanan ([security.md](../security.md)): I1–I8 tidak berubah. I5 diperkuat (chat hanya lewat gateway yang punya pairing/allowlist, rate limit, dan kini cek budget). I8: log & pid file di `apps/engine/.data/` (gitignored), tanpa secret.
- Dokumen yang perlu diperbarui: `docs/architecture.md` (data layer), `docs/specs/m3-cli.md`, `docs/status.md`, `apps/engine/README.md`, `apps/engine/.env.example`, `README.md`.

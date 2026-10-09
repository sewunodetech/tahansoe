# 0010 — Pilihan database lokal: PGlite (embedded Postgres) di samping Neon

- **Status:** Accepted (arahan user, 2026-10-09)
- **Tanggal:** 2026-10-09
- **Pengusul:** Engineering (Claude Code, atas arahan user)
- **Terkait:** [ADR 0007](0007-monorepo-structure-and-runtime.md) (monorepo, `packages/db` sebagai satu-satunya akses DB)

## Konteks

Engine (CLI `tahansoe`, scheduler, fusion, settlement) saat ini wajib memakai Neon (Postgres cloud). Untuk pemakaian pribadi lewat CLI, ini menambah hambatan: perlu akun, `DATABASE_URL`, koneksi internet ke DB, dan gangguan jaringan (mis. WebSocket lock putus, cold start). User meminta opsi database lokal yang bisa dipilih.

SQLite dipertimbangkan, tetapi skema & query engine memakai fitur Postgres: enum, `jsonb`, `timestamptz`, `numeric`, dan **session advisory lock** (`pg_try_advisory_lock`) untuk single-instance worker. SQLite butuh dialek Drizzle berbeda dan penulisan ulang skema/query.

## Keputusan

1. `packages/db` mendukung dua driver lewat env **`DB_DRIVER`**:
   - `neon` (default bila `DATABASE_URL` diset): perilaku sekarang, untuk server, web dashboard, multi-user, produksi.
   - `pglite`: Postgres embedded (WASM, paket `@electric-sql/pglite`) dengan data di folder lokal **`PGLITE_DATA_DIR`** (default `apps/engine/.data/pglite`, gitignored). Tanpa server, tanpa akun.
2. **Satu skema, satu dialek.** Kedua driver memakai Drizzle dialek Postgres (`drizzle-orm/pglite` vs `drizzle-orm/neon-http`) dengan skema yang sama. Migrasi `npm run db:migrate` berjalan untuk keduanya (SQL idempoten yang sama).
3. **Advisory lock** untuk driver `pglite`: PGlite adalah satu proses, jadi lock lintas proses tidak tersedia. Single-instance dijamin dengan **lock file** di `PGLITE_DATA_DIR` (pid + heartbeat, stale bila > 2 menit). Kontrak `AdvisoryLockClient` tetap sama bagi pemanggil.
4. `apps/web` tetap Neon (web butuh DB bersama). Driver `pglite` khusus engine/CLI.
5. Wizard `tahansoe setup` (backlog) akan menawarkan pilihan ini; default untuk pengguna CLI pribadi: `pglite`.

## Alternatif yang dipertimbangkan

| Opsi | Kelebihan | Kekurangan |
|------|-----------|------------|
| Neon saja (sekarang) | Satu jalur | Butuh akun & internet; gangguan jaringan |
| SQLite | Sangat umum, ringan | Dialek berbeda: tulis ulang skema/query, tanpa enum/jsonb/advisory lock |
| Postgres lokal (Docker/instalasi) | Postgres penuh | Pengguna harus memasang & menjalankan server |
| **PGlite** | Postgres asli, file lokal, tanpa server, skema sama | Satu proses (lock pakai file), ukuran paket WASM ±3 MB |

## Konsekuensi

- Positif: CLI bisa dipakai tanpa akun DB; data analisa pengguna tetap di mesinnya sendiri; tidak ada gangguan jaringan ke DB.
- Negatif: dependensi baru `@electric-sql/pglite`; dua jalur driver harus dites (test memakai PGlite in-memory, sekaligus mempercepat test integrasi).
- Invariant: I1–I8 tidak berubah. Folder data lokal di-gitignore (I8).
- Dokumen yang perlu diperbarui: `docs/architecture.md` (data layer), `apps/engine/README.md`, `.env.example`, `docs/status.md`.

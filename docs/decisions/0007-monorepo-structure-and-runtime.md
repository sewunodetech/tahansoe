# 0007 — Struktur monorepo (npm workspaces), Next.js + worker terpisah, tanpa indexer dulu

- **Status:** Accepted (disetujui tim, 2026-10-08)
- **Tanggal:** 2026-10-08
- **Pengusul:** Engineering (Claude Code, atas arahan tim)

## Konteks

Repo tumbuh menjadi tiga proyek dalam satu root: web app Next.js (tersebar di root: `app/`, `components/`, `hooks/`, `lib/`, `public/`, `scripts/`, config), kontrak Foundry (`contracts/`), dan Core Risk Engine (`engine/`, dengan `package.json` dan `node_modules` sendiri). Akibatnya:

1. Skema DB terduplikasi: `engine/src/db/schema.ts` meniru `lib/schema.ts`, karena engine dilarang meng-import dari web (architecture §2).
2. Tipe domain (`Signal`, `RiskAssessment`, `Intent`, `Position`), chain registry, dan rumus HF akan ditulis dua kali.
3. `lib/` mencampur kode server (`db`, `session`, `schema`), client (`wagmi`), dan simulasi/mock.
4. Tidak ada `.gitattributes` (peringatan LF/CRLF di setiap commit dari Windows) dan tidak ada CI.

Ada dua pertanyaan arsitektur yang muncul bersamaan:
- Apakah Next.js full-stack cukup?
- Apakah perlu indexer on-chain?

## Keputusan

### 1. Struktur target

```
apps/
  web/            Next.js: app/, components/, hooks/, public/, lib/ (khusus web), features/demo/
  engine/         Core Risk Engine + keeper (worker Node yang selalu hidup)
packages/
  db/             SATU skema Drizzle, koneksi, migrasi, drizzle.config — dipakai web & engine
  domain/         Tipe kanonik PRD §6.3/§7, chain registry, rumus HF/drop tolerance (murni, tanpa I/O)
contracts/        Foundry (tidak berubah)
docs/
package.json      npm workspaces: ["apps/*", "packages/*"]
```

Aturan batas:
- `apps/web` dan `apps/engine` **tidak saling import**. Kode bersama hanya lewat `packages/*`.
- `packages/domain` tanpa I/O (tanpa DB, network, SDK), sehingga bisa dipakai di client, server, engine, dan backtest.
- `packages/db` hanya dipakai di kode server (route handler, engine, script), tidak pernah di komponen client.
- Kunci keeper hanya ada di `apps/engine` (security I8, architecture §2).

### 2. Runtime

- **Next.js** (`apps/web`, di Vercel): UI, SIWE/session, webhook Telegram, API baca yang tipis (membaca Postgres), dan transaksi yang ditandatangani user di browser.
- **Worker Node terpisah** (`apps/engine`, host yang selalu hidup, **bukan** Vercel): polling oracle/posisi, fusion, rule engine, keeper, research agents, reflection, notifikasi Telegram dari server, event sync.
- **Postgres** adalah satu-satunya penghubung antara web dan engine.
- Update dashboard memakai polling atau SSE dari route handler, tanpa WebSocket.

### 3. Data on-chain tanpa indexer khusus (untuk sekarang)

- State terkini dibaca lewat RPC + multicall (viem).
- Event yang dibutuhkan (`PolicySet` / `PolicyDisabled` / `Protected` Guardian, `LiquidationCall` Aave di Arbitrum) disinkronkan oleh modul **event sync ringan** di engine: cursor block per kontrak, simpan ke Postgres, dan event baru dianggap final setelah N konfirmasi.
- Time series (harga, volatilitas, utilization) disimpan oleh engine dari sampel yang ia ambil sendiri.
- Indexer khusus (subgraph, Ponder, Envio, dsb.) baru dievaluasi lewat ADR baru jika: multi-chain, ribuan user dipantau, butuh scan borrower seluruh pasar, atau reorg/backfill mulai merepotkan.

### 4. Migrasi bertahap

| Fase | Isi | Syarat mulai |
|------|-----|--------------|
| 0 | `.gitattributes`, CI, hapus aset template yang tidak dipakai, `packages/domain` sebagai folder baru | Tidak menyentuh file yang sedang dikerjakan agent lain |
| 1 | Root npm workspaces, `packages/db` (pindahkan `lib/schema.ts`, `lib/db.ts`, `drizzle.config.ts`, `scripts/*`), pindahkan web ke `apps/web` | Fase 0 di-commit; engine sedang tidak diedit |
| 2 | `engine/` → `apps/engine`, memakai `@tahansoe/db` dan `@tahansoe/domain`; hapus skema/tipe duplikat | Fase 1 di-commit dan `npm run build` web hijau |
| 3 | Simulasi & mock data → `apps/web/features/demo/` ("demo mode") | Bersama M1 (dashboard membaca posisi asli) |

Setiap fase di-commit terpisah. Pemindahan file memakai `git mv` agar riwayat tetap terlacak.

## Alternatif yang dipertimbangkan

| Opsi | Kelebihan | Kekurangan |
|------|-----------|------------|
| Biarkan seperti sekarang | Tanpa kerja migrasi | Skema dan tipe ganda; root makin berantakan |
| Web tetap di root, hanya tambah `packages/*` | Tidak perlu mengubah Vercel | Root tetap campur aduk; batas web vs engine kabur |
| Turborepo / pnpm / Nx | Cache build, tooling kaya | Dependensi & konsep baru; belum dibutuhkan pada skala ini |
| **npm workspaces + apps/ + packages/** | Tooling yang sudah dipakai (npm); batas jelas; satu skema | Butuh perubahan Root Directory di Vercel; import path web berubah |

## Konsekuensi

- Positif: satu skema DB, satu set tipe domain; root berisi navigasi yang jelas; CI bisa menjalankan lint, test engine, dan `forge test` per area.
- Negatif / biaya: perubahan Root Directory proyek Vercel ke `apps/web` (dilakukan pemilik akun Vercel saat fase 1 di-merge); semua alias import `@/` di web harus tetap berfungsi dari `apps/web`; engine butuh host terpisah.
- Dampak ke invariant keamanan: tidak ada perubahan pada I1–I8. Batas "kunci keeper hanya di engine" dan "`packages/db` tidak masuk bundle client" ditegaskan.
- Dokumen yang perlu diperbarui: architecture §1, §2, §7, §8; AGENTS.md §4 & §6 (perintah); README; status.md; PRD §6.1 (sumber on-chain: tanpa indexer dulu).

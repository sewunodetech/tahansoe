# Tahansoe

**AI risk agent non-custodial untuk melindungi posisi borrow di protokol lending on-chain (Aave V3, lalu Morpho) dari likuidasi. Arbitrum-first, siap cross-chain.**

Tahansoe memantau **Health Factor (HF)** posisi pinjaman kamu secara terus-menerus. Core Risk Engine membaca oracle, data teknikal, fundamental/on-chain, kalender makro, serta berita dan geopolitik untuk menebalkan buffer proteksi **sebelum** pasar bergerak. Saat HF melewati trigger, Tahansoe menjalankan remediasi — *repay*, *top-up collateral*, atau *deleverage* — sebelum posisi mencapai ambang likuidasi.

> ⚠️ Tahansoe adalah **risk automation**, bukan jaminan anti-likuidasi. Lihat [Risk Disclosure](#risk-disclosure).

---

## Kenapa ini ada

Kalau kamu pinjam stablecoin dengan jaminan aset volatil (ETH, WBTC, LST), ada tiga masalah klasik:

1. **Pasar tidak tidur, kamu tidur.** Monitoring 24/7 tidak realistis.
2. **Reaksi manual selalu telat.** Saat kamu sadar HF turun, bot liquidator sudah lebih dulu.
3. **Likuidasi itu mahal.** Penalti likuidasi Aave V3 sekitar 5–10% dari posisi yang dilikuidasi.

Tahansoe mengotomasi langkah pencegahannya, dan bersifat **non-custodial** — dana tidak pernah berpindah ke kustodi Tahansoe.

---

## Cara kerja singkat

```
HF = (nilai collateral × liquidationThreshold) / total utang

HF < 1.0  →  posisi bisa dilikuidasi
```

Tahansoe bertindak saat `HF < triggerHF` (default **1.30**) dan memulihkan posisi ke `targetHF` (default **1.60**).

Alurnya lima lapis:

| Layer | Isi | Fungsi |
|-------|-----|--------|
| 1. Data & signals | Chainlink feeds, posisi Aave/Morpho, data pasar, berita, makro | Bahan mentah (oracle eksekusi **harus** sama dengan yang dipakai protokol target) |
| 2. Core Risk Engine (AI) | Oracle monitor, teknikal, fundamental/on-chain, makro, berita & sentimen | Menilai regime pasar dan merekomendasikan buffer/trigger beserta alasannya |
| 3. Policy | Rule engine deterministik | Ubah posisi + policy user + risk assessment jadi **Intent** (REPAY / SUPPLY_COLLATERAL / DELEVERAGE / NOOP) |
| 4. Trigger | Keeper: `checkUpkeep()` / `performUpkeep()` | Dev: cron + viem · Prod: Chainlink Automation |
| 5. Execution | `TahansoeGuardian` (tanpa admin, per chain) | Panggil `repay()` (v1) · `supply()` / flash loan (v2) |

Dua prinsip penting:

- **AI advises, rules decide, contract enforces.** AI tidak pernah menandatangani transaksi yang memindahkan dana; pengaruhnya hanya menggeser trigger di dalam band yang disetujui user. Jika AI mati, proteksi kembali ke policy statis.
- **Intent ≠ transaksi.** Rule engine mengeluarkan Intent terstruktur, sehingga bisa di-*dry run*, disimulasi, dan diaudit sebelum dieksekusi.

Detail lengkap ada di [docs/prd.md](docs/prd.md). Semua dokumentasi (PRD, BRD, arsitektur, security, ADR) ada di [docs/](docs/README.md). Agent/kontributor: mulai dari [AGENTS.md](AGENTS.md).

---

## Status saat ini

Repo ini berisi **aplikasi web Tahansoe** (Next.js) dan **kontrak Guardian** (Foundry). Status detail ada di [docs/status.md](docs/status.md). Yang sudah jalan:

- ✅ Landing page + dashboard (positions, history, bot, chat, settings)
- ✅ Login wallet via **SIWE** (Sign-In With Ethereum) + session cookie
- ✅ **Simulation engine** — mensimulasikan drift harga ETH, penurunan HF, dan pemilihan strategi remediasi secara live di dashboard
- ✅ Notifikasi & linking akun **Telegram** (webhook + link code)
- ✅ Skema database (users, positions, intents, notifications, dll.) via Drizzle
- ✅ Kontrak **TahansoeGuardian v1** (hot reserve repay) — live di Arbitrum Sepolia, lihat [contracts/README.md](contracts/README.md)

Yang **belum**:

- ⏳ Integrasi web app ↔ kontrak (approve + setPolicy, baca posisi asli)
- ⏳ Keeper & notifikasi dari server
- ⏳ Core Risk Engine (AI: oracle, teknikal, fundamental, makro, berita/geopolitik) — branch `core-dev`
- ⏳ Guardian v2 (dynamic trigger band, flash loan), Morpho Blue, chain tambahan

Artinya: angka dan posisi di dashboard saat ini berasal dari **simulasi**, bukan posisi on-chain nyata.

---

## Tech stack

| Bagian | Teknologi |
|--------|-----------|
| Framework | Next.js 16 (App Router), React 19, TypeScript |
| Styling | Tailwind CSS v4, shadcn/base-ui, Motion |
| Web3 | wagmi + viem, SIWE |
| Database | Neon Postgres + Drizzle ORM |
| Session | iron-session |
| Chart | Recharts |
| Notifikasi | Telegram Bot API |

---

## Menjalankan secara lokal

### 1. Prasyarat

- Node.js 20+
- Database Postgres (disarankan [Neon](https://neon.tech))
- (Opsional) Telegram bot token dari [@BotFather](https://t.me/BotFather) kalau mau tes notifikasi

### 2. Install

```bash
npm install
```

### 3. Environment

Buat file `apps/web/.env` (dipakai web app **dan** script database):

```bash
DATABASE_URL=postgresql://user:password@host/dbname
SESSION_SECRET=            # string acak minimal 32 karakter
NEXT_PUBLIC_APP_DOMAIN=localhost:3000

# Opsional — hanya untuk fitur Telegram
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=

# Opsional — untuk WalletConnect
NEXT_PUBLIC_WC_PROJECT_ID=
```

Generate `SESSION_SECRET`:

```bash
openssl rand -base64 32
```

### 4. Siapkan database

```bash
npm run db:migrate
```

Script database ada di `packages/db/scripts/` dan dijalankan dari root:

| Perintah | Kegunaan |
|----------|----------|
| `npm run db:migrate` | Buat enum + tabel (idempotent, aman diulang) |
| `npm run db:check` | Cek koneksi & isi tabel |
| `npm run db:reset` | **Hapus** semua tabel lalu buat ulang |
| `npm run db:fix-telegram` | Perbaiki data linking Telegram |

### 5. Jalankan

```bash
npm run dev
```

Buka [http://localhost:3000](http://localhost:3000), lalu connect wallet untuk masuk ke dashboard.

---

## Perintah

| Perintah | Fungsi |
|----------|--------|
Semua perintah dijalankan dari root repo (npm workspaces).

| Perintah | Fungsi |
|----------|--------|
| `npm run dev` | Development server web (`apps/web`) |
| `npm run build` | Build production web |
| `npm run start` | Jalankan hasil build |
| `npm run lint` | ESLint web |
| `npm run typecheck` | TypeScript untuk semua workspace |
| `npm test` | Test semua workspace |
| `npm run db:*` | Script database (lihat di atas) |

Kontrak (`contracts/`) memakai Foundry — lihat `contracts/README.md`. Engine (`apps/engine`) ikut `typecheck`/`test` root; script run-nya ada di `apps/engine/README.md`.

---

## Struktur folder

Monorepo npm workspaces — lihat [ADR 0007](docs/decisions/0007-monorepo-structure-and-runtime.md).

```
apps/
  web/                Next.js (landing, dashboard, API routes)
    app/              halaman & route handler (auth SIWE, telegram, alerts)
    components/       landing/, ui/, providers/
    hooks/            useAuth, useAuthGuard, useTelegramLink
    lib/              session, wagmi-config, utils, simulasi HF (demo)
  engine/             Core Risk Engine (worker Node): research agents & reflection
packages/
  db/                 SATU skema Drizzle + koneksi Neon + script database
  domain/             tipe kanonik (Signal, RiskAssessment, Intent, ...), chain registry, rumus HF
contracts/            Foundry: TahansoeGuardian, test, deploy
docs/                 PRD, BRD, architecture, security, status, ADR, specs, knowledge
AGENTS.md             panduan & workflow untuk agent/kontributor
DESIGN.md             design system (token, tipografi, komponen)
```

---

## Risk Disclosure

Tahansoe **tidak** menjamin posisi kamu bebas dari likuidasi. Tahansoe mengurangi probabilitas likuidasi dengan bertindak lebih awal, tetapi tetap ada kondisi di luar kendali:

- Crash harga yang sangat cepat (gap turun dalam satu blok)
- Kongesti jaringan / gas spike yang membuat transaksi remediasi telat masuk
- Keterlambatan update oracle (deviation threshold & heartbeat)
- Kegagalan atau kekurangan likuiditas pada sumber dana remediasi

Gunakan dengan pemahaman risiko penuh.

---

## Lisensi

Private / belum ditentukan.

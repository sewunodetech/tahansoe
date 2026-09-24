# Tahansoe

**Liquidation risk automation agent untuk posisi borrow di protokol lending on-chain (Aave V3, Morpho).**

Tahansoe memantau **Health Factor (HF)** posisi pinjaman kamu secara terus-menerus, dan menjalankan aksi remediasi — *repay*, *top-up collateral*, atau *deleverage* — **sebelum** posisi mencapai ambang likuidasi.

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

Alurnya empat lapis:

| Layer | Isi | Fungsi |
|-------|-----|--------|
| 1. Data | Chainlink Data Feeds + protocol adapter | Baca harga & posisi (oracle **harus** sama dengan yang dipakai protokol target) |
| 2. Policy | Rule engine deterministik | Ubah kondisi posisi jadi objek **Intent** (REPAY / SUPPLY_COLLATERAL / DELEVERAGE / NOOP) |
| 3. Trigger | `checkUpkeep()` / `performUpkeep()` | Dev: cron + viem · Prod: Chainlink Automation |
| 4. Execution | Guardian Module (Safe Module, scope terbatas) | Panggil `repay()` / `supply()` / `flashLoan()` |

Dua prinsip penting:

- **LLM authoring, deterministic execution.** LLM hanya menerjemahkan niat user jadi parameter policy — dan wajib dikonfirmasi user. LLM tidak pernah memicu atau menandatangani transaksi.
- **Intent ≠ transaksi.** Rule engine mengeluarkan Intent terstruktur, sehingga bisa di-*dry run*, disimulasi, dan diaudit sebelum dieksekusi.

Detail lengkap ada di [prd.md](prd.md).

---

## Status saat ini

Repo ini berisi **aplikasi web Tahansoe** (Next.js). Yang sudah jalan:

- ✅ Landing page + dashboard (positions, history, bot, chat, settings)
- ✅ Login wallet via **SIWE** (Sign-In With Ethereum) + session cookie
- ✅ **Simulation engine** — mensimulasikan drift harga ETH, penurunan HF, dan pemilihan strategi remediasi secara live di dashboard
- ✅ Notifikasi & linking akun **Telegram** (webhook + link code)
- ✅ Skema database (users, positions, intents, notifications, dll.) via Drizzle

Yang **belum**:

- ⏳ Smart contract Guardian Module
- ⏳ Protocol adapter on-chain sungguhan (Aave V3 / Morpho Blue)
- ⏳ Eksekusi transaksi live & Chainlink Automation

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

Buat file `.env` di root:

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
npx tsx scripts/migrate.ts
```

Script bantuan lain di folder `scripts/`:

| Script | Kegunaan |
|--------|----------|
| `migrate.ts` | Buat enum + tabel (idempotent, aman diulang) |
| `check-db.ts` | Cek koneksi & isi tabel |
| `reset-db.ts` | **Hapus** semua tabel lalu buat ulang |
| `fix-telegram.ts` | Perbaiki data linking Telegram |

### 5. Jalankan

```bash
npm run dev
```

Buka [http://localhost:3000](http://localhost:3000), lalu connect wallet untuk masuk ke dashboard.

---

## Perintah

| Perintah | Fungsi |
|----------|--------|
| `npm run dev` | Development server |
| `npm run build` | Build production |
| `npm run start` | Jalankan hasil build |
| `npm run lint` | ESLint |

---

## Struktur folder

```
app/
  page.tsx            landing page
  connect/            halaman connect wallet
  dashboard/          positions, history, bot, chat, settings
  api/
    auth/             SIWE: nonce → verify → me
    telegram/         link-code, status, unlink, webhook
    alerts/notify     kirim notifikasi
components/
  landing/            section-section landing page
  ui/                 komponen UI reusable
  providers/          Web3Provider, ThemeProvider
lib/
  schema.ts           skema database (Drizzle)
  db.ts               koneksi Neon
  session.ts          iron-session
  wagmi-config.ts     konfigurasi chain & connector
  simulation-*.tsx    engine + context simulasi HF
  mock-data.ts        data contoh posisi
scripts/              utilitas database
prd.md                Product Requirements Document
DESIGN.md             design token & referensi visual
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

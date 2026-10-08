# Tahansoe — Architecture

**Last updated:** 8 Oktober 2026
**Dokumen terkait:** [PRD](prd.md) · [Security](security.md) · [ADR](decisions/)

Dokumen ini menjelaskan *bagaimana* sistem dibangun. Bagian bertanda **(rencana)** belum ada di kode; detail finalnya dikunci di spec masing-masing di `docs/specs/`.

---

## 1. Gambaran sistem

```
                    ┌──────────────────────────────┐
  News / Social ───▶│                              │
  Macro calendar ──▶│   CORE RISK ENGINE (engine/) │──▶ risk_assessments ─┐
  CEX / DEX / Pyth ▶│   signals → fusion → policy  │──▶ intents           │
  RPC (per chain) ─▶│   keeper loop                │                      │
                    └───────┬──────────────┬───────┘                      │
                            │ protect()    │ setDynamicTrigger() (v2)     │
                            ▼              ▼                              ▼
                    ┌──────────────────────────────┐        ┌──────────────────────┐
                    │ TahansoeGuardian (per chain) │        │ Postgres (Neon)      │
                    │ contracts/                   │        └─────────┬────────────┘
                    └───────┬──────────────────────┘                  │
                            ▼                                         ▼
                    Aave V3 / Morpho Blue              ┌──────────────────────────┐
                                                       │ Web app (app/) + Telegram │
                                                       └──────────────────────────┘
```

| Komponen | Lokasi | Status |
|----------|--------|--------|
| Web app (landing, dashboard, API) | `app/`, `components/`, `hooks/`, `lib/` | Ada; dashboard masih memakai simulasi |
| Auth (SIWE + iron-session) | `app/api/auth/`, `lib/session.ts` | Ada |
| Telegram (link, webhook, alert) | `app/api/telegram/`, `app/api/alerts/` | Ada; alert dipicu dari browser |
| Database | `packages/db/src/schema.ts`, `packages/db/scripts/migrate.ts` | Ada; sebagian tabel belum dipakai |
| Guardian v1 | `contracts/src/TahansoeGuardian.sol` | Live di Arbitrum Sepolia |
| Core Risk Engine | `apps/engine/` (workspace `@tahansoe/engine`, ADR 0007) | Research layer (boilerplate) sedang dibangun; modul M2 **(rencana)** |
| Keeper | `engine/src/keeper/` | **(rencana)** |
| Paket bersama | `packages/domain/` (tipe, chain registry, rumus HF), `packages/db/` (skema Drizzle tunggal + script DB) | Ada — ADR 0007 |

---

## 2. Struktur repo

> **Struktur repo ([ADR 0007](decisions/0007-monorepo-structure-and-runtime.md)):** npm workspaces. Sudah jalan: `apps/web` (Next.js), `packages/db` (skema & koneksi tunggal), `packages/domain` (tipe, chain registry, rumus HF). `apps/engine` (Core Risk Engine). Pohon di bawah menunjukkan isi engine (`apps/engine/`). Path `app/`, `components/`, `hooks/`, `lib/` di dokumen ini relatif terhadap `apps/web/`; `lib/schema.ts` kini `packages/db/src/schema.ts`.

```
app/                    Next.js App Router (UI + API routes)
components/             UI (landing/, ui/, providers/)
hooks/                  React hooks (auth, telegram)
lib/                    Shared: db, schema, session, wagmi, simulasi
contracts/              Foundry: src/, test/, script/, broadcast/
engine/                 (rencana) Core Risk Engine — service Node.js terpisah
  src/
    chains/             Chain registry: RPC, alamat Aave/Guardian, feeds, sequencer
    adapters/           ProtocolAdapter: aave-v3/, morpho-blue/
    signals/
      oracle/           Staleness, deviasi, sequencer uptime
      technical/        Volatilitas, funding, OI, orderbook
      onchain/          Utilization, exchange flow, depeg, LST ratio
      macro/            Kalender ekonomi
      news/             Ingestion + klasifikasi LLM
      social/           Sentimen sosial
    llm/                Interface provider-agnostic + schema output + budget harian
    agents/             Research agents: analyst → debat Hawk/Dove → assessor (ADR 0004)
    reflection/         Settlement, reflection, scorecard (ADR 0005)
    fusion/             Signals → RiskAssessment (regime, drawdown, trigger)
    policy/             Rule engine deterministik → Intent
    keeper/             Loop needsProtection → protect; (v2) setDynamicTrigger
    notify/             Telegram dari server
    backtest/           Replay skenario historis
    index.ts            Entry point / scheduler
  test/
scripts/                Utilitas DB
docs/                   Dokumentasi (lihat docs/README.md)
```

**Aturan batas modul**

- `engine/` tidak meng-import dari `app/` atau `components/`. Kode bersama (schema DB, tipe domain, chain registry) berada di `lib/` atau dipindah ke modul bersama bila tumbuh besar (butuh ADR).
- `app/` tidak menjalankan loop monitoring. Web app hanya membaca hasil engine dari DB dan mengirim transaksi yang ditandatangani user (approve, setPolicy).
- Hanya `engine/src/keeper/` yang memegang kunci keeper. Kunci itu hanya boleh memanggil fungsi publik Guardian (`protect`, dan di v2 `setDynamicTrigger` sebagai risk agent).

---

## 3. Alur utama

### 3.1 Onboarding & policy (Guardian v1)

```
User connect wallet → SIWE login
  → Settings: pilih debt asset, trigger, target, cap
  → tx 1: ERC20.approve(Guardian, allowance)          (ditandatangani user)
  → tx 2: Guardian.setPolicy(asset, trigger, target, cap)  (ditandatangani user)
  → DB: policies (mirror untuk tampilan & engine)
```

Sumber kebenaran policy adalah **kontrak**. Tabel `policies` hanya cache/mirror dan harus bisa direkonstruksi dari event `PolicySet` / `PolicyDisabled`.

### 3.2 Monitoring & proteksi

```
Setiap block / interval pendek (per chain):
  AaveAdapter.readPosition(user) untuk user ber-policy aktif
  → rule engine: effectiveTrigger = dynamic (jika valid) atau statis
  → jika HF < trigger: Intent(REPAY, HOT_RESERVE, ...)
  → keeper: simulasi (eth_call) → Guardian.protect(user)
  → intents: status SIMULATED → EXECUTED / FAILED + txHash
  → notify: Telegram (EXECUTION_SUCCESS / EXECUTION_FAILED)
```

### 3.3 Risk intelligence

```
Signal collectors (interval berbeda per modul)
  → tabel signals (dengan expiresAt)
  → fusion per aset per chain → risk_assessments (validUntil)
  → jika regime berubah: notify user dengan explanation
  → v1: dry-run saja (rekomendasi trigger ditampilkan)
  → v2: keeper sebagai risk agent memanggil setDynamicTrigger (di-clamp band user)
```

Interval awal (dapat dikalibrasi):

| Modul | Interval |
|-------|----------|
| Oracle monitor, posisi, keeper | Setiap block / ≤ 15 detik |
| Technical | 1 menit |
| News | 1–5 menit |
| Social | 5 menit |
| Macro calendar | Harian + pengingat menjelang event |
| Fusion | Saat ada sinyal baru, minimal tiap 5 menit |
| Research agents | Tiap 2 jam (CALM), tiap 1 jam (≥ ELEVATED), + saat regime naik (cooldown 30 menit) |
| Settlement | Tiap jam; reflection harian (batch) |

Research agents membaca dari DB dan menulis satu `Signal` (`module: "RESEARCH"`) per run. Sinyal itu masuk fusion seperti sinyal lain. Detail: [spec m3-research-agents](specs/m3-research-agents.md).

---

## 4. Chain registry (rencana)

Semua hal spesifik chain berada di satu registry yang diketik:

```ts
interface ChainConfig {
  chainId: number;
  name: string;
  rpcUrls: string[];                  // dari env, bukan hardcode di kode
  blockTimeMs: number;
  aave?: { poolAddressesProvider: Address; oracle: Address };
  morpho?: { morpho: Address };
  guardian?: Address;
  sequencerUptimeFeed?: Address;      // wajib untuk L2
  priceFeeds: Record<string, Address>;
  explorer: string;
}
```

Alamat Aave diambil dari `bgd-labs/aave-address-book`. Menambah chain = menambah entry registry + deploy Guardian, tanpa mengubah logika engine (lihat [ADR 0001](decisions/0001-arbitrum-first-chain-agnostic.md)).

Chain aktif saat ini: **Arbitrum Sepolia (421614)**. Berikutnya: Arbitrum One (42161).

Alamat Arbitrum One yang sudah diverifikasi on-chain (8 Okt 2026), beserta dua temuan yang memengaruhi desain (harga USDC ber-cap di AaveOracle; tanpa PriceOracleSentinel): [knowledge/risk-transmission.md §4](knowledge/risk-transmission.md#4-catatan-khusus-arbitrum-one).

---

## 5. Data model

Skema saat ini di `packages/db/src/schema.ts` (satu-satunya sumber, ADR 0007).

| Tabel | Fungsi | Status |
|-------|--------|--------|
| `users` | User per wallet | Ada — saat ini unik per `(wallet, chainId)`; **perlu diubah** menjadi unik per wallet |
| `siwe_nonces`, `link_nonces` | Nonce SIWE & kode link Telegram | Ada, dipakai |
| `telegram_accounts` | Akun Telegram terhubung | Ada, dipakai |
| `positions` | Snapshot posisi | Ada, belum dipakai |
| `policies` | Mirror policy on-chain | Ada, belum dipakai |
| `intents` | Audit trail keputusan & eksekusi | Ada, belum dipakai |
| `notification_logs` | Log notifikasi | Ada, belum dipakai |
| `guardian_modules` | Asumsi Safe Module | Ada, **tidak relevan** dengan Guardian v1 (lihat [ADR 0003](decisions/0003-guardian-v1-eoa-approve.md)) |
| `signals` | Sinyal dari semua modul | **(rencana)** |
| `risk_assessments` | Output fusion | **(rencana)** |
| `market_events` | Event berita/geopolitik yang sudah dideduplikasi | **(rencana)** |
| `research_reports` | Output research agents (report, laporan analyst, debat, versi prompt/model, usage) | **(rencana)** — ADR 0004 |
| `risk_settlements` | Label TP/FP/MISSED/TN + lead time + outcome mentah | **(rencana)** — ADR 0005 |
| `research_lessons` | Pelajaran hasil reflection (≤ 600 karakter, bisa dinonaktifkan) | **(rencana)** — ADR 0005 |

Kolom `chainId` wajib ada di setiap tabel yang menyimpan data on-chain (positions, policies, intents).

---

## 6. Interface domain

Interface kanonik (`Position`, `ProtocolAdapter`, `Intent`, `Signal`, `RiskAssessment`) didefinisikan di [PRD §6.3 dan §7](prd.md). Implementasi TypeScript harus mengikuti nama dan semantik tersebut; perubahan interface diperbarui di PRD terlebih dahulu.

Konvensi angka:

- Nilai on-chain (HF, jumlah token) disimpan sebagai `bigint` dengan skala aslinya (HF = 1e18, token = desimal token).
- Nilai turunan analitik (volatilitas, skor) boleh `number`.
- Jangan mencampur USD dari oracle protokol dengan USD dari sumber lain dalam perhitungan HF.

---

## 7. Teknologi

| Area | Pilihan |
|------|---------|
| Web | Next.js 16 (App Router), React 19, Tailwind v4, wagmi + viem |
| Engine | Node.js + TypeScript, viem, dijalankan sebagai long-running worker di host yang selalu hidup (bukan Vercel) **(rencana)** |
| Data on-chain | RPC + multicall untuk state; event sync ringan (cursor block + konfirmasi) untuk event Guardian & `LiquidationCall` Aave; **tanpa indexer khusus** sampai ada ADR baru (ADR 0007) |
| Monorepo | npm workspaces (ADR 0007) — fase migrasi lihat status.md |
| CI | GitHub Actions: typecheck + test + build semua workspace, lint web (blocking), `forge test` tanpa fork (`.github/workflows/ci.yml`) |
| DB | Neon Postgres + Drizzle |
| Kontrak | Foundry, Solidity 0.8.26, OpenZeppelin v5 |
| LLM | Provider-agnostic interface; output divalidasi schema. Implementasi pertama: Anthropic (`@anthropic-ai/sdk` + zod) — [ADR 0004](decisions/0004-multi-agent-research-layer.md) **(rencana)** |
| Notifikasi | Telegram Bot API |
| Automation (prod) | Chainlink Automation + cron cadangan |

---

## 8. Environment

| Variabel | Dipakai oleh |
|----------|--------------|
| `DATABASE_URL` | app, engine, scripts |
| `SESSION_SECRET`, `NEXT_PUBLIC_APP_DOMAIN` | app |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` | app, engine |
| `NEXT_PUBLIC_WC_PROJECT_ID` | app |
| `ARB_SEPOLIA_RPC_URL`, `ARBISCAN_API_KEY` | contracts, engine |
| `KEEPER_PRIVATE_KEY` atau signer eksternal | engine/keeper **(rencana)** — hanya di environment server |
| API key data/LLM | engine **(rencana)** |
| `ANTHROPIC_API_KEY` | engine — research agents & klasifikasi berita **(rencana)** |
| `LLM_DAILY_BUDGET_USD` | engine — batas biaya LLM harian; jika terlampaui, jalur LLM berhenti, modul lain tetap jalan **(rencana)** |
| `RESEARCH_ENABLED` | engine — kill switch research agents (default `false`) **(rencana)** |
| `FRED_API_KEY` | engine — data makro FRED untuk research agents (key gratis) |
| `ARBITRUM_RPC_URL` | engine — RPC Arbitrum One berbayar untuk polling on-chain **(rencana)** |

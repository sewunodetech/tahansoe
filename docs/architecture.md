# Tahansoe — Architecture

**Last updated:** 9 Oktober 2026
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
                    ┌──────────────────────────────┐        ┌──────────────────────────────┐
                    │ TahansoeGuardian (per chain) │        │ Postgres (Neon / PGlite)     │
                    │ contracts/                   │        │ ADR 0010                     │
                    └───────┬──────────────────────┘        └─────────┬────────────────────┘
                            ▼                                         │
                    Aave V3 / Morpho Blue              ┌──────────────┴───────────┐
                                                       │ Web app (app/) + Telegram │
                                                       └──────────────────────────┘
```

| Komponen | Lokasi | Status |
|----------|--------|--------|
| Web app (landing, dashboard, API) | `app/`, `components/`, `hooks/`, `lib/` | Ada; dashboard masih memakai simulasi |
| Auth (SIWE + iron-session) | `app/api/auth/`, `lib/session.ts` | Ada |
| Telegram (link, webhook, alert) | `app/api/telegram/`, `app/api/alerts/` | Ada; alert dipicu dari browser |
| Database | `packages/db/src/schema.ts`, `packages/db/scripts/migrate.ts` | Ada; dual driver (Neon cloud & PGlite lokal, [ADR 0010](decisions/0010-local-pglite-database-option.md)) |
| Guardian v1 | `contracts/src/TahansoeGuardian.sol` | Live di Arbitrum Sepolia |
| Core Risk Engine | `apps/engine/` (workspace `@tahansoe/engine`, ADR 0007) | Ada; riset multi-agent, emitter sinyal deterministik, Risk Fusion v1, settlement & scorecard, CLI `tahansoe` |
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
engine/                 (apps/engine) Core Risk Engine — service Node.js
  src/
    chains/             Chain registry: RPC, alamat Aave/Guardian, feeds, sequencer
    adapters/           ProtocolAdapter: aave-v3/, morpho-blue/
    signals/            Emitter deterministik (emit.ts, types.ts): carry T11, sequencer T10, oracle T8, depeg T4, macro 48h; stable dedupe keys
    sources/            Adapter data: rates (Aave V3), RSS berita, FRED API, kalender makro, DefiLlama, on-chain
    llm/                Gateway tunggal OpenAI-compatible (ADR 0009), default model gpt-6-luna, pricing, budget, router
    agents/             Research agents: analyst → debat Hawk/Dove → assessor (ADR 0004)
    reflection/         Settlement job (src/reflection/settle-job.ts), outcome evaluation, scorecard, lessons (ADR 0005)
    fusion/             Risk Fusion v1 (signals → RiskAssessment; aturan deterministik + guardrail unconfirmed signals)
    cli/                CLI terpadu (apps/engine/src/cli/tahansoe.ts, commands/, repl/, render.ts)
    worker/             Scheduled Research Worker (advisory lock Neon / file lock PGlite, background runner)
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
Signal emitters & collectors (deterministik & riset multi-agent)
  → deduplikasi via getSignalDedupeKey
  → tabel signals (dengan expiresAt & dedupe keys)
  → Risk Fusion v1 (aturan terkonfirmasi + guardrail unconfirmed)
  → risk_assessments (validUntil)
  → jika regime berubah: notify user dengan explanation
  → v1: dry-run / CLI inspection (`tahansoe fuse`, `analyze`)
  → v2: keeper sebagai risk agent memanggil setDynamicTrigger (di-clamp band user)
```

Interval & sumber sinyal:

| Modul | Tipe | Sumber & Frekuensi | Transmisi & Ambang |
|-------|------|--------------------|---------------------|
| **ORACLE** | Deterministik | Sequencer uptime feed (tiap block) & staleness/deviasi AaveOracle vs Chainlink proxy (tiap 15m) | T10 (sequencer down → severity 1.0; grace period 1 jam → 0.7), T8 (staleness > 1.5× heartbeat, deviasi ≥ 0.5%–2%) |
| **ONCHAIN** (Depeg) | Deterministik | Harga AaveOracle USDC, USDT, DAI (tiap 15m) | T4 (deviasi > 1% dari $1 → severity 0.5–1.0; linear sampai 5%) |
| **ONCHAIN** (Rates & Carry) | Deterministik | Polling on-chain Pool & DataProvider Aave V3 tiap 15m (`rate_samples`) | T11 (kink proximity, loan APR spike ≥ 2× atau > 20%, negative carry), T7 bila utilization ≥ 98% |
| **MACRO** | Deterministik | Kalender FOMC, BLS CPI/NFP 48 jam mendatang | T1/T2 (horizon ≤ 48 jam; severity FOMC 0.6, CPI 0.5, NFP 0.4) |
| **RESEARCH** | Multi-Agent LLM | Pipeline 4 analis + debat + assessor (tiap 2 jam CALM, tiap 1 jam ≥ ELEVATED) | Unconfirmed (confidence cap ≤ 0.60, severity cap 0.60) |
| Settlement | Deterministik | Evaluasi outcome horizon per jam; scorecard & lessons | TP / FP / MISSED / TN via sampel harga AaveOracle |

**Deduplikasi Sinyal (Stable Dedupe Keys):**
Untuk mencegah skor sinyal berlipat ganda saat fusion tick berulang (setiap 15 menit), setiap sinyal deterministik dan riset diberi dedupe key stabil via `getSignalDedupeKey(s)` (`${module}:${primaryPath}:${asset}:${type}`). Tabel `signals` hanya menyimpan instance aktif terbaru per dedupe key hingga `expiresAt`.

**Risk Fusion v1 & Guardrail Deterministik:**
Risk Fusion menggabungkan sinyal terkonfirmasi (`ONCHAIN`, `ORACLE`, `MACRO`) dan sinyal `RESEARCH` (opini AI):
1. **Aturan deterministik:** Kejadian nyata seperti sequencer down (R-SEQUENCER-DOWN), depeg stablecoin (R-DEPEG-CONFIRMED), anomali oracle (R-ORACLE-DEVIATION), atau event makro dekat (R-MACRO-SOON) langsung menggeser regime secara deterministik tanpa menunggu AI.
2. **Guardrail unconfirmed signals:** Sinyal `RESEARCH` bersifat *unconfirmed* (opini model). Sinyal ini sendirian **tidak pernah** diizinkan menaikkan regime ke `STRESSED` atau `CRISIS` tanpa adanya konfirmasi sinyal pasar/oracle/onchain yang valid.
3. **Penyelidikan & Operasi:** Operator dapat memeriksa status sinyal dan fusion langsung dari terminal via `tahansoe fuse`, `tahansoe carry`, atau sesi interaktif `tahansoe`.

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
| `signals` | Sinyal terkonfirmasi (ONCHAIN, ORACLE, MACRO) & riset (RESEARCH) | Ada, dipakai |
| `risk_assessments` | Output Risk Fusion v1 per aset/chain | Ada, dipakai |
| `market_events` | Event berita/geopolitik yang sudah dideduplikasi | **(rencana)** |
| `research_reports` | Output research agents (report, analis, debat, token, biaya) | Ada, dipakai — [ADR 0004](decisions/0004-multi-agent-research-layer.md) |
| `risk_settlements` | Label TP/FP/MISSED/TN + lead time + outcome evaluasi | Ada, dipakai — [ADR 0005](decisions/0005-reflection-loop.md) |
| `research_lessons` | Pelajaran hasil reflection (≤ 600 karakter, toggle on/off) | Ada, dipakai — [ADR 0005](decisions/0005-reflection-loop.md) |
| `rate_samples` | Sampling suku bunga, supply APY, borrow APR, utilization Aave V3 | Ada, dipakai — [spec m3-carry](specs/m3-carry-interest-monitoring.md) |
| `price_samples` | Sampling harga on-chain AaveOracle untuk evaluasi settlement | Ada, dipakai |

Kolom `chainId` wajib ada di setiap tabel yang menyimpan data on-chain (positions, policies, intents, rate_samples, price_samples).

### 5.1 Lapisan data engine: Neon vs PGlite ([ADR 0010](decisions/0010-local-pglite-database-option.md))

`packages/db` mendukung dua opsi driver database yang dapat dipilih melalui variabel environment **`DB_DRIVER`**:

1. **`neon`** (default bila `DATABASE_URL` diset):
   - Menggunakan `@neondatabase/serverless` (HTTP client untuk serverless web dan WebSocket direct session untuk engine worker).
   - Digunakan oleh `apps/web`, dashboard multi-user, dan deployment cloud/server.
   - Single-instance worker dijamin oleh PostgreSQL session-level advisory lock (`pg_try_advisory_lock(42161001)`).
2. **`pglite`** (default bila tanpa `DATABASE_URL` pada engine/CLI):
   - Postgres embedded berbasis WebAssembly (`@electric-sql/pglite`) tanpa dependensi server eksternal atau akun cloud.
   - Menyimpan database lokal di direktori **`PGLITE_DATA_DIR`** (default `apps/engine/.data/pglite`, di-gitignore).
   - Single-instance worker dijamin oleh lock file lokal (`lock-${key}.json`) yang mencatat PID dan timestamp heartbeat (stale takeover bila > 2 menit atau PID mati).
3. **Satu skema & auto-migrasi:**
   - Kedua driver menggunakan skema Drizzle dialek Postgres yang sama di `packages/db`.
   - Skema dimigrasi secara otomatis dan idempoten pada pemanggilan pertama, memastikan kesiapan engine tanpa langkah manual tambahan.

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
| Engine | Node.js 22 + TypeScript, viem, background Scheduled Research Worker dengan PostgreSQL session advisory lock di host yang selalu hidup |
| Data on-chain & riset | RPC + multicall untuk state; AaveOracle + Chainlink proxy + Sequencer Uptime Feed di Arbitrum One; data makro FRED API, kalender resmi FOMC/BLS, DefiLlama (depeg & hacks), dan RSS outlet berita terkurasi |
| Monorepo | npm workspaces (ADR 0007) — `apps/web`, `apps/engine`, `packages/db`, `packages/domain` |
| CI | GitHub Actions: typecheck + test + build semua workspace, lint web (blocking), `forge test` tanpa fork (`.github/workflows/ci.yml`) |
| DB | Dual-driver: Neon Postgres (server, web, multi-user) & PGlite lokal (embedded WASM di `PGLITE_DATA_DIR`, single-instance file lock) via Drizzle ORM ([ADR 0010](decisions/0010-local-pglite-database-option.md)). Auto-migrasi skema idempoten |
| Kontrak | Foundry, Solidity 0.8.26, OpenZeppelin v5 |
| LLM | Gateway tunggal OpenAI-compatible (`LLM_API_URL` + `LLM_API_KEY`, [ADR 0009](decisions/0009-single-openai-compatible-gateway.md)), default model **`gpt-6-luna`** untuk semua peran (lolos eval benchmark 24/24), cadangan `deepseek-v4-flash`, router peran + fallback berantai di `settings.json` v2, Zod schema validation (di-embed dalam prompt + 1 retry repair), budget harian dinamis |
| CLI & REPL | CLI terpadu `tahansoe` (`apps/engine/src/cli/tahansoe.ts`, `render.ts`), mode interaktif REPL dengan slash commands (`/carry`, `/fuse`, `/analyze`, dll.), grounded Q&A (`tahansoe ask` / REPL chat) dengan penolakan non-goals, serta perintah operasional (`carry`, `fuse`, `settle`, `scorecard`, `schedule`, `doctor`, `models`, `settings`, `eval`) |
| Notifikasi | Telegram Bot API |
| Automation (prod) | Chainlink Automation + cron cadangan |

---

## 8. Environment

Semua variabel environment di bawah bersifat server-only kecuali yang diawali `NEXT_PUBLIC_`:

| Variabel | Dipakai oleh | Deskripsi |
|----------|--------------|-----------|
| `DATABASE_URL` | app, engine, scripts | Koneksi PostgreSQL (Neon serverless / direct session) |
| `DB_DRIVER` | engine, scripts | Driver database: `neon` (default bila ada `DATABASE_URL`) atau `pglite` (lokal tanpa server, [ADR 0010](decisions/0010-local-pglite-database-option.md)) |
| `PGLITE_DATA_DIR` | engine, scripts | Lokasi folder database PGlite lokal (default: `apps/engine/.data/pglite`, di-gitignore) |
| `SESSION_SECRET`, `NEXT_PUBLIC_APP_DOMAIN` | app | Autentikasi sesi wallet & domain web |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` | app, engine | Bot notifikasi dan webhook Telegram |
| `NEXT_PUBLIC_WC_PROJECT_ID` | app | WalletConnect project id |
| `ARB_SEPOLIA_RPC_URL`, `ARBISCAN_API_KEY` | contracts, engine | RPC & verifikasi blok Arbitrum Sepolia |
| `KEEPER_PRIVATE_KEY` atau signer eksternal | engine/keeper **(rencana)** | Private key eksekusi transaksi proteksi Guardian |
| `LLM_API_URL` | engine | Endpoint gateway OpenAI-compatible tunggal (dinormalisasi s.d. `/v1`, [ADR 0009](decisions/0009-single-openai-compatible-gateway.md)) |
| `LLM_API_KEY` | engine | API key gateway OpenAI-compatible (secret server-only, tidak pernah di-log) |
| `LLM_DAILY_BUDGET_USD` | engine | Batas biaya LLM harian (USD); jika habis, riset dihentikan sampai hari berikutnya |
| `RESEARCH_ENABLED` | engine | Kill switch lapis riset (default `false`) |
| `FRED_API_KEY` | engine | API key data makro FRED Federal Reserve (key gratis) |
| `RESEARCH_GDELT_ENABLED` | engine | Toggle agregator GDELT DOC 2.0 (default `false`) |
| `ARBITRUM_RPC_URL` | engine | RPC Arbitrum One untuk polling on-chain |

> **Catatan Konfigurasi Non-Rahasia:** Pengaturan model per peran (`roles`: `analyst`, `debate`, `assessor`, `reflector`, `chat` beserta fallback berantai), `pricingUrl`, dan override harga token `modelPrices` disimpan di `settings.json` v2 (non-rahasia, per-mesin, di-gitignore) dan dikelola lewat `tahansoe settings`. Kunci lama per-provider (`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, dll.) telah digantikan oleh gateway tunggal ([ADR 0009](decisions/0009-single-openai-compatible-gateway.md)).


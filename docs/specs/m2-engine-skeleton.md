# Spec: M2 — Kerangka Core Risk Engine

- **Milestone:** M2 — Core Risk Engine v1 (lihat [PRD §10](../prd.md#10-roadmap-eksekusi))
- **Status:** Draft
- **Pemilik:** Tim engine
- **Terkait:** PRD §6.1, §6.3, §7.1; [architecture §2–§5](../architecture.md); [security.md](../security.md) (I1–I8, S6); [ADR 0001](../decisions/0001-arbitrum-first-chain-agnostic.md), [ADR 0002](../decisions/0002-ai-advises-rules-decide.md), [ADR 0005](../decisions/0005-reflection-loop.md), [ADR 0007](../decisions/0007-monorepo-structure-and-runtime.md); [knowledge/risk-transmission §4](../knowledge/risk-transmission.md#4-catatan-khusus-arbitrum-one); spec terkait: [m3-research-agents](m3-research-agents.md)

## 1. Tujuan

Menyediakan **kerangka service `apps/engine`** sebagai fondasi Core Risk Engine: satu worker Node yang selalu hidup, membaca posisi Aave V3 dan harga oracle on-chain lewat RPC, menyinkronkan event kontrak yang relevan, dan mengumpulkan sinyal risiko dasar (oracle monitor) ke dalam Postgres. Kerangka ini menjadi tempat bergantung bagi modul sinyal lanjutan, Risk Fusion, keeper, dan research agents (M3) tanpa menuliskan ulang chain registry, adapter, atau scheduler. Untuk siapa: tim yang membangun engine, dan secara tidak langsung borrower retail yang monitoring posisinya butuh dipindah dari browser (security S4) ke worker server (BRD §3).

## 2. Scope

**Termasuk:**
- Worker loop/scheduler `apps/engine` single-instance (Postgres advisory lock + heartbeat) dengan interval per modul sesuai [architecture §3.3](../architecture.md#3-alur-utama).
- Pemakaian chain registry `@tahansoe/domain` + injeksi RPC dari env (`ARBITRUM_RPC_URL`, `ARB_SEPOLIA_RPC_URL`).
- `AaveAdapter` read-only (viem multicall) yang mengimplementasikan `ProtocolAdapter.readPosition` ([PRD §7.1](../prd.md)); harga eksekusi lewat `AaveOracle.getAssetPrice` (I5).
- Event sync ringan: cursor block per kontrak + N konfirmasi, untuk `PolicySet`/`PolicyDisabled`/`Protected` (Guardian) dan `LiquidationCall` (Aave), tanpa indexer ([ADR 0007 §3](../decisions/0007-monorepo-structure-and-runtime.md)).
- Oracle Monitor minimal: staleness feed, deviasi AaveOracle vs proxy Chainlink, sequencer uptime feed (S6).
- Tabel baru di `packages/db`: `signals`, `risk_assessments`, `chain_sync_cursors`, serta pemakaian mirror `positions`/`policies`; rencana penambahan ke `packages/db/scripts/migrate.ts`.
- Titik integrasi (antarmuka) untuk Risk Fusion v1 (dry-run) dan settlement deterministik — **hanya kontrak antarmuka**, bukan implementasi.

**Tidak termasuk:**
- Modul sinyal Technical, On-chain lanjutan (utilization/flow/depeg/LST), Macro, News, Social — spec M2/M3 masing-masing.
- Implementasi penuh Risk Fusion v1 dan rule engine → Intent (spec terpisah; di sini hanya antarmuka).
- Keeper (`needsProtection` → `protect`) dan notifikasi Telegram dari server — spec keeper terpisah; kerangka ini hanya menyiapkan read & event sync yang dipakainya.
- Research agents & reflection (detail di [m3-research-agents](m3-research-agents.md)); di sini hanya memastikan tabel `signals.module` menerima nilai `RESEARCH` dan fusion mengonsumsinya.
- Guardian v2 / `setDynamicTrigger`, Morpho adapter, chain selain Arbitrum.
- Indexer khusus (subgraph/Ponder/Envio) — ditolak untuk sekarang ([ADR 0007 §3](../decisions/0007-monorepo-structure-and-runtime.md)).
- Migrasi SQL aktual (penulisan kode) — spec ini hanya **mendefinisikan** tabel; penambahan ke `migrate.ts` dilakukan di PR implementasi.

## 3. Desain

Semua kode baru berada di `apps/engine` dan **tidak** meng-import dari `apps/web`. Tipe kanonik (`Position`, `ProtocolAdapter`, `Signal`, `RiskAssessment`, `Call`, `Address`, `Regime`, `TransmissionPath`) berasal dari `@tahansoe/domain`; skema & koneksi DB dari `@tahansoe/db` ([ADR 0007](../decisions/0007-monorepo-structure-and-runtime.md)). Kunci apa pun hanya dari env server (I8).

### 3.1 File yang dibuat/diubah

```
apps/engine/src/
  index.ts                 entry: muat config, akuisisi lock, start scheduler, graceful shutdown
  runtime/
    config.ts              baca env (DATABASE_URL, ARBITRUM_RPC_URL, ARB_SEPOLIA_RPC_URL, ENGINE_CHAIN_IDS)
    lock.ts                Postgres advisory lock (single-instance) + heartbeat ke engine_instances
    scheduler.ts           registrasi job berinterval; satu loop per modul; cegah overlap per job
  chains/
    clients.ts             buat viem PublicClient per chain dari registry @tahansoe/domain + RPC env
  adapters/
    aave-v3/
      abi.ts               fragmen ABI (Pool.getUserAccountData, AaveOracle.getAssetPrice, dll.)
      adapter.ts           AaveAdapter implements ProtocolAdapter (readPosition read-only via multicall)
  sync/
    event-sync.ts          loop sync event per kontrak: baca cursor → getLogs(range) → simpan → majukan cursor
    guardian-events.ts     dekoder PolicySet / PolicyDisabled / Protected
    aave-events.ts         dekoder LiquidationCall
  signals/
    oracle/
      monitor.ts           staleness, deviasi AaveOracle vs proxy Chainlink, sequencer uptime → Signal
    emit.ts                tulis Signal ke tabel signals (dengan expiresAt, paths opsional)
  fusion/
    index.ts               ANTARMUKA runFusion(assets, chainId): Signal[] → RiskAssessment (dry-run); impl di spec lain
  settlement/
    index.ts               ANTARMUKA runSettlement(): titik integrasi ADR 0005; impl di spec lain
packages/db/src/
  schema.ts                + tabel signals, risk_assessments, chain_sync_cursors, engine_instances (atau file terpisah)
packages/db/scripts/
  migrate.ts               + enum signal_module & regime, + CREATE TABLE untuk tabel di atas (PR implementasi)
```

Catatan: nama file bersifat panduan; yang mengikat adalah komponen & antarmuka di bawah.

### 3.2 Worker loop & scheduler (single-instance)

- **Single-instance via Postgres advisory lock.** Saat start, `index.ts` memanggil `pg_try_advisory_lock(<key engine>)` lewat koneksi khusus yang dipertahankan selama proses hidup. Jika gagal (instance lain memegang lock), worker keluar dengan log — mencegah dua worker memproses chain yang sama (hindari double action nanti di keeper). Lock dilepas saat proses berhenti (koneksi putus → lock otomatis lepas).
- **Heartbeat ke DB.** Tabel `engine_instances` menyimpan `id`, `hostname`, `started_at`, `last_heartbeat_at`, `chain_ids`. Scheduler memperbarui `last_heartbeat_at` tiap ≤ 30 detik. Dipakai untuk observability dan agar web app bisa menandai "engine stale" (mendukung I6: jika heartbeat basi, UI jatuh ke policy statis / demo mode).
- **Interval per modul** (nilai awal, [architecture §3.3](../architecture.md#3-alur-utama)):

  | Job | Interval awal |
  |-----|---------------|
  | Oracle monitor, posisi (readPosition), event sync | setiap block / ≤ 15 detik |
  | Fusion (dry-run) | saat ada sinyal baru, minimal tiap 5 menit |
  | Settlement (antarmuka) | tiap jam (impl di spec lain) |

- **Anti-overlap.** Setiap job tidak boleh dijalankan ulang jika run sebelumnya belum selesai (guard in-memory per job). Kegagalan satu job dibungkus try/catch, dicatat, dan **tidak** menjatuhkan proses (I6).

### 3.3 Chain registry & RPC

- Konfigurasi chain diambil dari `@tahansoe/domain` (`getChainConfig(chainId, rpcUrls)` / `SUPPORTED_CHAINS`). Alamat Aave/Guardian/feeds tidak di-hardcode di `apps/engine` ([ADR 0001](../decisions/0001-arbitrum-first-chain-agnostic.md)).
- RPC URL **hanya** dari env: `ARBITRUM_RPC_URL` (42161), `ARB_SEPOLIA_RPC_URL` (421614). `clients.ts` menyuntikkan URL ini ke `getChainConfig` lalu membuat `viem` `PublicClient` dengan `multicall` aktif. Chain aktif ditentukan `ENGINE_CHAIN_IDS` (default: Arbitrum Sepolia 421614).
- Menambah chain = menambah entry registry di `@tahansoe/domain` + env RPC, tanpa mengubah logika engine.

### 3.4 AaveAdapter (read-only, I5)

- `AaveAdapter implements ProtocolAdapter` dari `@tahansoe/domain`. Fokus M2: **`readPosition(user): Promise<Position[]>`**. `buildRepay`/`buildSupply` cukup di-stub (dipakai keeper di spec lain) agar antarmuka utuh.
- `readPosition` memakai **viem multicall** untuk membaca `Pool.getUserAccountData(user)` (totalCollateralBase, totalDebtBase, healthFactor, dll.) dan, bila perlu komposisi per-aset, data reserve terkait.
- **Harga eksekusi** diambil dari `AaveOracle.getAssetPrice(asset)` — oracle protokol target — bukan dari sumber lain (I5). Alamat `AaveOracle` diturunkan dari `PoolAddressesProvider` saat runtime atau dari registry.
- **Catatan Arbitrum One** ([knowledge §4](../knowledge/risk-transmission.md#4-catatan-khusus-arbitrum-one)): harga USDC di AaveOracle memakai adapter **"Capped USDC/USD"** — depeg ke atas tidak terlihat Aave, depeg ke bawah terlihat. Modul peg (spec lain) wajib membaca proxy Chainlink **dan** AaveOracle; di M2 ini cukup didokumentasikan di adapter agar tidak salah pakai.
- Nilai on-chain disimpan sebagai `bigint` skala asli (HF = 1e18) sesuai konvensi angka [architecture §6](../architecture.md#6-interface-domain). USD dari AaveOracle tidak dicampur dengan USD sumber lain.

### 3.5 Event sync ringan (tanpa indexer)

- Satu loop per (chain, kontrak) menyimpan **cursor block** di tabel `chain_sync_cursors` (`chain_id`, `contract`, `last_synced_block`, `updated_at`).
- Tiap siklus: baca cursor → `getLogs({ fromBlock, toBlock })` dengan `toBlock = min(latest - N_CONFIRMATIONS, fromBlock + MAX_RANGE)` → dekode → upsert ke tabel tujuan → majukan cursor. Event dianggap final hanya setelah **N konfirmasi** ([ADR 0007 §3](../decisions/0007-monorepo-structure-and-runtime.md)); nilai N awal per chain disimpan di config.
- Event yang disinkronkan:
  - **Guardian**: `PolicySet`, `PolicyDisabled` → rekonstruksi mirror `policies` (sumber kebenaran tetap kontrak, [architecture §3.1](../architecture.md)); `Protected` → audit eksekusi.
  - **Aave**: `LiquidationCall` → deteksi likuidasi aktual (untuk settlement/metrik, ADR 0005).
- Idempotensi: upsert berdasar `(chain_id, tx_hash, log_index)`; re-scan rentang yang sama tidak menggandakan baris. Reorg di bawah N konfirmasi ditangani dengan menahan finalisasi; reorg lebih dalam di luar scope (dicatat di pertanyaan terbuka).

### 3.6 Oracle Monitor minimal

Menghasilkan `Signal` (`module: "ORACLE"`) ke tabel `signals`:
- **Staleness feed**: bandingkan `updatedAt` round Chainlink/AaveOracle terhadap heartbeat feed; jika lewat ambang → sinyal (jalur T8).
- **Deviasi AaveOracle vs proxy Chainlink**: untuk aset dengan dua sumber (mis. USDC capped vs USDC/USD proxy), hitung selisih; deviasi signifikan → sinyal (T4/T8).
- **Sequencer uptime feed** (`sequencerUptimeFeed` di registry, L2): `answer = 1` berarti down. **S6**: karena Aave Arbitrum One **tanpa** PriceOracleSentinel, sequencer down tidak memberi grace period; Oracle Monitor menandai kondisi ini sehingga fusion menaikkan regime **minimal `STRESSED`** dan keeper (spec lain) siap `protect` di blok pertama setelah pulih (jalur T10).
- Setiap `Signal` punya `expiresAt` (I6: sinyal basi kedaluwarsa) dan `paths` opsional (T4/T8/T10).

### 3.7 Perubahan skema DB (`packages/db`)

Didefinisikan di sini; penulisan ke `schema.ts` + `migrate.ts` dilakukan di PR implementasi. Semua tabel menyimpan `chain_id` ([architecture §5](../architecture.md#5-data-model)).

| Tabel | Kolom utama | Catatan |
|-------|-------------|---------|
| `signals` | `id`, `chain_id`, `module` (enum: ORACLE/TECHNICAL/ONCHAIN/MACRO/NEWS/SOCIAL/**RESEARCH**), `paths` (jsonb, opsional), `assets` (jsonb), `direction`, `severity`, `confidence`, `horizon_hours`, `observed_at`, `expires_at`, `evidence` (jsonb) | Bentuk mengikuti `Signal` [PRD §6.3](../prd.md). `RESEARCH` dari [ADR 0004](../decisions/0004-multi-agent-research-layer.md). |
| `risk_assessments` | `id`, `asset`, `chain_id`, `regime` (enum CALM/ELEVATED/STRESSED/CRISIS), `risk_score`, `drawdown_estimate` (jsonb), `recommended_trigger_hf`, `recommended_target_hf`, `drivers` (jsonb), `explanation`, `model_version`, `created_at`, `valid_until` | Mengikuti `RiskAssessment` [PRD §6.3](../prd.md). `valid_until` menegakkan I6. |
| `chain_sync_cursors` | `chain_id`, `contract`, `last_synced_block`, `updated_at` | PK `(chain_id, contract)`. |
| `engine_instances` | `id`, `hostname`, `chain_ids` (jsonb), `started_at`, `last_heartbeat_at` | Heartbeat single-instance. |
| `positions` (mirror) | sudah ada di `@tahansoe/db` | Diisi dari `readPosition`; snapshot, bukan sumber kebenaran. |
| `policies` (mirror) | sudah ada di `@tahansoe/db` | Direkonstruksi dari event Guardian; sumber kebenaran = kontrak. |

Enum baru di `migrate.ts`: `signal_module` dan `regime` (idempotent, pola `createTypeIfNotExists`). Tabel memakai `CREATE TABLE IF NOT EXISTS`.

### 3.8 Titik integrasi Fusion & Settlement (antarmuka saja)

- `fusion/index.ts` mengekspor tanda tangan `runFusion(input): RiskAssessment` yang menerima `Signal[]` aktif per aset/chain dan menghasilkan `RiskAssessment` **dry-run** (disimpan, belum memengaruhi on-chain — [ADR 0002 §5](../decisions/0002-ai-advises-rules-decide.md)). Implementasi aturan fusion ada di spec Risk Fusion v1 terpisah.
- `settlement/index.ts` mengekspor tanda tangan `runSettlement()` sebagai titik di mana `RiskAssessment`/`ResearchReport` dilabeli setelah horizonnya ([ADR 0005](../decisions/0005-reflection-loop.md)); detail di [m3-research-agents §3.5](m3-research-agents.md). M2 hanya memastikan tabel & jadwal tersedia agar baseline deterministik bisa mulai di M2.
- Aturan invariant: output fusion/AI hanya berupa data (`RiskAssessment`/`Signal`); tidak ada jalur ke dana (I3), dan sinyal `RESEARCH` sendirian tidak menaikkan regime ke `STRESSED`/`CRISIS` ([ADR 0004](../decisions/0004-multi-agent-research-layer.md)).

## 4. Dampak keamanan

Jawaban checklist [security.md §4](../security.md#4-checklist-review-keamanan):

- **Jalur baru perpindahan token? (I1)** — Tidak. Kerangka M2 **read-only**: `readPosition`, baca harga, baca event. Tidak ada signer, tidak ada kontrak yang dipanggil untuk menulis. `buildRepay`/`buildSupply` hanya stub antarmuka tanpa pengiriman transaksi.
- **Role/admin/upgrade baru? (I2)** — Tidak. Tidak menyentuh kontrak.
- **Output AI memengaruhi selain trigger dalam band? (I3)** — Tidak. M2 hanya menghasilkan `Signal`/`RiskAssessment` sebagai data; fusion dry-run tidak menulis on-chain. Pengaruh on-chain baru ada di Guardian v2 (M4).
- **Dampak terburuk jika dikompromi? (I4)** — Worker yang dikompromi hanya bisa menulis data risiko palsu ke Postgres (regime/sinyal keliru) dan membaca RPC. Tanpa signer, tidak ada kehilangan dana; konsekuensi maksimal adalah assessment menyesatkan yang, di M2, tidak dieksekusi (dry-run) dan tetap dibatasi aturan konfirmasi fusion.
- **Sumber harga untuk eksekusi? (I5)** — `AaveOracle.getAssetPrice` (oracle protokol target). Proxy Chainlink & sumber lain **hanya** untuk peringatan dini (deviasi/staleness), tidak untuk perhitungan HF eksekusi. USDC capped didokumentasikan agar tidak salah pakai.
- **Komponen mati / data basi? (I6)** — Setiap `Signal` punya `expires_at`, `RiskAssessment` punya `valid_until`; heartbeat `engine_instances` memungkinkan deteksi engine stale. Jika engine mati, web/keeper jatuh ke policy statis user. Kegagalan satu job tidak menjatuhkan worker.
- **User bisa menghentikan semuanya? (I7)** — Ya, tidak berubah. Kerangka M2 tidak memegang kuasa atas dana; penghentian proteksi tetap lewat kontrak (`disablePolicy`, cabut allowance).
- **Secret ter-commit/ter-bundle client? (I8)** — Tidak. `DATABASE_URL`, `ARBITRUM_RPC_URL`, `ARB_SEPOLIA_RPC_URL` hanya di env server `apps/engine`, tanpa prefix `NEXT_PUBLIC_`. `@tahansoe/db` hanya dipakai di kode server, tidak masuk bundle client.
- **Input eksternal divalidasi & diperlakukan sebagai data?** — Ya. Data RPC/log didekode dengan ABI yang diketik dan divalidasi sebelum disimpan; nilai di luar rentang wajar ditandai, bukan dipercaya buta. (Konten LLM tidak relevan di M2; itu M3.)

Temuan terkait: **S4** (monitoring pindah dari browser ke engine) sebagian dijawab kerangka ini; **S6** (sequencer tanpa sentinel) ditangani Oracle Monitor §3.6.

## 5. Kriteria penerimaan

- [ ] `apps/engine` start sebagai worker: mengakuisisi Postgres advisory lock; instance kedua pada chain yang sama keluar bersih tanpa menjalankan job.
- [ ] Baris `engine_instances` dibuat saat start dan `last_heartbeat_at` diperbarui ≤ 30 detik sekali selama worker hidup.
- [ ] Scheduler menjalankan tiap job pada intervalnya; dua run job yang sama tidak pernah overlap; kegagalan satu job tercatat dan tidak menghentikan worker.
- [ ] `AaveAdapter.readPosition(user)` mengembalikan `Position[]` dengan `healthFactor` sebagai `bigint` 1e18 yang cocok dengan `getUserAccountData` (diverifikasi fork test); `oracleSource`/harga berasal dari `AaveOracle.getAssetPrice`.
- [ ] RPC hanya dari env; tidak ada alamat chain atau URL RPC yang di-hardcode di `apps/engine` (grep bersih).
- [ ] Event sync memajukan `chain_sync_cursors` dan hanya memfinalisasi log setelah N konfirmasi; menjalankan ulang rentang yang sama tidak menggandakan baris (idempotent).
- [ ] Event `PolicySet`/`PolicyDisabled` merekonstruksi mirror `policies` yang konsisten dengan state kontrak pada fork test; `Protected` dan `LiquidationCall` tersimpan.
- [ ] Oracle Monitor menghasilkan `Signal` untuk staleness, deviasi, dan sequencer-down; saat sequencer `answer = 1`, sinyal menandai kondisi yang membuat fusion menaikkan regime minimal `STRESSED` (S6).
- [ ] Tabel `signals`, `risk_assessments`, `chain_sync_cursors`, `engine_instances` terdefinisi di `packages/db` dan ditambahkan ke `migrate.ts` secara idempotent; `npm run db:migrate` aman diulang.
- [ ] Antarmuka `runFusion` dan `runSettlement` ada dan dipanggil scheduler sebagai no-op/dry-run yang menyimpan `RiskAssessment` tanpa efek on-chain.
- [ ] `npm run typecheck`, `npm test`, dan `npm run lint` hijau dari root; tipe memakai `@tahansoe/domain`.

## 6. Rencana test

- **Unit:** parser/dekoder event (Guardian & Aave) dari fixture log; logika cursor+konfirmasi (idempotensi upsert); perhitungan deviasi/staleness Oracle Monitor; util scheduler (anti-overlap, interval).
- **Integrasi:** scheduler dengan job palsu (sukses, lempar error, run lama) → verifikasi anti-overlap, heartbeat, ketahanan error; advisory lock (dua instance → satu keluar).
- **Fork test (Arbitrum Sepolia, viem):** `readPosition` terhadap posisi nyata; `AaveOracle.getAssetPrice`; sync `PolicySet`/`Protected` terhadap Guardian ter-deploy; `LiquidationCall` dari block historis bila tersedia. Dijalankan dengan RPC env (`ARB_SEPOLIA_RPC_URL`), di-skip bila env tak ada.
- **Migrasi:** jalankan `migrate.ts` dua kali pada DB kosong → idempotent, tabel & enum ada (`npm run db:check`).
- **Keamanan (manual/review):** grep tidak ada alamat/RPC hardcoded; konfirmasi tak ada signer/kunci di kerangka; konfirmasi harga eksekusi hanya dari AaveOracle.

## 7. Pertanyaan terbuka

- Key advisory lock: satu lock global engine, atau satu lock per chain (agar worker per chain bisa paralel di host berbeda)?
- Nilai awal N konfirmasi per chain di Arbitrum (block time ~250 ms): berapa yang aman tanpa membuat deteksi terlalu lambat?
- Daftar user yang dipantau `readPosition`: dari mirror `policies` hasil event sync, atau sumber lain? (Berkaitan dengan registry user di keeper, lihat status.md kontrak.)
- Apakah mirror `positions`/`policies` perlu kolom `block_number`/`log_index` untuk audit rekonstruksi, atau cukup state terkini?
- Penanganan reorg lebih dalam dari N konfirmasi: cukup dicatat sebagai risiko operasional, atau butuh mekanisme rollback cursor?
- Ambang awal staleness & deviasi per feed (butuh kalibrasi dari data; lihat Oracle Monitor spec lanjutan bila dipisah).
- Apakah `engine_instances` cukup untuk observability, atau perlu metrik terpisah (durasi job, lag RPC) sejak M2?

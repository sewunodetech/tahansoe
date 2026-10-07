# Tahansoe — Product Requirements Document

**Version:** 0.2 (Draft)
**Last updated:** 7 Oktober 2026
**Owner:** Rakyavara Artomily (@rakaalts)
**Dokumen terkait:** [BRD](brd.md) · [Architecture](architecture.md) · [Security](security.md) · [Status](status.md) · [ADR](decisions/)
**Status:** Development — kontrak Guardian v1 live di Arbitrum Sepolia; Core Risk Engine dalam pengembangan (branch `core-dev`)

### Changelog

| Versi | Perubahan |
|-------|-----------|
| 0.2 | Fokus chain dipindah ke **Arbitrum** dengan arsitektur chain-agnostic (siap cross-chain). AI dinaikkan dari "fitur fase akhir" menjadi **Core Risk Engine**: oracle monitoring, analisa teknikal, fundamental/on-chain, makro, dan sentimen (news, geopolitik). Ditambah spesifikasi Guardian v2 (dynamic trigger band). |
| 0.1 | Draft awal: Aave V3 + Morpho, Base, rule engine statis. |

---

## 1. Ringkasan

Tahansoe adalah **AI risk agent** yang melindungi posisi borrow di protokol lending on-chain (Aave V3, lalu Morpho Blue) dari likuidasi.

Tahansoe bekerja dalam dua lapis:

1. **Core Risk Engine (AI)** — terus membaca oracle, data pasar, kondisi on-chain, kalender makro, serta berita dan sentimen (termasuk perang, geopolitik, regulasi) untuk menilai *seberapa besar kemungkinan harga collateral jatuh dalam waktu dekat*. Dari situ engine menyesuaikan buffer proteksi secara preemptif: pasar tenang → buffer tipis, risiko naik → buffer dinaikkan **sebelum** harga bergerak.
2. **Deterministic Execution** — rule engine dan kontrak Guardian mengeksekusi remediasi (repay, top-up collateral, deleverage) saat Health Factor (HF) melewati trigger.

Tahansoe bersifat **non-custodial**. Dana user tidak pernah berpindah ke kustodi Tahansoe.

### Positioning statement

> Tahansoe adalah risk automation yang memperkecil peluang rugi, **bukan** jaminan anti-likuidasi dan **bukan** alat prediksi harga.

Framing ini wajib konsisten di seluruh produk, dokumentasi, dan materi marketing. AI meningkatkan *kesiapan*, bukan memberi kepastian. Lihat §11 (Non-Goals) dan §13 (Risk Disclosure).

---

## 2. Problem Statement

User yang meminjam stablecoin (USDT/USDC) dengan collateral volatil (ETH, WBTC, LST) menghadapi empat masalah:

1. **Monitoring 24/7 tidak realistis.** Pasar crypto tidak tidur; user tidur.
2. **Reaksi manual terlalu lambat.** Saat user sadar HF turun, liquidator MEV bot sudah lebih dulu.
3. **Likuidasi mahal.** Penalti likuidasi Aave V3 berkisar 5–10% dari posisi yang dilikuidasi.
4. **Automation berbasis threshold statis bereaksi setelah harga bergerak.** Crash besar hampir selalu didahului atau dipicu oleh *event*: keputusan suku bunga, eskalasi perang, pengumuman tarif, depeg stablecoin/LST, exploit protokol, kebangkrutan exchange. Threshold statis (mis. HF 1.30) tidak tahu bahwa malam ini ada FOMC atau bahwa konflik baru saja pecah. Pada gap turun yang cepat, buffer statis sering tidak cukup.

Solusi eksisting (DeFi Saver, Instadapp, Summer.fi Automation) sudah menyediakan automation non-custodial berbasis threshold, tetapi umumnya: (a) mewajibkan migrasi posisi ke smart wallet/proxy mereka, (b) berfokus ke mainnet dan user besar, dan (c) tidak memasukkan konteks pasar — buffer tetap sama apa pun kondisi dunia.

### Diferensiasi Tahansoe

| Aspek | Tahansoe |
|-------|----------|
| Kecerdasan | Buffer dinamis berbasis multi-sinyal (teknikal + fundamental + sentimen + makro), dengan alasan yang bisa dibaca user |
| Onboarding | Tanpa migrasi wallet: user cukup `approve` + `setPolicy` dari EOA (Guardian v1) |
| Biaya | L2-first (Arbitrum) → repay kecil tetap ekonomis untuk user retail |
| Kanal | Telegram-first: alert + penjelasan risiko langsung di chat |

---

## 3. Goals

| # | Goal | Metrik keberhasilan |
|---|------|---------------------|
| G1 | Deteksi penurunan HF secara andal | Deteksi < 1 block setelah harga oracle update |
| G2 | Eksekusi remediasi otomatis | HF pulih di atas target dalam 1 transaksi |
| G3 | Non-custodial | Dana user tidak pernah dapat ditransfer keluar oleh Tahansoe, termasuk jika AI/agent dikompromi |
| G4 | **Proteksi preemptif berbasis intelijen pasar** | Pada backtest event historis, likuidasi tercegah lebih banyak dibanding threshold statis dengan biaya repay sebanding |
| G5 | **Arbitrum-first, chain-agnostic** | Menambah chain baru = konfigurasi + deploy, tanpa mengubah logika engine |
| G6 | Explainable | Setiap perubahan buffer dan setiap eksekusi punya alasan terstruktur yang tersimpan dan terkirim ke user |
| G7 | Multi-protokol | Aave V3 + Morpho Blue dengan interface adapter terpadu |
| G8 | Bekerja tanpa modal cadangan | Flash loan fallback untuk user tanpa reserve |

---

## 4. Konsep Inti & Klarifikasi

### 4.1 Yang dijaga adalah Health Factor

**Tahansoe tidak mengendalikan harga.** Yang dijaga adalah **Health Factor**:

```
HF = (Σ collateral × liquidationThreshold) / totalDebt
HF < 1.0 → posisi dapat dilikuidasi
```

Default statis: trigger `HF < 1.30`, pulihkan ke `targetHF = 1.60`.

### 4.2 Dari "prediksi" ke "buffer yang cukup"

Engine **tidak** mencoba menebak harga besok. Engine mengestimasi *seberapa dalam collateral bisa turun* dalam horizon tertentu (mis. 4 jam dan 24 jam) dengan tingkat keyakinan tertentu, lalu menghitung HF yang dibutuhkan agar posisi selamat dari penurunan itu.

Untuk collateral volatil dengan utang stablecoin, HF yang dibutuhkan untuk selamat dari penurunan `d`:

```
HF_required = 1 / (1 − d)

d = 15%  →  HF 1.18
d = 25%  →  HF 1.33
d = 30%  →  HF 1.43
d = 40%  →  HF 1.67
```

`d` adalah estimasi drawdown kuantil tinggi (mis. persentil ke-99) dari Core Risk Engine untuk horizon = waktu reaksi keeper + margin. Sinyal teknikal, fundamental, makro, dan sentimen menggeser estimasi `d` ini. Hasilnya diubah menjadi **trigger HF dinamis** yang tetap dibatasi oleh band yang disetujui user (§7.3).

Untuk posisi yang collateral dan utangnya berkorelasi (mis. wstETH/ETH), yang dimodelkan adalah pergerakan rasio harga keduanya, bukan harga USD collateral saja.

### 4.3 Aturan oracle kritis

Keputusan eksekusi WAJIB memakai oracle yang sama persis dengan yang digunakan protokol target (Aave V3: Chainlink Data Feeds melalui `AaveOracle`). Sumber lain (CEX, DEX, Pyth, RedStone) hanya boleh dipakai sebagai **sinyal peringatan dini** — tidak pernah sebagai dasar menghitung HF yang dieksekusi.

---

## 5. Arsitektur

```
┌──────────────────────────────────────────────────────────────────┐
│ LAYER 1 — DATA & SIGNALS                                         │
│ On-chain: Chainlink feeds, Aave/Morpho positions, sequencer feed │
│ Market:   CEX/DEX prices, volatility, funding, OI, orderbook     │
│ Off-chain: news, geopolitik, kalender makro, sosial              │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│ LAYER 2 — CORE RISK ENGINE (AI)                    ← branch core-dev
│ Oracle Monitor · Technical · Fundamental/On-chain · Macro ·      │
│ News & Sentiment  →  Risk Fusion  →  RiskAssessment              │
│ (regime, drawdown estimate, recommended trigger, alasan)         │
└──────────────────────────────────────────────────────────────────┘
                              ↓  (rekomendasi, terbatas oleh band user)
┌──────────────────────────────────────────────────────────────────┐
│ LAYER 3 — POLICY (deterministik)                                 │
│ User policy + RiskAssessment + guardrails  →  Intent             │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│ LAYER 4 — TRIGGER                                                │
│ Keeper: cron + viem (dev) │ Chainlink Automation (prod)          │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│ LAYER 5 — EXECUTION (per chain)                                  │
│ TahansoeGuardian → Aave.repay() / supply() / flashLoan()         │
└──────────────────────────────────────────────────────────────────┘
```

### 5.1 Prinsip arsitektur

**AI advises, rules decide, contract enforces.**
AI tidak pernah menandatangani transaksi yang memindahkan dana. Output AI hanya berupa `RiskAssessment` terstruktur. Satu-satunya efek on-chain yang boleh dipengaruhi AI adalah **menggeser trigger HF di dalam band yang sudah disetujui user** (§7.3). Rule engine deterministik dan kontrak Guardian yang memutuskan serta mengeksekusi.

**Kompromi AI ≠ kehilangan dana.**
Skenario terburuk jika agent dikompromi atau berhalusinasi: trigger dinaikkan ke batas atas band user, sehingga utang user dibayar lebih awal. Itu biaya peluang, bukan pencurian. Invariant ini harus dijaga di setiap desain baru.

**Graceful degradation.**
Jika engine down, data basi, atau sinyal bertentangan, sistem jatuh ke policy statis user. Proteksi dasar tidak boleh bergantung pada AI.

**Trigger-agnostic.**
Guardian mengekspos `checkUpkeep()` / `performUpkeep()`. Dev memakai cron; migrasi ke Chainlink Automation tidak memerlukan perubahan kontrak.

**Intent vs execution.**
Rule engine mengeluarkan objek Intent, bukan transaksi langsung. Ini memungkinkan dry-run, simulasi, backtest, dan audit trail.

**Chain-agnostic sejak hari pertama.** Lihat §8.

---

## 6. Core Risk Engine (fokus branch `core-dev`)

Engine adalah service TypeScript (viem) terpisah dari web app, berjalan terus-menerus, menyimpan hasil ke Postgres, dan dikonsumsi oleh keeper, dashboard, dan bot Telegram.

### 6.1 Modul sinyal

| Modul | Sumber | Contoh sinyal |
|-------|--------|---------------|
| **Oracle Monitor** | Chainlink feeds (via AaveOracle), Arbitrum Sequencer Uptime Feed, Pyth/RedStone, harga CEX/DEX | Feed basi (melewati heartbeat), deviasi oracle vs pasar mendekati deviation threshold (oracle akan "melompat"), sequencer down/baru pulih, depeg stablecoin |
| **Technical** | OHLCV CEX, derivatives data | Realized volatility (EWMA/GARCH), ATR, tren & level support, funding rate ekstrem, open interest, cluster likuidasi, kedalaman orderbook, korelasi antar aset |
| **Fundamental / On-chain** | RPC, indexer, data protokol | Utilization reserve Aave (likuiditas repay/withdraw), inflow besar ke exchange, supply & peg stablecoin, rasio LST/LRT (wstETH/ETH), token unlock, insiden bridge/exploit |
| **Macro & Calendar** | Kalender ekonomi | FOMC, CPI, NFP, keputusan bank sentral besar, jadwal regulasi — event terjadwal dengan volatilitas tinggi |
| **News & Geopolitics** | Feed berita, GDELT, rilis resmi, crypto news | Perang/eskalasi konflik, sanksi, tarif dagang, kebijakan regulator, kebangkrutan/insolvensi institusi, exploit protokol |
| **Social Sentiment** | X, Telegram, Reddit, Fear & Greed | Lonjakan sentimen negatif, panic narrative, rumor yang menyebar cepat |

### 6.2 Peran LLM dalam News & Sentiment

LLM dipakai untuk **memahami teks**, bukan untuk mengambil keputusan eksekusi:

1. Mengklasifikasikan setiap berita/post menjadi event terstruktur: kategori, aset terdampak, arah, severity, horizon, confidence.
2. Deduplikasi (satu event dari 50 sumber = satu event).
3. Menulis ringkasan alasan yang bisa dibaca user ("Buffer dinaikkan: eskalasi konflik X + FOMC 6 jam lagi + funding ETH ekstrem").

Guardrails wajib:

- **Output terstruktur saja** (schema-validated). Teks berita adalah input tidak tepercaya; instruksi di dalamnya diabaikan (proteksi prompt injection).
- **Kredibilitas sumber dan konfirmasi multi-sumber.** Event severity tinggi butuh ≥ 2 sumber kredibel independen, atau konfirmasi dari pergerakan pasar, sebelum menggeser regime ke `STRESSED`/`CRISIS`. Ini mencegah berita palsu memicu deleverage massal.
- **Sinyal kedaluwarsa.** Setiap event punya `expiresAt`; efeknya meluruh.
- **Model-agnostic.** Provider LLM dibungkus interface agar bisa diganti dan dievaluasi.

### 6.3 Risk Fusion

Semua sinyal digabung menjadi `RiskAssessment` per aset (dan per posisi):

```ts
type Regime = "CALM" | "ELEVATED" | "STRESSED" | "CRISIS";

interface Signal {
  id: string;
  module: "ORACLE" | "TECHNICAL" | "ONCHAIN" | "MACRO" | "NEWS" | "SOCIAL";
  assets: string[];             // mis. ["ETH", "WBTC"]
  direction: "DOWN" | "UP" | "VOLATILITY";
  severity: number;             // 0..1
  confidence: number;           // 0..1
  horizonHours: number;
  observedAt: Date;
  expiresAt: Date;
  evidence: { title: string; url?: string; source: string }[];
}

interface RiskAssessment {
  asset: string;
  chainId: number;
  regime: Regime;
  riskScore: number;            // 0..100
  drawdownEstimate: {           // kuantil drawdown, mis. p99
    h4: number;
    h24: number;
  };
  recommendedTriggerHF: number; // sebelum di-clamp ke band user
  recommendedTargetHF: number;
  drivers: Signal[];            // sinyal paling berpengaruh
  explanation: string;          // ringkasan untuk user
  modelVersion: string;
  createdAt: Date;
  validUntil: Date;
}
```

Pendekatan bertahap:

1. **v1 — kuantitatif + aturan:** drawdown dari volatilitas realized (EWMA/GARCH) dikalikan multiplier regime. Regime ditentukan oleh aturan eksplisit atas sinyal (mis. event makro terjadwal < 12 jam → minimal `ELEVATED`).
2. **v2 — model terlatih:** model yang memetakan fitur sinyal ke distribusi drawdown, dilatih dan divalidasi dengan backtest event historis.

Mapping regime ke buffer (default, dapat dikalibrasi):

| Regime | Contoh kondisi | Trigger HF (sebelum clamp) |
|--------|----------------|----------------------------|
| CALM | Volatilitas rendah, tanpa event | 1.15 – 1.25 |
| ELEVATED | Event makro terjadwal, funding ekstrem | 1.30 – 1.40 |
| STRESSED | Eskalasi geopolitik terkonfirmasi, oracle deviasi tinggi | 1.45 – 1.60 |
| CRISIS | Depeg, exploit besar, crash berjalan | Batas atas band user |

### 6.4 Backtest & evaluasi

Engine harus bisa me-replay periode historis untuk membandingkan **dynamic trigger vs static trigger**:

- Maret 2020 (COVID crash), Mei 2022 (Terra/LUNA), Juni 2022 (stETH discount/3AC), November 2022 (FTX), Maret 2023 (depeg USDC/SVB), Agustus 2024 (yen carry unwind), Oktober 2025 (crash akibat pengumuman tarif AS–China).

Metrik per skenario: posisi yang tercegah dari likuidasi, total biaya repay/deleverage yang tidak perlu, dan lead time (berapa jam sebelum crash buffer sudah naik).

### 6.5 Explainability & notifikasi

Setiap perubahan regime dan setiap Intent disimpan beserta `drivers` dan `explanation`, lalu dikirim ke Telegram, misalnya:

> ⚠️ Regime ETH: ELEVATED → STRESSED. Trigger kamu naik 1.30 → 1.48 (band kamu: 1.25–1.60). Alasan: eskalasi konflik di Timur Tengah (3 sumber), funding ETH −0.08%, oracle ETH/USD tertinggal 0.9% dari pasar.

---

## 7. Komponen Eksekusi

### 7.1 Protocol Adapter

```ts
interface Position {
  protocol: "aave-v3" | "morpho-blue";
  chainId: number;
  user: Address;
  healthFactor: bigint;          // 1e18
  liquidationThreshold: bigint;
  collateralValueUsd: bigint;
  debtValueUsd: bigint;
  oracleSource: Address;
  marketId?: Hex;                // Morpho Blue: isolated per market
}

interface ProtocolAdapter {
  readonly protocol: Position["protocol"];
  readonly chainId: number;
  readPosition(user: Address): Promise<Position[]>;
  buildRepay(intent: Intent): Promise<Call>;
  buildSupply(intent: Intent): Promise<Call>;
}
```

| Protokol | Model risiko |
|----------|--------------|
| Aave V3 | HF agregat lintas seluruh aset, satu angka per user |
| Morpho Blue | Isolated per market; setiap pasangan collateral/loan punya LLTV sendiri |
| Morpho Vaults | User adalah supplier — tidak ada likuidasi, di luar scope |

Bangun `AaveAdapter` sampai benar sebelum `MorphoAdapter`.

### 7.2 Rule Engine

Deterministik. Input: posisi, policy user, `RiskAssessment` terbaru (jika valid). Output: Intent.

```ts
interface Intent {
  action: "REPAY" | "SUPPLY_COLLATERAL" | "DELEVERAGE" | "NOOP";
  chainId: number;
  amount: bigint;
  asset: Address;
  source: "HOT_RESERVE" | "WARM_RESERVE" | "FLASH_LOAN";
  targetHealthFactor: bigint;
  effectiveTriggerHF: bigint;
  riskAssessmentId?: string;     // jejak ke alasan AI, jika ada
  reason: string;
  estimatedGas: bigint;
  estimatedSlippageBps: number;
}
```

### 7.3 TahansoeGuardian

**v1 (live, Arbitrum Sepolia `0x1A5D249A8e711E2288AdD7c01e31Eb7FFB05D97E`):**
user `approve` debt asset ke Guardian + `setPolicy(debtAsset, triggerHF, targetHF, maxRepayPerAction)`. Siapa pun dapat memanggil `protect(user)` saat `HF < triggerHF`. Token hanya mengalir dari wallet user → Aave untuk membayar utang user tersebut; sisa dikembalikan. Tanpa owner, tanpa admin, tanpa saldo.

**v2 (dibutuhkan untuk AI dynamic trigger):**

| Fitur | Spesifikasi |
|-------|-------------|
| Risk band | User menetapkan `minTriggerHF` dan `maxTriggerHF`. Trigger efektif selalu di dalam band ini. |
| Risk agent per user | User memilih alamat agent yang dipercaya (`setRiskAgent(agent)`) dan bisa mencabutnya kapan saja. Tidak ada admin global. |
| `setDynamicTrigger(user, triggerHF, validUntil)` | Hanya bisa dipanggil oleh agent milik user; di-clamp ke band; perubahan per update dibatasi; ada `validUntil`. |
| Fallback | Jika dynamic trigger kedaluwarsa, Guardian memakai trigger statis user. |
| Strategi tambahan | Flash loan repay, deleverage (swap collateral via router allowlist), `repayWithATokens`. |
| Event | `DynamicTriggerSet(user, triggerHF, validUntil, assessmentHash)` — hash menautkan ke `RiskAssessment` off-chain untuk audit. |

Invariant v2 sama dengan v1: **tidak ada jalur bagi agent, keeper, atau Tahansoe untuk memindahkan dana user ke alamat selain posisi user itu sendiri.**

Opsi jangka menengah: modul berbasis **EIP-7702** agar EOA mendapat kemampuan smart account (flash loan + deleverage atomik) tanpa migrasi wallet.

### 7.4 Funding Sources

| Sumber | Butuh modal | Trade-off |
|--------|-------------|-----------|
| Hot reserve (wallet user) | Ya | Instan, tapi modal idle — **live di v1** |
| Warm reserve | Ya | Ada yield, tapi latensi penarikan |
| aToken repay | Tidak (pakai supply yang ada) | Mengurangi collateral & utang sekaligus |
| Deleverage | Tidak | Realize loss + slippage |
| Flash loan | Tidak | Fee ~0.05%, atomic, tetap menjual collateral |

**Correlation risk:** reserve yang ditempatkan di venue yang sama dengan posisi bisa gagal ditarik saat utilization mendekati 100% — persis saat dibutuhkan. Engine memantau utilization (§6.1) dan memperhitungkannya.

### 7.5 Natural language config

User menyatakan niat ("jaga posisiku konservatif, tahan drop 30%"). LLM menerjemahkan ke parameter policy (mis. band 1.30–1.60, target 1.70) dan **user wajib mengonfirmasi** sebelum disimpan atau ditandatangani.

---

## 8. Strategi Chain: Arbitrum-first, Cross-chain-ready

### 8.1 Keputusan

- **Fokus sekarang:** Arbitrum Sepolia (testnet) → Arbitrum One (mainnet).
- **Arsitektur:** chain-agnostic sejak awal. Tidak ada alamat, chainId, atau asumsi chain yang di-hardcode di logika engine.

### 8.2 Prinsip desain chain-agnostic

| Area | Aturan |
|------|--------|
| Konfigurasi | Registry per chain: RPC, alamat Aave (dari `bgd-labs/aave-address-book`), Guardian, oracle feeds, sequencer feed, block time |
| Adapter | `ProtocolAdapter` diinstansiasi per `(protocol, chainId)` |
| Kontrak | Guardian dideploy per chain, sebisa mungkin di alamat yang sama (CREATE2) |
| Identitas user | User diidentifikasi oleh **wallet address**, bukan `(wallet, chainId)`. Posisi dan policy yang punya `chainId`. |
| Risk Engine | Sinyal pasar & berita bersifat global (dihitung sekali); sinyal oracle/on-chain bersifat per chain |
| L2-specific | Sequencer uptime feed dan grace period wajib dicek di setiap L2 |

### 8.3 Tahapan cross-chain

1. **Single chain:** Arbitrum.
2. **Multi-chain independen:** tambah Base / Optimism / Ethereum — posisi di tiap chain dilindungi secara terpisah dengan engine yang sama.
3. **Cross-chain portfolio view:** dashboard dan Risk Engine melihat semua posisi user lintas chain sebagai satu portofolio.
4. **Cross-chain funding:** reserve di chain A dipakai untuk menyelamatkan posisi di chain B (mis. via Chainlink CCIP). Butuh analisa latensi dan risiko bridge tersendiri; tidak boleh menjadi satu-satunya jalur proteksi.

---

## 9. Keputusan Terkunci

| Keputusan | Pilihan | Alasan |
|-----------|---------|--------|
| Chain awal | **Arbitrum** (Sepolia → One) | Gas murah, Aave V3 matang, kontrak v1 sudah live di sana |
| Multi-chain | Arsitektur chain-agnostic sekarang, deployment bertahap (§8.3) | Hindari rewrite saat ekspansi |
| Peran AI | Core Risk Engine; hanya boleh menggeser trigger di dalam band user | Kecerdasan maksimal tanpa membuka jalur kehilangan dana |
| Custody | Non-custodial | Menghindari risiko kustodian, hukum, dan single point of failure |
| Funding default | Hot reserve (v1) → flash loan fallback (v2) | Bertahap sesuai kesiapan kontrak |
| Trigger (dev) | Cron + viem | Iterasi cepat |
| Trigger (prod) | Chainlink Automation (+ cron cadangan) | Tidak ada SPOF |
| Oracle eksekusi | Oracle protokol target (Chainlink via AaveOracle) | Harus identik dengan yang dipakai likuidator |

---

## 10. Roadmap Eksekusi

### Milestone 0 — Validasi Loop ✅ (level kontrak)
- [x] `TahansoeGuardian` v1 (hot reserve repay) + unit/fuzz test
- [x] Fork test Aave V3 Arbitrum Sepolia: harga ETH turun 25% → `protect()` memulihkan HF ke 1.60
- [x] Deploy ke Arbitrum Sepolia

### Milestone 1 — Integrasi end-to-end (Arbitrum Sepolia)
- [ ] Chain registry + `arbitrumSepolia` di wagmi
- [ ] `ProtocolAdapter` interface + `AaveAdapter` (read posisi asli)
- [ ] Settings → `approve` + `setPolicy` on-chain
- [ ] Keeper cron + viem: `needsProtection` → `protect`, catat ke tabel `intents`
- [ ] Notifikasi Telegram dari server (bukan dari browser)
- [ ] Identitas user berbasis wallet (lepas `chainId` dari tabel `users`)

### Milestone 2 — Core Risk Engine v1 (`core-dev`)
- [ ] Kerangka engine: signal bus, penyimpanan `signals` & `risk_assessments`, scheduler
- [ ] Oracle Monitor (staleness, deviasi, sequencer uptime)
- [ ] Technical module (EWMA/GARCH volatility, funding, OI)
- [ ] Macro calendar
- [ ] Risk Fusion v1 (aturan + kuantitatif) → `RiskAssessment` + explanation
- [ ] Dry-run: tampilkan rekomendasi trigger di dashboard & Telegram tanpa mengubah on-chain
- [ ] Framework backtest + skenario historis §6.4

### Milestone 3 — Intelligence
- [ ] News & geopolitics ingestion + klasifikasi LLM (structured output, multi-source confirmation)
- [ ] Social sentiment
- [ ] Fundamental/on-chain module (utilization, exchange flow, depeg, LST ratio)
- [ ] Kalibrasi regime → buffer via backtest

### Milestone 4 — Guardian v2
- [ ] Risk band + risk agent per user + `setDynamicTrigger`
- [ ] Flash loan repay & deleverage
- [ ] Audit kontrak
- [ ] Registrasi Chainlink Automation

### Milestone 5 — Ekspansi
- [ ] Arbitrum One mainnet
- [ ] `MorphoAdapter`
- [ ] Chain kedua (Base/Optimism) + portfolio view lintas chain
- [ ] NL config (dengan konfirmasi user)
- [ ] Riset cross-chain funding (CCIP)

---

## 11. Non-Goals (v1)

- Menjamin pencegahan likuidasi dalam segala kondisi
- Memprediksi harga atau memberi sinyal trading / nasihat investasi
- AI yang menandatangani atau memicu transfer dana
- Kustodi dana user
- Optimasi yield atau strategi leverage
- Perlindungan terhadap flash crash intra-block
- Dukungan untuk posisi supplier Morpho Vaults

---

## 12. Metrik Keberhasilan

| Metrik | Target v1 |
|--------|-----------|
| Latensi deteksi | < 1 block setelah oracle update |
| Tingkat keberhasilan eksekusi | > 95% pada kondisi pasar normal |
| Likuidasi tercegah (fork/backtest) | > 90% skenario terkendali |
| Dynamic vs static (backtest) | Likuidasi tercegah lebih banyak pada skenario §6.4, biaya repay tambahan terukur dan dilaporkan |
| Lead time regime | Buffer sudah naik sebelum drawdown utama pada mayoritas skenario event terjadwal/terkonfirmasi |
| False positive (aksi tak perlu) | < 5% |
| Ketersediaan engine | Jika down, fallback statis aktif 100% |
| Insiden kehilangan dana | 0 (invariant absolut) |

---

## 13. Risk Disclosure

Batasan berikut wajib dikomunikasikan secara eksplisit di UI, bukan disembunyikan di footnote.

| Risiko | Dampak | Mitigasi |
|--------|--------|----------|
| **Flash crash / black swan** | Penurunan besar tanpa sinyal sebelumnya; MEV liquidator lebih cepat | Buffer konservatif; disclosure bahwa ini tidak dapat dicegah |
| **AI salah baca / halusinasi** | Buffer terlalu rendah (proteksi kurang) atau terlalu tinggi (repay tidak perlu) | Trigger di-clamp ke band user; fallback statis; backtest & monitoring akurasi |
| **Berita palsu / manipulasi sentimen** | Deleverage massal yang tidak perlu | Kredibilitas sumber, konfirmasi multi-sumber, konfirmasi pasar, rate limit perubahan trigger |
| **Prompt injection dari konten berita** | Output LLM dibajak | Output schema-only, konten eksternal diperlakukan sebagai data |
| **Oracle lag** | Harga oracle tertinggal | Eksekusi pakai oracle protokol; Pyth/RedStone/CEX sebagai early warning |
| **Sequencer L2 down** | Tidak ada transaksi masuk; setelah pulih, harga bisa melompat | Pantau sequencer uptime feed; grace period; alert ke user |
| **Kegagalan likuiditas reserve** | Reserve tidak dapat ditarik saat utilization tinggi | Pisahkan venue; cek `maxWithdraw()`; pantau utilization |
| **Kegagalan flash loan** | Slippage melampaui batas, revert | Simulasi sebelum eksekusi; batas slippage; retry ukuran lebih kecil |
| **Batas gas `performUpkeep`** | Repay + swap + flash loan melampaui limit | Pisahkan deteksi dari eksekusi |
| **Risiko bridge (cross-chain)** | Dana tertahan/hilang saat bridging | Cross-chain funding hanya pelengkap, bukan jalur utama |
| **Bug smart contract** | Kehilangan dana | Audit; scope minimal; tanpa admin; user dapat disable kapan saja |

---

## 14. Pertanyaan Terbuka

- Model biaya: subscription untuk Risk Engine premium, fee per eksekusi (bps dari jumlah repay), atau kombinasi? Siapa membayar gas keeper/LINK?
- Threshold & band per-posisi atau global per-akun?
- Bagaimana menangani multi-posisi lintas protokol/chain yang memperebutkan reserve yang sama?
- Sumber data berita & sosial mana yang dipakai (biaya lisensi, rate limit, kredibilitas)?
- Seberapa sering engine boleh menggeser dynamic trigger (rate limit on-chain vs biaya gas)?
- Apakah agent yang menulis `setDynamicTrigger` dioperasikan Tahansoe, atau user bisa membawa agent sendiri?
- Fallback jika Chainlink Automation gagal — cron sekunder tetap dipertahankan?

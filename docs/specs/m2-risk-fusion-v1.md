# Spec: Risk Fusion v1 (deterministik)

- **Milestone:** M2 — Core Risk Engine v1 ([PRD §10](../prd.md#10-roadmap-eksekusi), item "Risk Fusion v1")
- **Status:** Approved (disetujui tim, 2026-10-09) — siap implementasi
- **Pemilik:** engine / agent core-dev
- **Terkait:** [PRD §4.2](../prd.md#42-dari-prediksi-ke-buffer-yang-cukup), [PRD §6.3](../prd.md#63-risk-fusion), [PRD §7.3](../prd.md#73-tahansoeguardian) · [Security §1 (I5, I6), §4](../security.md#4-checklist-review-keamanan) · [ADR 0002 (AI advises, rules decide)](../decisions/0002-ai-advises-rules-decide.md), [ADR 0004](../decisions/0004-multi-agent-research-layer.md), [ADR 0005](../decisions/0005-reflection-loop.md), [ADR 0007](../decisions/0007-monorepo-structure-and-runtime.md) · [spec m3-research-agents](m3-research-agents.md) · [knowledge/risk-transmission](../knowledge/risk-transmission.md)

## 1. Tujuan

Risk Fusion v1 adalah **lapisan deterministik** di dalam Core Risk Engine (PRD §5, Layer 2) yang mengubah seluruh `Signal` aktif dari semua modul (`ORACLE`, `TECHNICAL`, `ONCHAIN`, `MACRO`, `NEWS`, `SOCIAL`, `RESEARCH`) menjadi satu `RiskAssessment` per aset per chain: `regime`, `riskScore`, `drawdownEstimate` (h4/h24), `recommendedTriggerHF`/`recommendedTargetHF`, `drivers`, `explanation`, `modelVersion`, dan `validUntil`. Tujuannya memberi rule engine (PRD §7.2) satu objek risiko yang **bisa diaudit, dites, dan dijelaskan ke user** (G6), tanpa komponen AI yang bisa menandatangani apa pun. Fusion menerjemahkan "seberapa dalam collateral bisa turun" menjadi "HF yang dibutuhkan" (PRD §4.2) — bukan memprediksi harga (§11 Non-Goals).

## 2. Scope

**Termasuk:**
- Pembacaan `signals` aktif (belum kedaluwarsa) dari DB per `(chainId, asset)`, dengan **decay berdasarkan umur** sinyal.
- Aturan **regime** eksplisit dan deterministik (tabel keputusan yang bisa dites satu per satu), termasuk guardrail konfirmasi untuk `RESEARCH`/`NEWS` dan **hysteresis** (naik cepat, turun lambat).
- Estimasi `drawdownEstimate.h4/h24` dari **volatilitas realized** (sumber harga = `AaveOracle`, I5) × multiplier regime.
- Perhitungan `recommendedTriggerHF = hfRequired(d)` (rumus PRD §4.2, helper `@tahansoe/domain/hf.ts`) dan `recommendedTargetHF`. **Clamp ke band user dilakukan rule engine, bukan fusion** (§3.6).
- Skema tabel baru `risk_assessments` (mengikuti konvensi `packages/db`), penulisan satu assessment per aset per run, `validUntil`, dan `modelVersion = versi aturan fusion`.
- Antarmuka pemanggilan dari `apps/engine/src/worker` (setelah setiap research run + tiap N menit) dan antarmuka konsumsi oleh **settlement** (ADR 0005).

**Tidak termasuk:**
- Model drawdown terlatih (v2, PRD §6.3) — v1 murni kuantitatif + aturan.
- Clamp ke band user, penerbitan `Intent`, dan apa pun yang on-chain (itu rule engine + Guardian, PRD §7.2/§7.3).
- Pembuatan sinyal mentah (itu modul sinyal M2/M3) dan penulisan sinyal `RESEARCH` (itu research agents, [spec m3](m3-research-agents.md)).
- Perubahan perilaku worker yang sudah ada (research-worker). Spec ini hanya **menambahkan** pemanggilan fusion, tanpa mengubah penjadwalan research yang berjalan.
- Notifikasi Telegram (konsumen hilir; fusion hanya menyediakan `explanation`).

## 3. Desain

### 3.1 Komponen & lokasi file

Semua kode engine di `apps/engine/src/` (ADR 0007: web & engine tidak saling import; tipe kanonik dari `@tahansoe/domain`).

| File (baru) | Isi |
|-------------|-----|
| `apps/engine/src/fusion/config.ts` | Konstanta aturan berversi: `FUSION_VERSION`, bobot per module, batas confidence, multiplier regime, parameter decay, parameter hysteresis, default target. |
| `apps/engine/src/fusion/decay.ts` | Fungsi murni: `decayedWeight(signal, now)` — faktor peluruhan berbasis umur & `expiresAt`. |
| `apps/engine/src/fusion/regime.ts` | Fungsi murni: `decideRegime(input): { regime, drivers, reasons }` — tabel keputusan eksplisit + guardrail + hysteresis. |
| `apps/engine/src/fusion/drawdown.ts` | Fungsi murni: `estimateDrawdown(realizedVol, regime): { h4, h24 }` dan `realized vol` util. |
| `apps/engine/src/fusion/fuse.ts` | Orkestrasi murni: `fuse(signals, priorAssessment, volInput, now): RiskAssessment` (tanpa I/O). |
| `apps/engine/src/fusion/explain.ts` | `renderExplanation(assessment): string` (English, untuk user). |
| `apps/engine/src/fusion/run.ts` | Lapisan I/O tipis: baca `signals` aktif + prior assessment + volatilitas, panggil `fuse`, tulis `risk_assessments`. |
| `apps/engine/src/db/assessments.ts` | Query baca/tulis `risk_assessments` (konvensi seperti `src/db/store.ts`). |

Tipe `Signal`, `RiskAssessment`, `Regime`, `TransmissionPath`, dan helper `hfRequired`/`clampTrigger`/`TriggerBand` **sudah ada** di `@tahansoe/domain` ([types.ts](../../packages/domain/src/types.ts), [hf.ts](../../packages/domain/src/hf.ts)) — fusion memakai ulang, tidak mendefinisikan ulang.

### 3.2 Alur satu run fusion

```
input: chainId, assets[] (mis. ["ETH","WBTC"]), now
  1. Ambil signals aktif: WHERE chain_id = chainId AND expires_at > now
     (indeks signals_expires_idx / signals_chain_idx sudah ada).
  2. Ambil prior assessment per aset (untuk hysteresis & validUntil sebelumnya).
  3. Ambil input volatilitas realized per aset (dari modul Technical / harga AaveOracle).
  4. Untuk setiap aset:
       signalsForAsset = signals yang assets[] memuat aset
       assessment = fuse(signalsForAsset, prior[aset], volInput[aset], now)
  5. Tulis satu baris risk_assessments per aset (modelVersion = FUSION_VERSION).
  6. (Opsional) kembalikan assessment ke pemanggil (worker) untuk notifikasi/log.
```

`fuse()` murni (tanpa I/O) agar bisa diuji dengan fixture. Langkah 1–3 & 5 adalah I/O di `run.ts`/`assessments.ts`.

### 3.3 Decay berdasarkan umur sinyal

Setiap sinyal punya `observedAt`, `expiresAt`, `horizonHours` (tabel `signals`). Bobot efektif sebuah sinyal pada waktu `now`:

```
effectiveWeight(signal, now) =
    moduleWeight[signal.module]        // bobot per module (§3.4)
  × clampConfidence(signal)            // confidence, RESEARCH/NEWS dijepit (§3.4)
  × signal.severity                    // 0..1
  × decayFactor(signal, now)           // peluruhan umur (0..1)

decayFactor(signal, now):
  jika now >= expiresAt → 0           // kedaluwarsa tidak dipakai (sudah difilter, tapi aman ganda)
  age   = now - observedAt
  life  = expiresAt - observedAt
  frac  = clamp(age / life, 0, 1)
  → exponensial: exp(-DECAY_LAMBDA × frac)   // DECAY_LAMBDA konstanta (fusion/config.ts)
```

Sinyal baru berbobot penuh; mendekati `expiresAt` bobotnya meluruh mulus (bukan jatuh mendadak). `DECAY_LAMBDA` berversi di `FUSION_VERSION`.

### 3.4 Bobot module & confidence

Konstanta di `fusion/config.ts` (nilai default awal, dikalibrasi lewat PR + backtest, PRD §6.4; **bukan** otomatis):

| Module | Bobot default | Catatan |
|--------|---------------|---------|
| `ORACLE` | tinggi | Konfirmasi on-chain langsung (sequencer, staleness, deviasi). |
| `ONCHAIN` | tinggi | Depeg, utilization, exploit terkonfirmasi on-chain. |
| `MACRO` | sedang | Event terjadwal (lihat aturan ELEVATED, §3.5). |
| `TECHNICAL` | sedang | Realized vol, funding, OI. |
| `NEWS` | rendah | Tak tepercaya sendirian; butuh konfirmasi (§3.5). |
| `RESEARCH` | rendah | Sama seperti NEWS (ADR 0004); confidence dijepit. |
| `SOCIAL` | sangat rendah | Sinyal paling bising. |

**Jepitan confidence:** `clampConfidence(signal)`:
- `RESEARCH`: `min(confidence, 0.6)` — batas keras ADR 0004 / spec m3 §3.3 (sumber kebenaran di research agents; fusion menegakkan ulang sebagai pertahanan berlapis).
- `NEWS`/`SOCIAL`: dijepit ke `NEWS_CONFIDENCE_CAP` (konstanta, mis. 0.6) agar konsisten dengan perlakuan "tak tepercaya" (PRD §6.2).
- Module terkonfirmasi (`ORACLE`/`ONCHAIN`/`MACRO`/`TECHNICAL`): tidak dijepit.

### 3.5 Aturan regime (tabel keputusan eksplisit)

`decideRegime(input)` menghasilkan **regime kandidat** dari aturan di bawah, lalu melewati guardrail dan hysteresis (§3.5.3). Setiap aturan punya nama agar bisa diuji satu per satu dan muncul di `reasons[]`.

#### 3.5.1 Aturan "lantai" (floor) berbasis kondisi keras

Dievaluasi atas sinyal aktif; mengambil **maksimum** regime di antara aturan yang menyala:

| Aturan | Kondisi | Floor regime | Sumber |
|--------|---------|--------------|--------|
| `R-MACRO-SOON` | Ada sinyal `MACRO` event terjadwal dengan `horizonHours < MACRO_SOON_HOURS` (default 12–24 jam) | **ELEVATED** | [PRD §6.3](../prd.md#63-risk-fusion) |
| `R-SEQUENCER-DOWN` | Ada sinyal `ORACLE` sequencer uptime = DOWN (jalur T10) | **STRESSED** | [Security S6](../security.md#3-temuan-terbuka) |
| `R-DEPEG-CONFIRMED` | Ada sinyal `ONCHAIN` depeg stablecoin terkonfirmasi on-chain (jalur T4); CRISIS bila deviasi melewati `DEPEG_CRISIS_BPS` | **STRESSED → CRISIS** | [PRD §6.3](../prd.md#63-risk-fusion), knowledge T4/T8 |
| `R-EXPLOIT-CONFIRMED` | Sinyal `ONCHAIN` insiden/exploit terkonfirmasi (jalur T9) + konfirmasi `NEWS` | **STRESSED** | knowledge T9 |
| `R-ORACLE-DEVIATION` | `ORACLE` deviasi tinggi vs pasar mendekati deviation threshold (T8) | **STRESSED** | PRD §6.1/§6.3 |

`MACRO_SOON_HOURS` dicatat sebagai rentang 12–24 jam di PRD; v1 memakai satu konstanta default (mis. 18 jam, sesuai fixture `scn-fomc-soon`) yang berversi dan dikalibrasi lewat PR.

#### 3.5.2 Aturan skor agregat (untuk ELEVATED/STRESSED/CRISIS "lunak")

Hitung `aggregateScore(asset)` = jumlah `effectiveWeight` seluruh sinyal `DOWN`/`VOLATILITY` untuk aset (§3.3), lalu petakan ke regime via ambang berversi:

| aggregateScore | Regime kandidat |
|----------------|-----------------|
| `< T_ELEVATED` | CALM |
| `[T_ELEVATED, T_STRESSED)` | ELEVATED |
| `[T_STRESSED, T_CRISIS)` | STRESSED |
| `>= T_CRISIS` | CRISIS |

Regime akhir sebelum guardrail = **maksimum** dari (floor §3.5.1, skor §3.5.2).

**Bobot kombinasi jalur:** bila sinyal menyala di ≥ `MULTI_PATH_MIN` jalur transmisi berbeda (knowledge §1: event terburuk = kombinasi T1+T3+T6), beri pengali `MULTI_PATH_BONUS` pada `aggregateScore`.

#### 3.5.3 GUARDRAIL konfirmasi (invariant utama)

> **Sinyal `RESEARCH` dan/atau `NEWS` SENDIRIAN tidak boleh menaikkan regime ke `STRESSED` atau `CRISIS`** tanpa konfirmasi dari minimal satu sinyal `ORACLE`, `ONCHAIN`, atau `MACRO` yang searah (PRD §6.2/§6.6, ADR 0004, spec m3 §3.3, Security §2.3).

Implementasi: setelah regime kandidat dihitung, jika kandidat ≥ `STRESSED` **dan** satu-satunya kontributor yang mengangkatnya adalah `RESEARCH`/`NEWS`/`SOCIAL` (tidak ada `ORACLE`/`ONCHAIN`/`MACRO`/`TECHNICAL` searah di `drivers`), regime **diturunkan paksa ke `ELEVATED`** dan dicatat alasan `GUARDRAIL-RESEARCH-UNCONFIRMED`. Guardrail ini diuji dengan property test (§6).

> `TECHNICAL` dianggap konfirmasi "pasar" (PRD §6.2: "konfirmasi dari pergerakan pasar"); depeg/sequencer tetap butuh `ONCHAIN`/`ORACLE`.

#### 3.5.4 Hysteresis (naik cepat, turun lambat)

Agar regime tidak bolak-balik (PRD §6.3, §12 "waktu di regime ≥ STRESSED"):
- **Naik** (regime baru > prior): berlaku **segera**.
- **Turun** (regime baru < prior): hanya diterapkan bila kondisi "lebih tenang" bertahan selama `HYSTERESIS_COOLDOWN_MIN` sejak `prior.createdAt`, **dan** `aggregateScore` turun di bawah ambang regime saat ini dikurangi margin `HYSTERESIS_MARGIN`. Jika belum, pertahankan regime prior dan catat `HYSTERESIS-HOLD`.
- Prior diambil dari assessment terakhir per aset (`risk_assessments`); bila tak ada prior → tanpa penahanan.

Semua konstanta hysteresis berversi di `FUSION_VERSION`.

### 3.6 Drawdown, HF, dan target

**Drawdown (`fusion/drawdown.ts`):**
- Input: **realized volatility** per aset dihitung dari deret harga **`AaveOracle.getAssetPrice(asset)`** (I5; bukan Chainlink proxy langsung — PRD §4.3). Data yang perlu dikumpulkan (oleh modul Technical / pengumpul harga, di luar spec ini tetapi disebut sebagai dependensi):
  - Snapshot harga AaveOracle per aset pada interval tetap (mis. tiap blok/menit), disimpan agar bisa dihitung return log dan EWMA volatility.
  - Minimal jendela untuk EWMA (mis. ~N sampel) dan penanda data cukup/tidak (bila kurang → lihat degradasi §4).
- Estimasi drawdown kuantil tinggi (p99, PRD §4.2) untuk horizon h4 & h24:
  ```
  sigma_h  = realizedVolPerHour × sqrt(h)            // scaling akar waktu
  d_h      = z99 × sigma_h × regimeMultiplier[regime]  // z99 ≈ 2.33 (konstanta)
  d_h      = clamp(d_h, 0, D_MAX)                     // D_MAX < 1 agar hfRequired aman
  ```
  `regimeMultiplier` (konstanta berversi) menaikkan drawdown saat regime naik (CALM→CRISIS), mencerminkan fat tail yang tak tertangkap volatilitas tenang.
- Untuk pasangan berkorelasi (wstETH/ETH, PRD §4.2) v1 boleh memodelkan rasio bila data rasio tersedia; bila tidak, pakai volatilitas USD aset collateral dan catat keterbatasan di `explanation` (pertanyaan terbuka §7).

**HF rekomendasi (`fuse.ts`):**
```
recommendedTriggerHF = hfRequired(d_reaction)      // helper @tahansoe/domain/hf.ts
  d_reaction = d pada horizon = waktu reaksi keeper + margin
               (v1 pakai h4 sebagai proksi horizon reaksi; berversi)
recommendedTargetHF  = recommendedTriggerHF + TARGET_BUFFER   // mis. +0.3, berversi
```
- **Fusion TIDAK meng-clamp** `recommendedTriggerHF` ke band user. Clamp ke band (`clampTrigger`, default 1.25–1.60) dilakukan **rule engine** (PRD §7.3, helper `clampTrigger` sudah ada). Ini menjaga pemisahan "fusion merekomendasikan, rule engine memutuskan" (Security I3).
- `riskScore` (0..100): fungsi monotonik dari `aggregateScore` + regime (mis. normalisasi ambang regime ke 0–100), untuk ditampilkan di dashboard.

### 3.7 Output: tabel `risk_assessments`

Tabel baru di `packages/db` (konvensi `research.ts`/`schema.ts`: `uuid` pk, `timestamp withTimezone`, `jsonb`, `numeric(precision, scale)`, indeks eksplisit). Catatan: `riskSettlements.riskAssessmentId` di `research.ts` **sudah** mereferensikan assessment ini — jadikan FK saat tabel dibuat.

| Kolom | Tipe | Keterangan |
|-------|------|------------|
| `id` | `uuid` pk default random | |
| `chain_id` | `integer` not null | Per chain (architecture §5). |
| `asset` | `text` not null | Simbol aset, mis. `"ETH"`. |
| `regime` | `regime` enum (`regimeEnum`) baru: CALM/ELEVATED/STRESSED/CRISIS | Pakai enum baru agar konsisten dengan `@tahansoe/domain` REGIMES. |
| `risk_score` | `numeric(5,2)` not null | 0..100. |
| `drawdown_h4` | `numeric(6,5)` not null | fraksi 0..1. |
| `drawdown_h24` | `numeric(6,5)` not null | fraksi 0..1. |
| `recommended_trigger_hf` | `numeric(6,4)` not null | sebelum clamp band user. |
| `recommended_target_hf` | `numeric(6,4)` not null | |
| `drivers` | `jsonb` not null | Array sinyal paling berpengaruh (ringkas: id, module, severity, confidence, paths). |
| `reasons` | `jsonb` not null | Nama aturan yang menyala (mis. `["R-MACRO-SOON","HYSTERESIS-HOLD"]`) — audit & test. |
| `explanation` | `text` not null | Ringkasan English untuk user (G6). |
| `model_version` | `text` not null | = `FUSION_VERSION` (versi aturan). |
| `valid_until` | `timestamp tz` not null | `createdAt + ASSESSMENT_TTL` (mis. ≤ interval worker + margin). |
| `created_at` | `timestamp tz` not null default now | |

Indeks: `(chain_id, asset)`, `valid_until`, `created_at` (ambil "terbaru per aset"). **Satu baris per aset per run** (append-only; "assessment aktif" = baris terbaru dengan `valid_until > now`). Migrasi ditambahkan ke `packages/db/scripts/migrate.ts` (idempotent, seperti tabel lain) saat implementasi.

### 3.8 Jadwal & integrasi worker

- **Setelah setiap research run:** research-worker (`apps/engine/src/worker/research-worker.ts`) memanggil fusion untuk aset yang dipantau, segera setelah sinyal `RESEARCH` tertulis, sehingga assessment mencerminkan hasil riset terbaru.
- **Tiap N menit:** fusion juga dijalankan terjadwal (tidak hanya saat ada research run) agar decay/hysteresis/validUntil tetap segar meski tidak ada riset baru. Interval memakai mekanisme yang sama dengan `schedule.ts` (regime-adaptif) atau konstanta `FUSION_INTERVAL_MIN` tersendiri — ditetapkan saat implementasi; spec ini **tidak mengubah** penjadwalan research yang ada.
- Integrasi dilakukan dengan **menambahkan pemanggilan** `fusion/run.ts` dari worker, tanpa mengubah perilaku research-worker yang sudah dites (`test/worker/worker.test.ts`). Fusion yang gagal/kosong tidak boleh mematikan worker (degradasi §4).

### 3.9 Konsumen: rule engine & settlement (antarmuka saja)

- **Rule engine (PRD §7.2):** membaca assessment aktif terbaru per `(chainId, asset)`; memakai `recommendedTriggerHF`/`recommendedTargetHF`, lalu **clamp ke band user** dan menerbitkan `Intent` dengan `riskAssessmentId` sebagai jejak. Jika tak ada assessment valid → fallback policy statis (I6). *Di luar scope implementasi spec ini; hanya kontrak baca.*
- **Settlement (ADR 0005):** setelah `validUntil`/horizon, settlement melabeli assessment `TRUE_POSITIVE`/`FALSE_POSITIVE`/`MISSED`/`TRUE_NEGATIVE` + lead time ke `risk_settlements.riskAssessmentId` (kolom sudah ada). Fusion hanya perlu memastikan `risk_assessments` punya `id`, `created_at`, `valid_until`, `regime`, dan `model_version` yang stabil agar bisa dinilai & dihitung ulang. *Implementasi settlement di luar scope.*

## 4. Dampak keamanan

Jawaban checklist [security.md §4](../security.md#4-checklist-review-keamanan) untuk Risk Fusion v1:

1. **Jalur baru token berpindah? Ke mana? (I1)** — Tidak ada. Fusion murni membaca `signals` dan menulis `risk_assessments`; tidak menyentuh wallet, allowance, atau kontrak. Tidak ada transfer dana.
2. **Role/admin/upgrade baru? (I2)** — Tidak ada. Fusion adalah proses engine stateless-per-run; tanpa owner/admin/kemampuan upgrade on-chain.
3. **Output AI memengaruhi sesuatu selain trigger dalam band? (I3)** — Tidak. Output fusion adalah `RiskAssessment` (data). Satu-satunya efek hilir adalah **rekomendasi** trigger yang di-clamp ke band user **oleh rule engine** (bukan fusion). Fusion tidak menandatangani apa pun. Guardrail §3.5.3 memastikan sinyal AI (`RESEARCH`) tidak bisa sendirian mengangkat regime.
4. **Jika komponen dikompromi, dampak terburuk? (I4)** — Fusion menghasilkan assessment menyimpang (regime/trigger terlalu tinggi/rendah). Terburuk: rule engine menaikkan trigger hingga **batas atas band user** → utang user dibayar lebih awal (biaya peluang), bukan kehilangan dana. `riskScore` keliru tidak bisa memindahkan dana. Jepitan confidence & guardrail membatasi dampak sinyal tak tepercaya.
5. **Sumber harga untuk keputusan eksekusi? (I5)** — Volatilitas/drawdown dihitung dari **`AaveOracle.getAssetPrice`** (oracle protokol target), bukan proxy Chainlink langsung atau CEX/DEX. Sumber non-protokol hanya menjadi sinyal peringatan dini di modul lain, tidak masuk perhitungan HF.
6. **Jika mati atau data basi? (I6 — graceful degradation)** — **Tanpa sinyal valid → tidak ada assessment baru.** Assessment lama kedaluwarsa lewat `validUntil`; rule engine lalu memakai **policy statis user**. Fusion yang gagal tidak mematikan worker dan tidak menulis assessment "palsu". Data volatilitas tak cukup → drawdown konservatif/berbasis regime + catatan di `explanation`, atau tidak menerbitkan assessment untuk aset itu.
7. **User tetap bisa menghentikan semuanya? (I7)** — Ya. Fusion tidak memengaruhi `disablePolicy`, pencabutan allowance, atau pencabutan risk agent (semuanya on-chain, kontrak Guardian). Mematikan engine/kill switch hanya menyebabkan fallback statis.
8. **Secret ter-commit/ter-bundle? (I8)** — Tidak. Fusion server-only (engine), tanpa secret baru; `DATABASE_URL` dari env (tidak di-log). Tidak ada nilai sensitif di `risk_assessments`.
9. **Input eksternal divalidasi & diperlakukan sebagai data?** — `signals` divalidasi saat ditulis (modul masing-masing); fusion memvalidasi bentuk sinyal yang dibaca (angka terhingga, `expiresAt > observedAt`) dan **mengabaikan** sinyal cacat alih-alih crash. Konten evidence (judul/url) hanya disalin ke `drivers`/`explanation` sebagai teks, tidak pernah dieksekusi sebagai instruksi.

## 5. Kriteria penerimaan

- [ ] `decideRegime` menerapkan setiap aturan floor §3.5.1 dengan benar: `R-MACRO-SOON` → ≥ ELEVATED; `R-SEQUENCER-DOWN` → ≥ STRESSED; `R-DEPEG-CONFIRMED` → ≥ STRESSED (dan CRISIS bila melewati `DEPEG_CRISIS_BPS`).
- [ ] **Guardrail §3.5.3** terbukti: himpunan sinyal yang hanya berisi `RESEARCH`/`NEWS`/`SOCIAL` **tidak pernah** menghasilkan regime > ELEVATED (property test).
- [ ] Jepitan confidence: sinyal `RESEARCH` dengan `confidence > 0.6` diperlakukan sebagai 0.6 dalam `effectiveWeight` (unit test).
- [ ] Decay: sinyal identik yang lebih tua memberi `effectiveWeight` lebih kecil; sinyal `now >= expiresAt` berbobot 0 (unit test).
- [ ] Hysteresis: regime naik segera; regime turun tertahan hingga `HYSTERESIS_COOLDOWN_MIN` + margin terpenuhi (unit test dengan prior assessment).
- [ ] `estimateDrawdown` menghasilkan h4 ≤ h24 (scaling akar waktu) dan `recommendedTriggerHF == hfRequired(d_reaction)` sesuai PRD §4.2 (contoh: d=0.25 → ~1.33).
- [ ] Fusion **tidak** meng-clamp ke band user (nilai `recommendedTriggerHF` bisa di luar 1.25–1.60); clamp tetap tanggung jawab rule engine.
- [ ] `fuse()` murni & deterministik: input sama → output sama (kecuali `createdAt`), tanpa I/O.
- [ ] Tabel `risk_assessments` dibuat lewat migrasi idempotent; satu baris per aset per run; `model_version == FUSION_VERSION`; `valid_until > created_at`.
- [ ] Degradasi: tanpa sinyal valid → tidak ada assessment ditulis; worker tetap hidup (I6).
- [ ] **Replay scenarios:** menjalankan `fuse()` atas fixture dari [`test/eval/cases/scenarios.ts`](../../apps/engine/test/eval/cases/scenarios.ts) memenuhi batas `regimeAtLeast`/`regimeAtMost` tiap kasus (lihat §6).

## 6. Rencana test

Semua test offline/deterministik (tanpa jaringan/DB nyata); dijalankan via `tsx --test` dan didaftarkan di `apps/engine/test/all.test.ts` (koordinator yang memasang import bila konvensi itu berlaku).

1. **Unit per aturan (`test/fusion/regime.test.ts`):** satu test per aturan floor (§3.5.1) dan per batas skor (§3.5.2), masing-masing dengan himpunan sinyal minimal yang menyalakannya; verifikasi `regime` dan `reasons[]`.
2. **Property test guardrail (`test/fusion/guardrail.test.ts`):** hasilkan himpunan acak sinyal yang **hanya** `RESEARCH`/`NEWS`/`SOCIAL` dengan severity/confidence acak; assert regime hasil **selalu** ≤ ELEVATED. Tambah kasus positif: menambahkan satu sinyal `ONCHAIN`/`ORACLE` searah membolehkan ≥ STRESSED.
3. **Unit decay (`test/fusion/decay.test.ts`):** monotonisitas terhadap umur; batas `expiresAt` → 0; `DECAY_LAMBDA` dihormati.
4. **Unit drawdown & HF (`test/fusion/drawdown.test.ts`):** scaling akar waktu (h4 vs h24), multiplier regime, clamp `D_MAX`, dan `recommendedTriggerHF == hfRequired(d)` memakai helper domain (bandingkan dengan contoh PRD §4.2).
5. **Unit hysteresis (`test/fusion/hysteresis.test.ts`):** naik segera; turun tertahan; `HYSTERESIS-HOLD` muncul di `reasons`.
6. **Replay skenario (`test/fusion/scenarios-replay.test.ts`):** impor `scenarioCases` dari `test/eval/cases/scenarios.ts` sebagai **fixture**; untuk tiap kasus, ubah `inputs` (marketEvents/macroEvents/signals/chainNotes) menjadi himpunan `Signal` yang setara (adapter test kecil), jalankan `fuse()`, dan assert `regime` memenuhi `expect.regimeAtLeast`/`regimeAtMost`. Ini menyelaraskan fusion dengan ekspektasi regime yang sudah disepakati eval (≥ 70% kesesuaian, spec m3 §3.4).
7. **Degradasi (`test/fusion/degrade.test.ts`):** input kosong / semua kedaluwarsa → tidak ada assessment; input volatilitas kurang → drawdown konservatif + catatan.
8. **(Integrasi ringan, opsional)** `fusion/run.ts` dengan DB/dependensi yang di-mock (seperti pola `test/worker`) untuk memverifikasi penulisan satu baris per aset dan `valid_until`.

## 7. Pertanyaan terbuka

- **Horizon reaksi untuk `recommendedTriggerHF`:** v1 memakai `h4` sebagai proksi "waktu reaksi keeper + margin". Apakah perlu horizon eksplisit yang mempertimbangkan latensi keeper per chain (PRD §4.2)?
- **Pasangan berkorelasi (wstETH/ETH):** v1 memodelkan rasio hanya bila data rasio tersedia; kapan rasio menjadi wajib, dan dari sumber on-chain mana (I5)?
- **Granularitas assessment:** per aset (spec ini) vs per posisi (PRD §14 "threshold & band per-posisi atau global"). Fusion v1 per aset; apakah rule engine cukup memetakan aset→posisi, atau fusion perlu konteks posisi?
- **Kalibrasi ambang & multiplier:** nilai awal `T_ELEVATED/T_STRESSED/T_CRISIS`, `regimeMultiplier`, `DECAY_LAMBDA`, `HYSTERESIS_*` ditetapkan dari backtest mana (PRD §6.4)? Perlu set data periode tenang untuk mengukur false positive (< 5%, PRD §12).
- **`MACRO_SOON_HOURS`:** PRD menyebut rentang 12–24 jam; nilai default tunggal v1 (18 jam) perlu konfirmasi vs fixture (`scn-token-unlock` 12 jam, `scn-fomc-soon` 18 jam).
- **Interval fusion terjadwal:** memakai `schedule.ts` (regime-adaptif) atau `FUSION_INTERVAL_MIN` tersendiri? Dampak biaya DB/compute vs kesegaran `validUntil`.
- **Normalisasi `riskScore`:** pemetaan `aggregateScore`→0..100 agar stabil lintas aset dengan jumlah sinyal berbeda.

### Keputusan atas pertanyaan terbuka (2026-10-09)

| Pertanyaan | Keputusan |
|------------|-----------|
| Granularitas | Per aset; rule engine memetakan aset → posisi |
| `MACRO_SOON_HOURS` | 18 jam |
| Interval fusion terjadwal | Setelah setiap research run + tiap 15 menit (`FUSION_INTERVAL_MIN`) |
| Horizon reaksi trigger HF | `h4` di v1; latensi keeper per chain di v2 |
| Pasangan berkorelasi (wstETH/ETH) | Ditunda sampai posisi LST didukung |
| Kalibrasi ambang & multiplier | Nilai awal di `fusion/config.ts`; kalibrasi lewat backtest setelah `price_samples` terkumpul beberapa hari |
| Normalisasi `riskScore` | Ikuti usulan spec; disetel lewat eval skenario |


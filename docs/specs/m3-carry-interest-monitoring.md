# Spec: Carry & Interest-Rate Monitoring (jalur T11)

- **Milestone:** M3 — "Fundamental/on-chain module (utilization, …)" ([PRD §10](../prd.md#10-roadmap-eksekusi))
- **Status:** Done (2026-10-09)
- **Pemilik:** Antigravity / Kiro (implementasi), Claude Code (review)
- **Terkait:** [risk-transmission](../knowledge/risk-transmission.md), [m2-risk-fusion-v1](m2-risk-fusion-v1.md), [m3-research-agents](m3-research-agents.md), [m3-cli](m3-cli.md), PRD §11 (Non-Goals)

> **Catatan Implementasi (2026-10-09, commit 10a49e6):**
> - Jalur transmisi T11 (bunga & carry) diintegrasikan ke `@tahansoe/domain`, Zod schema, emitter sinyal deterministik di `src/signals/emit.ts`, CLI, dan knowledge base.
> - Tabel `rate_samples` di `packages/db` mencatat supply APY, borrow APR variable, utilization, dan kurva suku bunga reserve Aave V3 Arbitrum.
> - Command `tahansoe carry` tersedia untuk melihat borrow rate, carry drift representatif, dan peringatan kink proximity tanpa ranking yield.

## 1. Tujuan

Posisi borrow bisa mendekati likuidasi **tanpa harga bergerak sama sekali**. Utang bertambah sesuai bunga borrow, sedangkan collateral hanya bertambah sesuai supply APY. Jika bunga borrow lebih tinggi dari supply APY (carry negatif), HF turun pelan setiap hari. Saat utilization pool melewati titik optimal (kink), bunga borrow bisa melonjak berkali lipat dalam hitungan jam, dan HF turun lebih cepat.

Fitur ini memantau carry dan bunga di Aave V3 Arbitrum, lalu memberi peringatan dini berbasis risiko: "dengan bunga sekarang, HF posisi seperti ini turun X dalam 30 hari".

Sesuai positioning Tahansoe: **membantu user bertahan lama di market, bukan mencari yield tertinggi.**

## 2. Scope

**Termasuk:**
- Jalur transmisi baru **T11 — Bunga & carry** (borrow APR melonjak / carry negatif → HF turun tanpa pergerakan harga).
- Sampler on-chain bunga per reserve Aave V3 (supply APY, borrow APR variable, utilization, parameter kurva bunga: optimal usage ratio, slope1, slope2).
- Sinyal deterministik modul `ONCHAIN` untuk T11 (dan T7 bila utilization ≈ 100%).
- Konteks bunga untuk analyst on-chain di research agent.
- Command `tahansoe carry` (informasi risiko, bukan ranking yield).

**Tidak termasuk (Non-Goals, PRD §11):**
- Ranking "yield terbaik", saran pindah aset/collateral, strategi leverage, atau looping.
- Membaca posisi user asli (menunggu `AaveAdapter` M1). v1 memakai **posisi representatif** (lihat §3.4).
- Aksi on-chain apa pun.

## 3. Desain

### 3.1 Jalur T11 (domain)

Tambah `T11` ke `TransmissionPath` di `@tahansoe/domain`, ke schema zod research (`TransmissionPathSchema`), ke label CLI, dan ke tabel di `docs/knowledge/risk-transmission.md`:

| # | Jalur | Mekanisme | Yang dirasakan posisi | Modul sinyal |
|---|-------|-----------|------------------------|--------------|
| T11 | **Bunga & carry** | Utilization naik melewati kink → borrow APR melonjak; atau borrow APR > supply APY collateral | HF turun pelan tanpa harga bergerak; makin cepat saat bunga melonjak | On-chain (rate) |

### 3.2 Data: `rate_samples`

Sumber utama **on-chain** (Aave V3 Pool + `AaveProtocolDataProvider` di Arbitrum One, alamat dari `@tahansoe/domain` chain registry), dibaca dengan viem. Tabel baru di `packages/db`:

| Kolom | Tipe | Catatan |
|-------|------|---------|
| `id` | uuid | |
| `chain_id` | int | |
| `asset` | text | simbol reserve (WETH, wstETH, USDC, USDT, WBTC, ARB, …) |
| `supply_apy` | numeric | dari `liquidityRate` (ray), dikonversi ke APY |
| `borrow_apr` | numeric | dari `variableBorrowRate` (ray) |
| `utilization` | numeric | totalDebt / (totalDebt + availableLiquidity) |
| `optimal_utilization` | numeric | dari strategy (`OPTIMAL_USAGE_RATIO`) |
| `slope2` | numeric | kemiringan setelah kink, untuk menghitung lonjakan |
| `sampled_at` | timestamptz | |

Sampler menempel di price worker (`worker:price` / `schedule run --with-price`), dengan interval sendiri `RATE_SAMPLE_INTERVAL_MIN` (default 15). DefiLlama Yields (gratis) **hanya** sebagai pembanding/peringatan selisih data, bukan sumber utama (I5).

### 3.3 Sinyal deterministik T11 (modul `ONCHAIN`)

Dihitung tiap fusion tick dari `rate_samples` terbaru dan 24 jam terakhir:

- **Kink proximity:** `utilization ≥ optimal_utilization` → severity naik linear sampai 1.0 di utilization 100%. Utilization ≥ 98% juga memancarkan **T7** (likuiditas reserve kering).
- **Rate spike:** `borrow_apr` naik ≥ 2× dalam 24 jam atau melewati ambang absolut (mis. 20% APR untuk stablecoin) → severity tinggi.
- **Negative carry** untuk pasangan representatif (§3.4): `borrow_apr(debt) − supply_apy(collateral) > 0` → severity kecil, sebanding dengan laju penurunan HF.
- Regime: T11 sendirian maksimal **ELEVATED**. STRESSED hanya bila disertai T7 (utilization ≈ 100%) atau konfirmasi lain. Semua ambang berversi di `src/fusion/config.ts`.

### 3.4 Perhitungan HF drift (posisi representatif)

Dengan bunga kontinu, `HF(t) = HF0 · exp((s − b) · t)`, dengan `s` = supply APY collateral dan `b` = borrow APR utang. Waktu sampai HF turun dari `H0` ke `H1`:

```
t = ln(H0 / H1) / (b − s)        (hanya bila b > s)
```

v1 menampilkan pasangan umum di Aave Arbitrum (collateral → utang): WETH→USDC, wstETH→USDC, WETH→USDT, WBTC→USDC, wstETH→WETH. Output: "HF 1.50 → 1.45 dalam N hari pada bunga sekarang", plus skenario "jika borrow APR naik ke tingkat pasca-kink". Setelah `AaveAdapter` (M1) ada, perhitungan yang sama dipakai untuk posisi user asli.

### 3.5 Research agent

`collect.ts` menambahkan ringkasan bunga ke konteks (data terukur, bukan teks eksternal). Prompt analyst on-chain (English) diberi panduan T11: utilization dekat kink, lonjakan bunga, carry negatif. Assessor boleh menyebut T11. Tidak ada perubahan pada cap confidence.

### 3.6 CLI: `tahansoe carry`

```
 ▲ TAHANSOE  carry & interest · Aave V3 Arbitrum One
 Reserve   Supply APY  Borrow APR  Util / kink    Status
 USDC        4.1%        5.6%      88% / 90%      ▲ near kink
 WETH        1.9%        2.7%      71% / 80%      ok
 Pair (coll → debt)   Net carry   HF 1.50 → 1.45
 wstETH → USDC         −2.4%/yr    ≈ 520 days
 WETH → USDC           −3.7%/yr    ≈ 335 days
 if USDC passes kink (≈ 40% APR) → ≈ 30 days
 informational · not investment advice
```

Tanpa kata "best", "recommend", "switch to". `--json` tersedia.

## 4. Dampak keamanan

- I1/I2: hanya baca on-chain dan tulis tabel; tidak ada transfer, tanpa key.
- I5: sumber eksekusi tetap AaveOracle; bunga dibaca dari kontrak Aave yang sama dengan protokol target. DefiLlama hanya pembanding.
- Non-Goals: tidak ada ranking yield atau saran pindah aset (dicek di review dan test teks output).
- I8: RPC dari env, tidak dicetak penuh.

## 5. Kriteria penerimaan

- [x] `T11` ada di domain, schema research, fusion config, knowledge doc, dan label CLI; test lama tetap hijau.
- [x] `rate_samples` terisi tiap interval pada research-dev; konversi ray → APY/APR teruji terhadap nilai yang tampil di app Aave (selisih < 0,1 poin).
- [x] Sinyal T11/T7 terpancar sesuai ambang; T11 sendirian tidak pernah > ELEVATED (property test).
- [x] `tahansoe carry` menampilkan tabel reserve dan HF drift; output tidak mengandung kata ranking/saran investasi (test).
- [x] Analyst on-chain menerima konteks bunga; eval tetap lolos (0 injection leak, skenario ≥ 70%).

## 6. Rencana test

Unit: konversi ray, rumus HF drift, ambang sinyal, property test cap regime, teks output CLI. Integrasi: sampler dengan RPC mock dan satu run live terhadap Arbitrum One. Eval: tambah 1 skenario "utilization USDC melewati kink" (harapan ≥ ELEVATED, T11).

## 7. Keputusan

| Pertanyaan | Keputusan |
|------------|-----------|
| Pasangan representatif v1 | WETH→USDC, wstETH→USDC, WETH→USDT, WBTC→USDC, wstETH→WETH |
| Ambang lonjakan bunga stablecoin | Naik ≥ 2× dibanding 24 jam lalu **atau** borrow APR > 20% |
| Interval sampler bunga | 15 menit (`RATE_SAMPLE_INTERVAL_MIN`), terpisah dari sampler harga |

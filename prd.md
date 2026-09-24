# Tahansoe — Product Requirements Document

**Version:** 0.1 (Draft)
**Last updated:** 19 Agustus 2026
**Owner:** Rakyavara Artomily (@rakaalts)
**Status:** Pre-development

---

## 1. Ringkasan

Tahansoe adalah **liquidation risk automation agent** untuk posisi borrow di protokol lending on-chain (Aave V3, Morpho). Tahansoe memantau Health Factor (HF) posisi user secara terus-menerus dan mengeksekusi aksi remediasi otomatis — repay, top-up collateral, atau deleverage — sebelum posisi mencapai ambang likuidasi.

Tahansoe bersifat **non-custodial**. Dana user tidak pernah berpindah ke kustodi Tahansoe. Eksekusi dilakukan lewat module dengan scope terbatas yang di-approve user.

### Positioning statement

> Tahansoe adalah risk automation, **bukan** jaminan anti-likuidasi.

Framing ini wajib konsisten di seluruh produk, dokumentasi, dan materi marketing. Lihat §9 (Non-Goals) dan §11 (Risk Disclosure).

---

## 2. Problem Statement

User yang meminjam stablecoin (USDT/USDC) dengan collateral volatil (ETH, WBTC, LST) menghadapi tiga masalah:

1. **Monitoring 24/7 tidak realistis.** Pasar crypto tidak tidur; user tidur.
2. **Reaksi manual terlalu lambat.** Saat user sadar HF turun, liquidator MEV bot sudah lebih dulu.
3. **Likuidasi mahal.** Penalti likuidasi Aave V3 berkisar 5–10% dari posisi yang dilikuidasi — kerugian yang sepenuhnya dapat dihindari dengan intervensi lebih awal.

Solusi eksisting umumnya berupa notifikasi (DeFi Saver alerts, Hypernative) yang tetap menuntut aksi manual, atau automation yang menuntut kustodi.

---

## 3. Goals

| # | Goal | Metrik keberhasilan |
|---|------|---------------------|
| G1 | Deteksi penurunan HF secara andal | Deteksi < 1 block setelah harga oracle update |
| G2 | Eksekusi remediasi otomatis | HF pulih di atas target buffer dalam 1 transaksi |
| G3 | Non-custodial | Dana user tidak pernah dapat ditransfer keluar oleh Tahansoe |
| G4 | Multi-protokol | Aave V3 + Morpho Blue dengan interface adapter terpadu |
| G5 | Bekerja tanpa modal cadangan | Flash loan fallback untuk user tanpa reserve |

---

## 4. Konsep Inti & Klarifikasi

**Tahansoe tidak mengendalikan harga.** Harga collateral ditentukan pasar global. Oracle hanyalah *sumber data* untuk mengetahui kapan posisi berbahaya, bukan alat untuk menjaga harga.

Yang dijaga Tahansoe adalah **Health Factor**:

```
HF = (Σ collateral × liquidationThreshold) / totalDebt
HF < 1.0 → posisi dapat dilikuidasi
```

Tahansoe bertindak pada `HF < triggerThreshold` (default 1.30), memulihkan ke `targetHF` (default 1.60).

**Aturan oracle kritis:** Tahansoe WAJIB membaca oracle yang sama persis dengan yang digunakan protokol target. Aave V3 menggunakan Chainlink Data Feeds. Membaca harga dari sumber lain (CEX, DEX spot) berisiko menghasilkan divergensi akibat deviation threshold dan heartbeat, sehingga deteksi terlambat.

---

## 5. Arsitektur

```
┌──────────────────────────────────────────────────────┐
│ LAYER 1 — DATA                                       │
│ Chainlink Data Feeds (harga)                         │
│ Protocol Adapters (posisi)                           │
└──────────────────────────────────────────────────────┘
                        ↓
┌──────────────────────────────────────────────────────┐
│ LAYER 2 — POLICY (deterministik)                     │
│ Rule Engine → menghasilkan Intent                    │
└──────────────────────────────────────────────────────┘
                        ↓
┌──────────────────────────────────────────────────────┐
│ LAYER 3 — TRIGGER                                    │
│ checkUpkeep() / performUpkeep()                      │
│ Dev: cron + viem │ Prod: Chainlink Automation        │
└──────────────────────────────────────────────────────┘
                        ↓
┌──────────────────────────────────────────────────────┐
│ LAYER 4 — EXECUTION                                  │
│ Guardian Module (Safe Module, scope terbatas)        │
│ → Aave.repay() / supply() / flashLoan()              │
└──────────────────────────────────────────────────────┘
```

### 5.1 Prinsip arsitektur

**LLM authoring, deterministic execution.**
LLM tidak pernah menandatangani atau memicu transaksi. LLM hanya menerjemahkan niat user (bahasa natural) menjadi parameter policy, yang harus dikonfirmasi user sebelum di-commit. Eksekusi live sepenuhnya dijalankan rule engine deterministik.

**Trigger-agnostic.**
Kontrak Guardian mengekspos interface `checkUpkeep()` / `performUpkeep()` sejak awal. Selama pengembangan dipanggil dari cron; migrasi ke Chainlink Automation tidak memerlukan perubahan kode.

**Intent vs execution.**
Rule engine mengeluarkan objek Intent terstruktur, bukan transaksi langsung. Ini memungkinkan dry-run, simulasi, dan audit trail.

---

## 6. Komponen

### 6.1 Protocol Adapter (Prioritas 1)

Interface ternormalisasi lintas protokol:

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
  readPosition(user: Address): Promise<Position[]>;
  buildRepay(intent: Intent): Promise<Call>;
  buildSupply(intent: Intent): Promise<Call>;
}
```

**Perbedaan semantik yang harus ditangani:**

| Protokol | Model risiko |
|----------|--------------|
| Aave V3 | HF agregat lintas seluruh aset, satu angka per user |
| Morpho Blue | Isolated per market; setiap pasangan collateral/loan punya LLTV sendiri |
| Morpho Vaults | User adalah supplier, bukan borrower — **tidak ada likuidasi**, di luar scope |

Bangun `AaveAdapter` sampai benar sebelum menyentuh `MorphoAdapter`. Jangan hardcode logika Aave lalu menempelkan Morpho belakangan.

### 6.2 Rule Engine (Prioritas 2)

Deterministik, tanpa AI pada fase awal. Output berupa Intent:

```ts
interface Intent {
  action: "REPAY" | "SUPPLY_COLLATERAL" | "DELEVERAGE" | "NOOP";
  amount: bigint;
  asset: Address;
  source: "HOT_RESERVE" | "WARM_RESERVE" | "FLASH_LOAN";
  targetHealthFactor: bigint;
  reason: string;
  estimatedGas: bigint;
  estimatedSlippageBps: number;
}
```

### 6.3 Guardian Module (Prioritas 3)

Safe Module dengan **allowlist ketat**:

| Diizinkan | Dilarang |
|-----------|----------|
| `Aave.repay()` | `transfer()` / `transferFrom()` ke alamat arbitrer |
| `Aave.supply()` | `approve()` tak terbatas ke alamat baru |
| `Morpho.repay()` | Perubahan owner/module Safe |
| Swap via router allowlist | Withdraw ke luar Safe |

Invariant keamanan: **kompromi terhadap Tahansoe tidak boleh memungkinkan penarikan dana user.** Skenario terburuk yang dapat dilakukan attacker adalah membayar utang user.

### 6.4 Funding Sources

| Sumber | Butuh modal | Trade-off |
|--------|-------------|-----------|
| Hot reserve | Ya (10–20%) | Instan, tapi modal idle |
| Warm reserve | Ya | Ada yield, tapi latensi penarikan |
| Deleverage | Tidak | Memaksa realize loss + slippage |
| Flash loan | Tidak | Fee ~0.05%, atomic, tetap menjual collateral |

**Default:** flash loan sebagai fallback universal; reserve digunakan bila tersedia.

**Correlation risk (kritis):** Jika reserve ditempatkan di venue yang sama dengan posisi yang dijaga, saat market crash utilization dapat mendekati 100% sehingga penarikan gagal **persis saat paling dibutuhkan**. Reserve harus ditempatkan di venue berbeda. Untuk Morpho (ERC-4626), selalu cek `maxWithdraw()` sebelum mengasumsikan likuiditas tersedia.

### 6.5 AI Layer (Fase akhir — hanya dua fitur)

1. **Threshold dinamis.** Model volatilitas (GARCH / GBM / LSTM) menyesuaikan buffer: pasar tenang → 1.15; volatilitas naik → 1.40 secara preemptif.
2. **Natural language config.** User menyatakan niat ("jaga posisiku konservatif, tahan drop 30%"), LLM menerjemahkan ke parameter policy, user mengonfirmasi sebelum commit.

Fitur AI di luar dua ini tidak masuk v1.

---

## 7. Keputusan Terkunci

| Keputusan | Pilihan | Alasan |
|-----------|---------|--------|
| Chain | Base (opsi: Arbitrum) | Gas murah; Aave V3 dan Morpho keduanya tersedia |
| Custody | Non-custodial | Menghindari risiko kustodian, hukum, dan single point of failure |
| Funding default | Flash loan fallback | Produk tetap berfungsi untuk user tanpa reserve |
| Trigger (dev) | Cron + viem | Iterasi cepat, debugging mudah |
| Trigger (prod) | Chainlink Automation | Tidak ada SPOF, narasi terdesentralisasi |
| Oracle | Chainlink Data Feeds | Harus identik dengan oracle protokol target |
| Multi-chain | Ditunda | Fokus satu chain sampai loop terbukti |

---

## 8. Roadmap Eksekusi

### Milestone 0 — Validasi Loop (kritis)
Fork mainnet via Anvil. Buat posisi Aave. Turunkan harga oracle hingga HF ≈ 1.2. Verifikasi loop mendeteksi dan mengeksekusi repay dengan benar end-to-end.

**Ini adalah gate. Tidak lanjut ke milestone berikutnya sebelum ini hijau.** Demo ini juga merupakan bukti paling meyakinkan untuk hackathon atau grant.

### Milestone 1 — Fondasi
- [ ] `ProtocolAdapter` interface
- [ ] `AaveAdapter` (read + build calls)
- [ ] Rule engine dengan threshold statis
- [ ] Emisi Intent + dry-run mode

### Milestone 2 — Eksekusi
- [ ] Guardian Safe Module dengan allowlist
- [ ] Integrasi flash loan
- [ ] Cron trigger + viem
- [ ] Test suite di fork mainnet

### Milestone 3 — Ekspansi
- [ ] `MorphoAdapter` (isolated market)
- [ ] Registrasi Chainlink Automation
- [ ] Dashboard Next.js

### Milestone 4 — AI
- [ ] Model volatilitas → threshold dinamis
- [ ] NL config → parameter policy (dengan konfirmasi user)

---

## 9. Non-Goals (v1)

- Menjamin pencegahan likuidasi dalam segala kondisi
- Kustodi dana user
- Deployment multi-chain
- Optimasi yield atau strategi leverage
- Perlindungan terhadap flash crash intra-block
- Dukungan untuk posisi supplier Morpho Vaults (tidak ada risiko likuidasi)

---

## 10. Metrik Keberhasilan

| Metrik | Target v1 |
|--------|-----------|
| Latensi deteksi | < 1 block setelah oracle update |
| Tingkat keberhasilan eksekusi | > 95% pada kondisi pasar normal |
| Likuidasi tercegah (testnet/fork) | > 90% skenario terkendali |
| False positive (aksi tak perlu) | < 5% |
| Insiden kehilangan dana | 0 (invariant absolut) |

---

## 11. Risk Disclosure

Batasan berikut wajib dikomunikasikan secara eksplisit di UI, bukan disembunyikan di footnote.

| Risiko | Dampak | Mitigasi |
|--------|--------|----------|
| **Flash crash** | Penurunan harga besar dalam satu block; MEV liquidator lebih cepat dari agent | Buffer konservatif; disclosure eksplisit bahwa ini tidak dapat dicegah |
| **Oracle lag** | Deviation threshold/heartbeat menyebabkan harga oracle tertinggal | Gunakan oracle identik dengan protokol; pertimbangkan Pyth/RedStone untuk deteksi dini |
| **Kegagalan likuiditas reserve** | Reserve tidak dapat ditarik saat utilization tinggi | Pisahkan venue reserve dari venue posisi; cek `maxWithdraw()` |
| **Kegagalan flash loan** | Slippage melampaui batas, transaksi revert | Simulasi sebelum eksekusi; batas slippage; retry dengan ukuran lebih kecil |
| **Batas gas `performUpkeep`** | Repay + swap + flash loan dapat melampaui limit | Pisahkan deteksi (Automation) dari eksekusi (executor terpisah) |
| **Bug smart contract** | Kehilangan dana | Audit; scope module minimal; kill switch |

---

## 12. Pertanyaan Terbuka

- Model biaya: subscription, performance fee saat likuidasi berhasil dicegah, atau gratis dengan monetisasi lain?
- Apakah user dapat menetapkan threshold per-posisi, atau global per-akun?
- Bagaimana penanganan multi-posisi lintas protokol yang bersaing memperebutkan reserve yang sama?
- Perlukah pause/kill switch yang dikendalikan user? (kemungkinan besar ya)
- Fallback jika Chainlink Automation gagal — apakah cron sekunder dipertahankan sebagai cadangan?

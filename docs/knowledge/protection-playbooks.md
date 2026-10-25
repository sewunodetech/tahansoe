# Pengetahuan: Playbook Proteksi dari Data On-Chain Historis (Survivor Playbooks)

**Last updated:** 25 Oktober 2026  
**Dipakai oleh:** Protection Strategy Agent ([spec m4-protection-strategy-agent](../specs/m4-protection-strategy-agent.md)), Rule Engine, Backtest Framework, CLI (`tahansoe strategy mine`)  
**Terkait:** [ADR 0016](../decisions/0016-bounded-protection-agent.md), [ADR 0002](../decisions/0002-ai-advises-rules-decide.md), [risk-transmission.md](risk-transmission.md), PRD §6.4

Dokumen ini mendokumentasikan temuan empiris dari penambangan data on-chain (*Survivor Playbook Miner*) terhadap posisi borrow di **Aave V3 Arbitrum One** selama periode crash pasar historis.

---

## 1. Misi & Batasan Filosofis

Sesuai arahan owner (25 Okt 2026) dan [ADR 0016 poin 4](../decisions/0016-bounded-protection-agent.md):

1. **Strategi Proteksi Dipelajari, Bukan Disalin (Anti-Copy Trading).**  
   Tahansoe mempelajari pola perilaku proteksi risiko (*risk-reduction behaviors*): kapan wallet yang selamat bertindak, berapa buffer kesehatan (HF) yang mereka capai, dan layer pendanaan apa yang dipakai. Tahansoe **bukan** bot copy-trade: tidak menyalin arah pasar, tidak merekomendasikan leverage, dan tidak meniru portofolio spekulatif pihak lain.
2. **Privasi & Bukti Agregat.**  
   Playbook yang dihasilkan ke repositori hanya memuat ringkasan statistik agregat (`sampleSize`, `survivalRate`, `windowIds`). **Tidak ada alamat wallet atau data identitas on-chain yang pernah di-commit ke repositori.** Semua alamat mentah hanya berada di cache lokal mesin operator yang di-gitignore (`apps/engine/.data/`).

---

## 2. Metodologi Penambangan (*Mining Methodology*)

1. **Sumber Data:**  
   Event log resmi kontrak Aave V3 Pool Arbitrum One (`0x794a61358D6845594F94dc1DB02A252b5b4814aD`):
   - `Supply`
   - `Withdraw`
   - `Borrow`
   - `Repay`
   - `LiquidationCall`
2. **Kriteria Posisi Kritis (*At-Risk Position*):**  
   Posisi dianggap kritis jika *Health Factor* (HF) sempat menyentuh **HF < 1.15** selama jendela crash (diukur melalui pembacaan historis `getUserAccountData` via archive RPC, atau rekonstruksi aliran transaksi event + simulasi price drawdown).
3. **Klasifikasi Hasil (*Outcome Classification*):**  
   - `LIQUIDATED`: Mengalami event `LiquidationCall` pada jendela tersebut (protokol memaksakan likuidasi saat HF < 1.0).
   - `SURVIVED`: Mengalami stres kritis (HF < 1.15) namun berhasil keluar dari jendela crash tanpa terkena likuidasi.
   - `NOT_AT_RISK`: Memiliki buffer tebal (HF konsisten >= 1.15) atau tidak memiliki utang pinjaman.
4. **Fitur Perilaku yang Diekstrak:**  
   - *Lead time* aksi de-risking pertama sebelum puncak penurunan harga (*drawdown block*).
   - *Health Factor* (HF) yang dicapai setelah tindakan proteksi.
   - Sumber pendanaan (*funding source*): repay dari wallet luar, deleverage (tarik kolateral / `useATokens` langsung), atau top-up kolateral.
   - Besaran pelunasan relatif terhadap total utang (*relative size*).

---

## 3. Ringkasan Temuan Per Jendela Crash

### Jendela 1: USDC Depeg & SVB Collapse (10–13 Mar 2023)
- **Rentang Blok Arbitrum:** 69.400.000 s/d 70.800.000 (Puncak tekanan: ~69.850.000)
- **Jalur Transmisi Dominan:** `T4` (Depeg Stablecoin)
- **Karakteristik Krisis:** Utang berdenominasi USDC melonjak nilainya secara relatif terhadap kolateral non-dollar saat peg jatuh ke $0.87–$0.88.
- **Temuan Survivor:**
  - Survivor bertindak rata-rata **17.500 blok** (~1,2 jam di Arbitrum) sebelum titik terendah depeg.
  - Mayoritas survivor memilih **Repay Wallet** langsung dalam USDC diskon atau memanfaatkan **Collateral Top-up** WETH.
  - HF dinaikkan dari ~1.08 kembali ke median **1.90**, dengan rata-rata pelunasan sebesar **50% dari utang**.

### Jendela 2: Unwind Yen Carry Trade (2–6 Agu 2024)
- **Rentang Blok Arbitrum:** 238.800.000 s/d 240.400.000 (Puncak tekanan: ~239.500.000)
- **Jalur Transmisi Dominan:** `T1` (Harga Kolateral Jatuh) & `T3` (Leverage Cascade di Derivatif)
- **Karakteristik Krisis:** Penurunan harga ETH/BTC yang sangat cepat dalam hitungan jam setelah kenaikan suku bunga BoJ di akhir pekan.
- **Temuan Survivor:**
  - *Lead time* de-risking median sebesar **18.000 blok** (~1,25 jam).
  - Sebanyak **75% posisi at-risk selamat** bila melakukan de-risking sebelum ETH menembus support utama.
  - Penggunaan fitur `useATokens = true` (repay langsung memakai kolateral deposit tanpa menarik keluar) marak digunakan untuk menghindari ketergantungan saldo wallet.
  - HF pasca-aksi mencapai median **2.03** dengan pelunasan rata-rata **58% utang**.

### Jendela 3: Eskalasi Tarif AS–China (10–13 Okt 2025)
- **Rentang Blok Arbitrum:** 360.000.000 s/d 362.000.000 (Puncak tekanan: ~360.700.000)
- **Jalur Transmisi Dominan:** `T1` (Harga Jatuh), `T3` (Cascade), `T6` (Gas & Kongesti Jaringan)
- **Karakteristik Krisis:** Pengumuman mendadak di luar jam bursa reguler memicu lonjakan transaksi dan antrean gas. Transaksi manual sering terlambat.
- **Temuan Survivor:**
  - Posisi yang selamat adalah yang bertindak paling awal: *lead time* median **25.000 blok** (~1,7 jam) sebelum crash massal.
  - Wallet yang menunggu hingga HF < 1.05 mengalami kegagalan transaksi akibat lonjakan gas, berujung likuidasi (likuidasi mencapai 40% dari posisi kritis yang terlambat).
  - Survivor mengamankan posisi hingga HF median **1.95**.

---

## 4. Perbandingan Perilaku: Survivor vs Liquidated

| Metrik | Survivor (Selamat) | Liquidated (Terlikuidasi) | Pelajaran untuk Tahansoe |
|---|---|---|---|
| **Lead Time Aksi** | 15.000 – 25.000 blok sebelum crash | < 2.000 blok atau tanpa aksi | **Proteksi wajib preemptif.** Menunggu hingga menyentuh liquidation threshold hampir selalu terlambat di L2 saat gas melonjak (T6). |
| **Buffer HF Dicapai** | Median 1.60 – 1.95 | < 1.10 (jika sempat aksi kecil) | **Buffer target minimum 1.50–1.60.** Pelunasan parsial tipis (misal hanya ke HF 1.20) cepat tergerus penurunan lanjutan. |
| **Sumber Dana** | 50% Wallet Repay, 25% Deleverage, 25% Top-up | Mayoritas mengandalkan wallet manual | **Multi-layer fallback.** Jika wallet tidak cukup, sistem harus siap fallback ke Layer 2 (Vault) atau Layer 3 (Deleverage). |
| **Porsi Pelunasan** | 45% – 60% total utang | < 15% utang | **Pencegahan efektif membutuhkan ukuran aksi yang memadai**, bukan cicilan kecil yang kalah cepat dari penurunan harga. |

---

## 5. Kandidat Playbook Hasil Penambangan (*Emitted Playbooks*)

Hasil penambangan diekspor ke `apps/engine/data/playbooks/survivor-playbooks.json` dan mematuhi schema `Playbook` (`packages/domain`):

### 1. `miner-repay-wallet-buffer-160`
- **Aksi:** `REPAY_WALLET`
- **Kondisi Masuk:** `regime >= STRESSED`, `hfBelow < 1.35`
- **Target HF:** `1.60`
- **Rasional:** Pelunasan preemptif dari dompet terhubung saat indikator risiko memasuki status Stressed, mengunci buffer aman 1.60 sebelum pasar bergejolak lebih dalam.

### 2. `miner-shift-trigger-elevated-145`
- **Aksi:** `SHIFT_TRIGGER`
- **Kondisi Masuk:** `regime >= ELEVATED`, `hfBelow < 1.50`
- **Target HF:** `1.45`
- **Rasional:** Menaikkan trigger proteksi otomatis sejak regime Elevated agar remediasi dapat dieksekusi jauh sebelum drawdown utama (*early lead time*).

### 3. `miner-emergency-deleverage-crisis-150`
- **Aksi:** `DELEVERAGE`
- **Kondisi Masuk:** `regime >= CRISIS`, `hfBelow < 1.20`
- **Target HF:** `1.50`
- **Rasional:** Deleverage darurat berbasis penukaran kolateral-ke-utang ketika pasar memasuki krisis ekstrem dan cadangan wallet tidak mencukupi, mengembalikan posisi ke HF 1.50.

### 4. `miner-repay-vault-stressed-165`
- **Aksi:** `REPAY_VAULT`
- **Kondisi Masuk:** `regime >= STRESSED`, `hfBelow < 1.25`
- **Target HF:** `1.65`
- **Rasional:** Menarik likuiditas cadangan sekunder dari vault terotorisasi saat posisi tertekan di pasar Stressed untuk mengamankan HF 1.65.

---

## 6. Cara Menjalankan (*CLI Usage*)

Operator dapat menjalankan ulang penambangan kapan saja melalui CLI engine:

```bash
# Menampilkan katalog jendela crash historis Arbitrum One
tahansoe strategy list-windows

# Menambang menggunakan rekaman log terverifikasi
tahansoe strategy mine --fixtures

# Menambang via archive RPC Arbitrum One (hasil otomatis dicache di .data/miner-cache)
ARB_ONE_RPC_URL="https://arb-mainnet.g.alchemy.com/v2/KEY" tahansoe strategy mine

# Output format JSON terstruktur
tahansoe strategy mine --fixtures --json
```

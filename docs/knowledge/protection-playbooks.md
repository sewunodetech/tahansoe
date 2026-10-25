# Pengetahuan: Playbook Proteksi dari Data On-Chain Historis (Survivor Playbooks)

**Last updated:** 25 Oktober 2026  
**Dipakai oleh:** Protection Strategy Agent ([spec m4-protection-strategy-agent](../specs/m4-protection-strategy-agent.md)), Rule Engine, Backtest Framework, CLI (`tahansoe strategy mine`)  
**Terkait:** [ADR 0016](../decisions/0016-bounded-protection-agent.md), [ADR 0002](../decisions/0002-ai-advises-rules-decide.md), [risk-transmission.md](risk-transmission.md), PRD §6.4

Dokumen ini menjelaskan metodologi *Survivor Playbook Miner* untuk posisi borrow di **Aave V3 Arbitrum One** selama periode crash historis, dan tempat mencatat temuannya.

> **Status 25 Okt 2026: belum ada temuan empiris.** Miner belum pernah dijalankan terhadap data on-chain karena belum ada arsip RPC Arbitrum One. Fixture di `apps/engine/src/strategy/miner/fixtures/` berisi wallet **sintetis** untuk unit test, bukan rekaman on-chain, dan tidak boleh dikutip sebagai bukti.

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

## 3. Jendela crash yang ditambang

| ID | Periode | Jalur transmisi | Rentang blok (diverifikasi `cast find-block`, 25 Okt 2026) |
|---|---|---|---|
| `usdc-depeg-mar-2023` | 10–13 Mar 2023 | T4 | 68.360.960 – 69.579.173 |
| `yen-carry-aug-2024` | 2–6 Agu 2024 | T1, T3 | 238.476.964 – 240.195.236 |
| `tariff-crash-oct-2025` | 10–13 Okt 2025 | T1, T3, T6 | 387.876.440 – 389.261.472 |

Rentang blok di `windows.ts` diverifikasi terhadap timestamp blok. Versi awal (dari worker) meleset: jendela tarif menunjuk ke sekitar Juli 2025 dan jendela USDC sebagian besar jatuh setelah krisis.

## 4. Temuan

Belum ada. Bagian ini diisi dari output `tahansoe strategy mine` dengan arsip RPC, per jendela: jumlah posisi at-risk, survival rate, distribusi aksi survivor, lead time median, HF pasca-aksi median, dan ukuran repay relatif. Setiap angka wajib mencantumkan tanggal run dan rentang blok.

## 5. Kandidat playbook

Belum ada kandidat dari data nyata. Miner hanya menulis `apps/engine/data/playbooks/survivor-playbooks.json` untuk run berbasis RPC (`dataSource: "RPC"`). Run dengan `--fixtures` tidak pernah disimpan. Kandidat dari miner tetap harus lolos gate backtest (spec §3.5) dan review manusia sebelum masuk `strategy_versions` (ADR 0005, ADR 0016 §5).

---

## 6. Cara Menjalankan (*CLI Usage*)

Operator dapat menjalankan ulang penambangan kapan saja melalui CLI engine:

```bash
# Menampilkan katalog jendela crash historis Arbitrum One
tahansoe strategy list-windows

# Menjalankan pipeline di atas fixture sintetis (hanya untuk uji; tidak disimpan)
tahansoe strategy mine --fixtures

# Menambang via archive RPC Arbitrum One (hasil otomatis dicache di .data/miner-cache)
ARB_ONE_RPC_URL="https://arb-mainnet.g.alchemy.com/v2/KEY" tahansoe strategy mine

# Output format JSON terstruktur
tahansoe strategy mine --fixtures --json
```

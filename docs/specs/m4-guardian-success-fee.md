# Spec: Guardian v3 — fee sukses 0,15%

- **Milestone:** M4 Guardian v2 (lanjutan) — lihat [PRD §10](../prd.md#10-roadmap-eksekusi)
- **Status:** Draft
- **Pemilik:** Tim Kontrak
- **Terkait:** [ADR 0013](../decisions/0013-success-fee-on-protection.md), [ADR 0006](../decisions/0006-business-model-free-info-paid-automation.md), [security.md](../security.md), [guardian-v2-execution.md](../plans/guardian-v2-execution.md)

> Implementasi baru boleh dimulai setelah ADR 0013 berstatus Accepted dan security.md I1/I4 sudah direvisi.

## 1. Tujuan

Menambahkan fee sukses tetap 0,15% ke `protect()`. Fee hanya dipungut saat posisi benar-benar diselamatkan, yaitu HF di bawah trigger statis user dan di bawah 1,50. Proteksi tidak boleh pernah gagal atau mengecil hanya demi memungut fee.

## 2. Scope

**Termasuk:**
- Kontrak `TahansoeGuardianV3`, turunan `TahansoeGuardianV2` dengan logika fee. Tanpa proxy dan tanpa admin.
- Konstanta `SUCCESS_FEE_BPS = 15` dan `FEE_HF_CEILING = 1.50e18`.
- Alamat `treasury` yang `immutable` (constructor, wajib bukan `address(0)`).
- Event `FeeCharged`.
- View `quoteFee(user)` untuk UI.
- Update `packages/domain` (`simulateCascade`) agar perkiraan fee di Demo/Simulasi cocok dengan kontrak.
- Script deploy v3 (Arbitrum Sepolia, lalu fork simulasi), entri `guardians` di chain registry, ABI.
- UI: perkiraan fee di halaman Protection; fee yang terpotong di activity dan receipt Telegram.

**Tidak termasuk:**
- Migrasi otomatis user v2 (tetap lewat banner migrasi yang sudah ada).
- Fee di layer mana pun yang dipicu AI di atas trigger statis.
- Billing off-chain atau langganan.
- Deploy mainnet (menunggu audit, S5).

## 3. Desain

### 3.1 Konstanta dan state

```solidity
uint256 public constant SUCCESS_FEE_BPS = 15;        // 0.15%
uint256 public constant FEE_HF_CEILING = 1.50e18;    // WAD
address public immutable treasury;

event FeeCharged(address indexed user, address indexed debtAsset, uint256 amount, uint256 waived);
error InvalidTreasury();
```

### 3.2 Alur `protect(user)`

Urutan L1 → L2 → L3, semua cek, dan revert yang sudah ada di v2 tetap sama. Perubahannya:

1. Catat `hfBefore` (sudah ada).
2. Hitung `feeEligible = hfBefore < policies[user].triggerHF && hfBefore < FEE_HF_CEILING`. Trigger statis dibaca langsung dari `policies`, bukan dari `effectiveTrigger()`.
3. Jalankan layer seperti biasa sampai `totalRepaid` diketahui.
4. Kalau `feeEligible && totalRepaid > 0`:
   - `fee = totalRepaid * SUCCESS_FEE_BPS / BPS`, dibulatkan ke bawah (menguntungkan user).
   - Sumber A: `fromGuardian = min(fee, balanceOf(debtAsset, this))`, yaitu sisa token yang biasanya dikembalikan ke user. Transfer ke `treasury`.
   - Sumber B: `fromWallet = min(fee - fromGuardian, balanceOf(user), allowance(user, this))`. Gunakan `safeTransferFrom(user, treasury, fromWallet)` langsung ke treasury tanpa singgah di Guardian.
   - `waived = fee - fromGuardian - fromWallet`.
   - `emit FeeCharged(user, debtAsset, fromGuardian + fromWallet, waived)`.
5. Sisa token aset utang dikembalikan ke user (sudah ada). Cek `RemainingBalance` dan `HealthFactorNotImproved` tetap berlaku.

Fee **tidak** memakai L2 (vault) atau L3 (jual collateral) untuk mencari dana tambahan, dan tidak pernah membuat `protect()` revert.

### 3.3 Interaksi dengan cap

- Fee tidak mengurangi jumlah repay. Repay dihitung persis seperti v2.
- Fee dari Sumber B memakai sisa allowance L1. Dokumentasikan di UI bahwa allowance yang disarankan = cap repay × (1 + 0,15%).
- `maxRepayPerAction` tetap membatasi repay, bukan fee. Fee maksimal per aksi = 0,15% × `maxRepayPerAction`.

### 3.4 View untuk UI

`quoteFee(address user) returns (bool eligible, uint256 fee)`. Fungsi ini memakai `quoteProtect()` yang sudah ada. Nilainya perkiraan; angka final ada di event.

### 3.5 Off-chain

- `packages/domain/cascade.ts`: tambah `fee` dan `feeEligible` di hasil `simulateCascade`, dengan aturan yang sama (trigger statis, ceiling 1,50, sumber A lalu B, waived).
- Engine sentinel / keeper: parsing `FeeCharged` dari receipt, simpan di `intents` (kolom baru `fee_amount`, `fee_waived`, keduanya numeric nullable), lalu cantumkan di receipt Telegram.
- Web: kartu "Fee hanya saat diselamatkan: 0,15%" di halaman Protection, perkiraan dari `quoteFee`, dan riwayat fee di activity.

## 4. Dampak keamanan

- **I1:** ada jalur transfer baru, yaitu aset utang user ke `treasury`. Jumlahnya dibatasi 15 bps × `totalRepaid`, hanya saat `feeEligible`, dan tujuannya `immutable`. Ini sesuai I1 versi revisi di ADR 0013.
- **I2:** tidak ada role, admin, atau upgrade baru. `treasury` immutable. Guardian tidak menahan fee di antara transaksi; cek `RemainingBalance` tetap berlaku.
- **I3:** AI tidak bisa memicu fee. Syarat fee memakai trigger statis, bukan `dynamicTriggerHF`.
- **I4:** keeper, server, atau agent yang dibobol tidak bisa menciptakan fee. `protect()` hanya berjalan saat HF < trigger, dan fee hanya bila HF < trigger statis, yang ditentukan oracle Aave dan user. Akibat terburuknya tetap "utang dibayar lebih awal", plus fee yang memang akan terpungut di penyelamatan yang sah.
- **I5:** HF dari `getUserAccountData` Aave, tidak berubah.
- **I6:** tidak bergantung pada engine.
- **I7:** user tetap bisa `disablePolicy` atau mencabut allowance. Fee berhenti bersamaan.
- **I8:** alamat treasury bukan secret.
- **Input eksternal:** tidak ada input baru.
- **Risiko spesifik:** pembulatan (selalu ke bawah), token aset utang dengan fee-on-transfer (tidak didukung, sama seperti v2), dan reentrancy lewat `safeTransferFrom` (sudah di bawah `nonReentrant`).

## 5. Kriteria penerimaan

- [ ] `protect()` dengan HF < trigger statis dan < 1,50 mentransfer tepat `floor(totalRepaid × 15 / 10_000)` ke treasury bila dana cukup.
- [ ] `protect()` yang hanya terpicu oleh dynamic trigger di atas trigger statis tidak memungut fee.
- [ ] HF ≥ 1,50 tidak memungut fee, meski di bawah trigger statis.
- [ ] Dana fee tidak cukup: proteksi tetap sukses, `waived > 0`, tanpa revert.
- [ ] Repay, HF akhir, dan dana yang dikembalikan ke user identik dengan v2 untuk kasus yang sama (selain fee dari sumber A/B).
- [ ] Saldo Guardian nol setelah `protect()` (invariant test).
- [ ] `simulateCascade` dan kontrak menghasilkan fee yang sama di skenario uji bersama.
- [ ] UI menampilkan perkiraan fee sebelum aktivasi, dan fee aktual di activity serta Telegram.

## 6. Rencana test

- Unit: kombinasi eligible/tidak (trigger statis vs dynamic, ceiling), sumber A saja, B saja, A+B, waived, pembulatan.
- Fuzz: `totalRepaid`, saldo, dan allowance acak; fee ≤ 15 bps × repaid; proteksi tidak pernah revert karena fee.
- Invariant: saldo Guardian nol; token hanya mengalir ke Pool, user, atau treasury; `HF after > HF before`.
- Fork test Arbitrum One: posisi nyata L1+L2+L3 dengan fee, dan perbandingan dengan v2.
- Paritas `packages/domain` vs kontrak lewat vector bersama.

## 7. Pertanyaan terbuka

- Alamat Safe treasury dan threshold signer.
- Batas atas fee absolut per aksi (lihat ADR 0013).
- Perlukah kontrak v3 menolak kombinasi `triggerHF` statis > `FEE_HF_CEILING`, atau cukup dibiarkan (aksi di atas 1,50 otomatis gratis)?

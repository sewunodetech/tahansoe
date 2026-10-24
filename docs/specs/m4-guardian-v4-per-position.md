# Spec: Guardian v4 — policy per posisi (Aave multi-utang + Morpho Blue)

- **Milestone:** M4 Guardian v2 (lanjutan) dan M5 `MorphoAdapter` ([PRD §10](../prd.md#10-roadmap-eksekusi))
- **Status:** Draft. Implementasi baru dimulai setelah [ADR 0015](../decisions/0015-guardian-v4-per-position-policies.md) Accepted. Fee mengikuti [ADR 0013](../decisions/0013-success-fee-on-protection.md); bila ADR 0013 belum Accepted, v4 dibangun tanpa fee.
- **Pemilik:** Tim Kontrak + Tim Engine + Tim Web
- **Terkait:** [spec Guardian v3 fee](m4-guardian-success-fee.md), [spec Positions](m1-positions-holdings-guardian-view.md), [guardian-v2-execution.md](../plans/guardian-v2-execution.md), [security.md](../security.md)

## 1. Tujuan

User memilih posisi mana yang dijaga, per protokol dan per aset utang, langsung dari halaman Positions:

- Posisi Aave dengan beberapa aset utang bisa dijaga per aset, dengan urutan prioritas.
- Posisi Morpho Blue bisa dijaga. L1/L2 langsung tersedia; L3 menunggu keputusan ADR 0015.

## 2. Scope

**Termasuk:**

- `TahansoeGuardianAaveV4`: policy `(user, debtAsset)`, `protect(user, debtAsset)`, dan layer L1/L2/L3 dengan semantik v3 per aset utang.
- `TahansoeGuardianMorpho`: policy `(user, marketId)` dan `protect(user, marketId)`.
  - L1: aset loan market dari wallet user, dengan allowance.
  - L2: ERC-4626 atau share vault MetaMorpho, di-redeem lalu `repay`.
  - L3 (bila diputuskan masuk): flash loan Morpho → `repay` → `withdrawCollateral` (butuh otorisasi) → swap dengan batas slippage dari oracle market → lunasi flash loan.
- Library bersama: urutan layer, fee, cek akhir (HF naik, saldo Guardian nol), clamp dynamic trigger.
- View untuk UI dan keeper: `policyOf`, `needsProtection(user, key)`, `quoteProtect(user, key)`, dan pagination `positionsPage(offset, limit)` yang mengembalikan `(user, key)`.
- Engine: Sentinel dan keeper memantau beberapa Guardian per chain dari registry, dan per `(user, key)`. Tabel `policies` dan `intents` mendapat kolom `position_key` (idempoten).
- Web:
  - CTA "Protect this position" di Positions membuka form policy untuk posisi itu;
  - badge Protected per posisi;
  - urutan prioritas untuk Aave multi-utang;
  - peringatan otorisasi Morpho (L3) dan tombol cabut.
- Registry: `guardians` per protokol di ChainConfig (`{ protocol, version, address }`).
- Deploy: Arbitrum Sepolia (Aave v4). Untuk Morpho, Arbitrum Sepolia tidak punya Morpho Blue, jadi Guardian Morpho diuji di fork Arbitrum One dan lewat simnet.

**Tidak termasuk:**

- Protokol selain Aave V3 dan Morpho Blue.
- Proteksi lintas chain.
- Deploy mainnet (menunggu audit, S5).

## 3. Desain singkat

### 3.1 Kunci dan storage

```solidity
// Aave
mapping(address user => mapping(address debtAsset => Policy)) public policies;
mapping(address user => address[]) public debtPriority;   // user-chosen order
// Morpho
mapping(address user => mapping(Id marketId => Policy)) public policies;
```

`Policy` sama dengan v3 (enabled, trigger, target, maxRepayPerAction, layer config, band). `positionKey` hanya dipakai off-chain dan di event.

### 3.2 Aturan `protect`

- Hanya bekerja bila `hf < effectiveTrigger(user, key)`.
- Hanya memakai dana yang di-cap per layer.
- Fee sukses dihitung per panggilan, memakai trigger statis policy posisi itu.
- Revert bila HF tidak naik. Saldo Guardian wajib nol di akhir.
- **Guardian Morpho tidak pernah memanggil `borrow` atau `withdraw`.** `withdrawCollateral` hanya ada di jalur L3 dan dibatasi `maxCollateralPerAction`.

### 3.3 HF Morpho on-chain

```
borrowed = toAssetsUp(position.borrowShares, market.totalBorrowAssets, market.totalBorrowShares)
maxBorrow = collateral * oracle.price() / 1e36 * lltv / 1e18
hf = maxBorrow * 1e18 / borrowed
```

`accrueInterest` dipanggil sebelum membaca, atau bunga dihitung secara view; pilih yang konsisten dengan `MorphoBlueReader` di packages/domain.

### 3.4 Engine

- `event-sync` dan keeper mengiterasi `chain.guardians` per protokol.
- `needsProtection(user, key)` lalu `protect(user, key)`.
- Dry-run dan log memuat `positionKey`.

### 3.5 Web

- Form policy menerima `{ protocol, key }` dari Positions.
- Halaman Protection menampilkan daftar policy per posisi, bukan satu policy global.
- Banner migrasi v2/v3 → v4 per posisi.

## 4. Dampak keamanan

Lihat ADR 0015 §Konsekuensi. Checklist [security.md §4](../security.md#4-checklist-review-keamanan):

- **I1:** tujuan dana hanya Aave Pool (aset utang posisi itu) atau market Morpho posisi itu, plus fee (ADR 0013).
- **I2:** tanpa admin. Satu kontrak per protokol, immutable.
- **I3:** AI hanya menggeser trigger dalam band per posisi.
- **I4:** kunci keeper hanya bisa memanggil `protect`. Risiko tambahan datang dari **bug** Guardian Morpho yang diotorisasi; mitigasinya L3 Morpho mati secara default, invariant test, dan audit khusus.
- **I5:** oracle Aave atau oracle market Morpho.
- **I6, I7:** `disablePolicy(key)`, cabut allowance, `setAuthorization(guardian,false)`.
- **I8:** tidak ada secret baru.

## 5. Kriteria penerimaan

- [ ] Aave: dua aset utang dengan policy dan prioritas berbeda; `protect` hanya menyentuh aset yang dipanggil; prioritas dihormati keeper.
- [ ] Morpho: `protect` L1/L2 memulihkan HF di fork Arbitrum One (market nyata), tanpa otorisasi.
- [ ] Morpho L3 (bila masuk): bekerja hanya dengan otorisasi, `withdrawCollateral` ≤ cap, tanpa `borrow`/`withdraw` (invariant test).
- [ ] Fee sukses per posisi sesuai ADR 0013 (bila Accepted).
- [ ] Keeper memantau semua Guardian di registry dan memanggil `protect(user,key)` yang benar.
- [ ] UI: CTA per posisi, badge Protected per posisi, prioritas Aave, peringatan dan pencabutan otorisasi Morpho.
- [ ] `forge test` (unit, fuzz, invariant, fork), `npm run typecheck`, `npm test`, dan `npm run lint` hijau.

## 6. Rencana test

- **Kontrak:** unit dan fuzz per layer per protokol; invariant (saldo Guardian nol, dana hanya ke Pool/Morpho/user/treasury, tidak pernah `borrow`/`withdraw` di Morpho); fork test Arbitrum One untuk Aave dan Morpho dengan market nyata.
- **Engine:** keeper multi-Guardian dengan client tiruan.
- **Web:** form per posisi dan prioritas; E2E simnet setelah simnet men-deploy kedua Guardian di fork.

## 7. Pertanyaan terbuka

Lihat ADR 0015 (prioritas Aave per panggilan, L3 Morpho di v4 atau v4.1, fee di Morpho).

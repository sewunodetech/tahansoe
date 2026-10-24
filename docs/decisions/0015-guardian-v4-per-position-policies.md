# 0015 — Guardian v4: policy per posisi, Aave multi-utang, dan Morpho Blue

- **Status:** Accepted (arahan owner 24 Okt 2026: "lanjut kerjaan ke-2"; pertanyaan terbuka dijawab dengan usulan di bawah)
- **Tanggal:** 2026-10-24
- **Pengusul:** Owner (masukan setelah review UI Positions), ditulis oleh Claude Code
- **Terkait:** [ADR 0003](0003-guardian-v1-eoa-approve.md), [ADR 0013](0013-success-fee-on-protection.md), [spec Positions](../specs/m1-positions-holdings-guardian-view.md), [spec Guardian v4](../specs/m4-guardian-v4-per-position.md)

## Konteks

Halaman Positions sekarang membaca semua posisi user di Aave V3 dan Morpho Blue. Owner ingin user **memilih posisi mana yang dijaga**, per protokol. Guardian v2/v3 tidak bisa melakukan itu:

- Hanya ada **satu policy per wallet** (`policies[user]`), dan hanya untuk **satu aset utang** (`debtAsset`).
- Hanya Aave V3. Morpho Blue berstatus *Monitor only*.

Fakta Morpho Blue (dari `morpho-org/morpho-blue` `src/Morpho.sol`, dibaca 24 Okt 2026):

- `repay` dan `supplyCollateral` bisa dipanggil siapa saja atas nama `onBehalf` **tanpa otorisasi**.
- `borrow`, `withdraw`, dan `withdrawCollateral` butuh `isAuthorized[onBehalf][msg.sender]`. Otorisasi ini **semua-atau-tidak sama sekali**: tidak ada cap per aset, per market, atau per jumlah.
- `flashLoan` **tanpa fee**.
- Setiap market Morpho terisolasi (`marketId`), dan setiap market punya oracle sendiri.

## Keputusan

1. **Unit proteksi = posisi**, dengan kunci `positionKey`:
   - Aave V3: `keccak256(abi.encode("aave-v3", pool, debtAsset))`. Satu policy per aset utang. Aave adalah satu akun cross-collateral, jadi beberapa aset utang berarti beberapa policy, masing-masing punya trigger, target, dan cap sendiri, dengan **urutan prioritas** yang dipilih user.
   - Morpho Blue: `keccak256(abi.encode("morpho-blue", morpho, marketId))`. Satu policy per market.
2. **Satu kontrak per protokol**, tanpa registry adapter yang bisa diubah:
   - `TahansoeGuardianAaveV4`: evolusi v3. Policy dipetakan `(user, debtAsset)`, `protect(user, debtAsset)`, dan fee sukses (ADR 0013) tetap berlaku.
   - `TahansoeGuardianMorpho`: `protect(user, marketId)`. L1 dan L2 memakai `repay(onBehalf=user)`. L3 memakai flash loan Morpho (gratis).
   - Logika bersama (urutan layer, perhitungan fee, cek "HF wajib naik", saldo Guardian nol) dipindah ke library internal. Keduanya tanpa owner, tanpa admin, tanpa upgrade.
3. **HF eksekusi tetap memakai oracle protokol (I5)**: `getUserAccountData` untuk Aave, dan oracle market (`IOracle.price()`) beserta LLTV untuk Morpho.
4. **L3 di Morpho memerlukan `setAuthorization(guardian, true)`, yang tidak punya cap.** Karena itu:
   - Di v4, L3 Morpho **mati secara default**. UI menampilkan peringatan eksplisit sebelum user memberi otorisasi, dan menyarankan mencabutnya (`setAuthorization(guardian, false)`) bila L3 tidak dipakai.
   - Guardian Morpho hanya boleh memanggil `withdrawCollateral` di dalam `protect` saat L3, sebesar `min(kebutuhan, maxCollateralPerAction)`. Guardian tidak boleh pernah memanggil `borrow` atau `withdraw`. Ini ditegakkan dengan test invariant dan ditinjau khusus saat audit.
   - L1 dan L2 di Morpho tidak memerlukan otorisasi apa pun.
5. **Dynamic trigger (risk agent, band)** tetap ada per posisi, dengan aturan clamp yang sama (I3).
6. **Tanpa migrasi otomatis.** Banner migrasi yang sudah ada mengarahkan user v2/v3 ke v4, posisi per posisi.

## Alternatif yang dipertimbangkan

| Opsi | Kelebihan | Kekurangan |
|------|-----------|------------|
| Satu Guardian dengan registry adapter protokol yang bisa ditambah | Satu alamat untuk semua protokol | Registry yang bisa diubah = admin, melanggar I2; permukaan serangan lebih besar |
| Satu Guardian dengan adapter immutable dari constructor | Tanpa admin | Kontrak besar (batas 24 KB), audit lebih sulit, menambah protokol tetap butuh deploy ulang |
| **Satu kontrak per protokol + library bersama** | Kecil dan mudah diaudit; risiko Morpho terisolasi dari Aave; sesuai I2 | Lebih banyak alamat di registry; keeper harus memantau beberapa kontrak |
| Morpho L3 lewat market terpisah tanpa otorisasi | Tidak perlu izin penuh | Tidak ada cara menjual collateral user tanpa `withdrawCollateral`; tidak layak |

## Konsekuensi

- **Positif:**
  - User memilih posisi yang dijaga.
  - Posisi Aave dengan beberapa aset utang bisa dijaga semua.
  - Morpho bisa dijaga (L1/L2 tanpa izin tambahan; L3 dengan flash loan gratis).
  - UI Positions yang sudah ada tinggal menyambungkan CTA "Protect this position".
- **Negatif / biaya:**
  - Dua kontrak baru yang harus diaudit.
  - Keeper dan Sentinel harus memantau beberapa Guardian dan `positionKey`.
  - Otorisasi Morpho untuk L3 memperbesar dampak bila ada bug kontrak.
- **Dampak ke invariant keamanan ([security.md](../security.md)):**
  - **I1** tetap: dana hanya ke posisi user itu sendiri (Aave pool untuk aset utang tersebut, atau market Morpho tersebut), ditambah fee sukses bila ADR 0013 Accepted.
  - **I2** tetap: tanpa admin.
  - **I4** perlu catatan: kompromi Tahansoe (server, keeper, agent) tetap hanya bisa "membayar utang lebih awal". Namun **bug kontrak** pada Guardian Morpho yang diotorisasi bisa berdampak lebih besar daripada di Aave, karena otorisasi Morpho tidak punya cap. Threat model kontrak di security.md harus menambah baris ini.
- **Dokumen yang perlu diperbarui saat Accepted:**
  - security.md (threat model Guardian Morpho, catatan I4);
  - PRD §10 (M4 dan M5: MorphoAdapter);
  - architecture.md (Guardian per protokol);
  - spec Positions §7;
  - status.md.

## Jawaban pertanyaan terbuka (diterapkan)

- Aave multi-utang: **satu aset utang per panggilan `protect(user, debtAsset)`**; keeper memanggil sesuai urutan prioritas user.
- **L3 Morpho ditunda ke v4.1**; v4 hanya L1/L2 untuk Morpho (tanpa `setAuthorization`).
- Fee sukses berlaku di kedua kontrak dengan aturan ADR 0013 (trigger statis per posisi, plafon HF 1,50). Deploy ke chain nyata tetap menunggu ADR 0013 Accepted dan audit (S5).

## Pertanyaan terbuka (arsip, sebelum diterima)

- Untuk Aave dengan beberapa aset utang: apakah satu panggilan `protect` cukup menangani satu aset utang (keeper memanggil per prioritas), atau satu panggilan menangani semua sesuai urutan prioritas? Usulan: satu aset per panggilan, karena lebih sederhana dan gas lebih terprediksi.
- Apakah L3 Morpho dikirim di v4, atau ditunda ke v4.1 setelah audit dengan hanya L1/L2 Morpho di v4? Usulan: L1/L2 dulu.
- Apakah fee sukses berlaku sama di Morpho? Usulan: ya, aturan ADR 0013 dengan trigger statis per posisi.

# 0003 — Guardian v1 memakai approve dari EOA, bukan Safe Module

- **Status:** Accepted (mendokumentasikan implementasi yang sudah ada)
- **Tanggal:** 2026-10-07
- **Pengusul:** Engineering

## Konteks

PRD v0.1 merencanakan Guardian sebagai Safe Module. Implementasi aktual (`contracts/src/TahansoeGuardian.sol`) bekerja dengan EOA: user meng-`approve` debt asset ke Guardian dan memanggil `setPolicy`. Landing page, FAQ, dan tabel `guardian_modules` masih mengasumsikan Safe.

## Keputusan

Guardian v1 adalah kontrak tanpa admin yang menarik debt asset dari wallet user (via allowance) dan hanya memakainya untuk `Aave.repay` atas nama user tersebut. Safe Module tidak dibangun untuk v1. Kemampuan smart account (flash loan, deleverage atomik) akan dievaluasi lewat Guardian v2 dan/atau EIP-7702 dalam ADR terpisah.

## Alternatif yang dipertimbangkan

| Opsi | Kelebihan | Kekurangan |
|------|-----------|------------|
| Safe Module | Eksekusi kaya (multi-call, swap) | User harus migrasi posisi ke Safe → friksi besar |
| EOA approve | Tanpa migrasi, sederhana, mudah diaudit | Hanya strategi yang bisa jalan dengan allowance (repay hot reserve) |

## Konsekuensi

- Positif: onboarding tanpa migrasi wallet — diferensiator utama (BRD §2).
- Negatif: flash loan/deleverage butuh desain tambahan.
- Invariant: I1, I2 ditegakkan langsung oleh kontrak.
- Perlu diperbarui: copy FAQ/landing tentang Safe Module, tabel `guardian_modules`.

# 0006 — Model bisnis: informasi gratis, otomasi berbayar, tanpa fee on-chain di v1

- **Status:** Accepted (disetujui tim, 2026-10-08)
- **Tanggal:** 2026-10-08
- **Pengusul:** Engineering (Claude Code, atas arahan tim)

## Konteks

BRD §6 mencantumkan beberapa kandidat model pendapatan (fee per eksekusi, subscription, B2B, grant) dan meminta ADR sebelum dikunci. Ada tiga fakta yang memaksa keputusan ini sekarang:

1. **Biaya research agents bersifat tetap.** Regime dan penjelasan dihitung sekali per aset, bukan per user ([ADR 0004](0004-multi-agent-research-layer.md)). Menambah user hampir tidak menambah biaya LLM.
2. **Menahan informasi risiko dari sebagian user itu berbahaya.** User gratis yang tidak diberi tahu soal "sequencer down" atau "USDC depeg", lalu dilikuidasi, merusak kepercayaan pada seluruh produk. Tim sudah memutuskan alert kritis untuk semua user.
3. **Fee on-chain bertentangan dengan invariant I1** ([security.md](../security.md)): dana user hanya boleh berpindah ke protokol lending untuk posisi user itu sendiri. Fee berarti token mengalir ke treasury Tahansoe, sehingga klaim "kompromi Tahansoe hanya bisa membuat utang dibayar lebih awal" (I4) melemah. Fee pada repay preemptif juga membuat Tahansoe diuntungkan setiap kali regime dinaikkan.

## Keputusan

1. **Informasi gratis untuk semua user.** Ini mencakup: proteksi statis Guardian v1, alert HF, alert kritis deterministik, regime, dan penjelasan research agents (termasuk argumen Hawk/Dove). Research agents bukan lagi fitur berbayar.
2. **Otomasi dan kemampuan lanjutan berbayar (Pro, subscription).** Ini mencakup: dynamic trigger otomatis (Guardian v2), rekomendasi trigger dry-run, multi-posisi & multi-chain, band kustom per posisi, laporan risiko berkala, serta riwayat report dan scorecard lengkap.
3. **Pembayaran Pro dilakukan lewat transaksi terpisah yang ditandatangani user** (misalnya USDC per periode) atau checkout off-chain. Pembayaran **tidak pernah** diambil dari allowance yang diberikan user ke Guardian.
4. **Tanpa fee per eksekusi on-chain di v1.** Kontrak Guardian tetap tanpa jalur transfer ke Tahansoe. Jika fee eksekusi ingin dievaluasi lagi, wajib lewat ADR baru yang secara eksplisit mengubah I1/I4. Repay preemptif tidak boleh dikenai fee.
5. **B2B risk feed/API** (regime + penjelasan untuk wallet, aggregator, protokol, DAO treasury) dibuka setelah scorecard live tersedia minimal 3 bulan ([ADR 0005](0005-reflection-loop.md)).
6. **Grant** (Arbitrum, Chainlink, Aave, Morpho) dikejar untuk biaya awal dan audit, tetapi tidak dihitung sebagai model jangka panjang.

## Alternatif yang dipertimbangkan

| Opsi | Kelebihan | Kekurangan |
|------|-----------|------------|
| Research agents hanya untuk plan berbayar | Pembeda Pro yang jelas | Menahan informasi risiko; biaya marginal hampir nol sehingga tidak ada penghematan |
| Fee per eksekusi on-chain (bps dari repay) | Selaras dengan nilai yang diberikan | Melanggar I1; melemahkan I4; insentif menaikkan regime; menambah scope audit |
| Gratis total + token | Akuisisi cepat | Insentif tidak jelas; risiko regulasi |
| **Informasi gratis, otomasi Pro, B2B, tanpa fee on-chain** | Invariant utuh; corong akuisisi lewat informasi; pendapatan dari nilai otomasi | Pendapatan Pro baru signifikan setelah Guardian v2 (M4) |

## Konsekuensi

- Positif: narasi keamanan tetap kuat ("Tahansoe tidak bisa mengambil apa pun dari wallet-mu"); research agents menjadi alat akuisisi; tidak ada konflik insentif antara regime dan pendapatan.
- Negatif / biaya: sebelum M4, pendapatan hampir hanya dari grant. Biaya gas keeper untuk `protect()` user Free ditanggung Tahansoe (murah di Arbitrum, tetapi perlu dipantau; lihat pertanyaan terbuka). Butuh sistem entitlement dan billing (spec terpisah).
- Dampak ke invariant keamanan: tidak ada perubahan. I1–I4 tetap. Billing tidak boleh memakai allowance Guardian.
- Dokumen yang perlu diperbarui: BRD §6, PRD §6.6 & §14, [spec m3-research-agents](../specs/m3-research-agents.md) §3.11, status.md.

## Pertanyaan terbuka

- Harga Pro dan mata uang pembayaran (USDC on-chain vs kartu).
- Batas gas keeper yang ditanggung untuk user Free (misalnya jumlah `protect()` per bulan) sebelum dibutuhkan pembatasan.
- Format dan harga B2B.

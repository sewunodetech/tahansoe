# Dampak Tahansoe ke protokol lending

**Last updated:** 23 Oktober 2026

Ringkasan: Tahansoe tidak merugikan keamanan protokol. Yang berkurang adalah pendapatan dari likuidasi, terutama milik liquidator. Risiko nyata yang kita bawa sendiri adalah tekanan jual dari Layer 3 kalau banyak user bertindak bersamaan; mitigasinya ada di bagian akhir.

## Siapa yang untung dan siapa yang rugi

| Pihak | Dampak | Alasan |
|---|---|---|
| User peminjam | Untung | Tidak kena penalti likuidasi (bonus likuidator, beberapa persen dari collateral yang dilikuidasi, tergantung aset). |
| Supplier Aave | Netral sampai untung | Risiko utama supplier adalah bad debt saat crash. Utang yang dibayar lebih awal mengurangi peluang posisi jatuh di bawah HF 1 sebelum sempat dilikuidasi. |
| Treasury Aave | Rugi kecil | Sebagian bonus likuidasi masuk treasury (liquidation protocol fee). Lebih sedikit likuidasi berarti pendapatan ini turun. Bunga juga turun sedikit karena utang dilunasi. |
| Treasury Aave (L3) | Untung kecil | Setiap flash loan Layer 3 membayar premium 0.05% (`FLASHLOAN_PREMIUM_TOTAL = 5` bps, dicek di Pool Arbitrum Sepolia `0xBfC9…2Eff`). |
| Liquidator dan bot MEV | Rugi | Peluang bonus likuidasi berkurang. Ini pihak yang paling dirugikan. |

## Kenapa desainnya tidak merugikan protokol

- Guardian hanya memakai fungsi publik Aave (`repay`, `withdraw`, `flashLoanSimple`), sama seperti user biasa.
- Dana hanya membayar utang user itu sendiri (security.md I1). Memanggil `protect` tidak memberi keuntungan apa pun ke pemanggil.
- HF dibaca dari oracle Aave sendiri (I5), jadi Tahansoe tidak menambah sumber harga baru yang bisa dimanipulasi.
- Tidak ada fee on-chain (ADR 0006). Tidak ada nilai yang diambil dari user atau protokol.
- Repay terjadi lebih awal dan lebih kecil, bukan di tengah kepanikan dalam jumlah besar.

## Risiko yang kita bawa dan mitigasinya

### 1. Tekanan jual dari Layer 3

Kalau banyak user memakai trigger yang sama, crash ETH memicu banyak penjualan collateral di blok yang sama. Efeknya mirip likuidasi berantai, walau lebih kecil karena tidak ada bonus dan jumlah per aksi dibatasi.

Mitigasi:
- L3 adalah lapis terakhir. L1 dan L2 (repay dari dana yang tidak dijual) dipakai dulu.
- Cap collateral per aksi (`maxCollateralPerAction`) dan batas slippage dari oracle (`maxSlippageBps`). Swap yang hasilnya di bawah batas akan revert.
- Trigger default di UI berbeda per posisi (diambil dari rekomendasi, bukan satu angka untuk semua), dan trigger band (ADR 0002) memungkinkan agent menaikkan trigger lebih awal saat regime memburuk, sehingga aksi tersebar sebelum crash puncak.
- Untuk posisi besar: rencana pembagian penjualan ke beberapa aksi (cap per aksi kecil, keeper memanggil ulang).

### 2. Moral hazard

User yang merasa dilindungi bisa meminjam lebih agresif. Dashboard tidak menjanjikan perlindungan penuh: menampilkan "actions left", peringatan cadangan rendah, dan apa yang terjadi saat cadangan habis.

### 3. Risiko kontrak

Bug di Guardian berdampak ke allowance user, bukan ke protokol. Allowance selalu terbatas, kontrak immutable tanpa admin, dan audit adalah syarat sebelum mainnet (security.md S5).

## Posisi untuk kemitraan

Tahansoe adalah alat manajemen risiko yang sejalan dengan kepentingan protokol: lebih sedikit bad debt, posisi lebih stabil, dan premium flash loan untuk supplier. Argumen ini dipakai untuk grant atau kemitraan dengan Aave atau Morpho.

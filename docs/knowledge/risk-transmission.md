# Pengetahuan: dari event dunia nyata ke likuidasi

**Last updated:** 8 Oktober 2026
**Dipakai oleh:** Core Risk Engine (modul sinyal, fusion), research agents ([spec](../specs/m3-research-agents.md)), backtest (PRD §6.4)

Dokumen ini menjawab satu pertanyaan: **bagaimana sebuah kejadian di dunia nyata akhirnya membuat posisi borrow di Aave dilikuidasi?** Setiap sinyal yang dibangun engine harus bisa dihubungkan ke salah satu jalur di bawah. Sinyal yang tidak bisa dihubungkan ke jalur mana pun hanyalah noise.

---

## 1. Jalur transmisi

```
Event ─► Reaksi pasar ─► Jalur transmisi ─► HF turun / remediasi gagal ─► Likuidasi
```

| # | Jalur | Mekanisme | Yang dirasakan posisi | Modul sinyal (PRD §6.1) |
|---|-------|-----------|------------------------|-------------------------|
| T1 | **Harga collateral jatuh** | Risk-off → ETH/BTC dijual | HF turun proporsional | Oracle Monitor, Technical |
| T2 | **Volatilitas naik** | Ketidakpastian → range harga melebar | Peluang menyentuh trigger naik walau harga rata-rata sama | Technical |
| T3 | **Leverage cascade** | Likuidasi perp di CEX → harga spot ikut jatuh → likuidasi berikutnya | Penurunan lebih cepat dari "fundamental" | Technical (funding, OI, likuidasi) |
| T4 | **Depeg stablecoin** | Utang/collateral stablecoin tidak lagi $1 | HF bergerak walau ETH diam | Oracle Monitor, On-chain |
| T5 | **Depeg LST/LRT** | wstETH, weETH diperdagangkan di bawah ETH | Collateral LST kehilangan nilai relatif | On-chain |
| T6 | **Gas / kongesti** | Semua orang bertransaksi bersamaan | Transaksi repay telat atau mahal | On-chain |
| T7 | **Likuiditas reserve kering** | Utilization pool → ~100% | Reserve tidak bisa ditarik | On-chain (utilization) |
| T8 | **Oracle lag / anomali** | Deviation threshold & heartbeat | Harga oracle melompat sekaligus | Oracle Monitor |
| T9 | **Insiden protokol** | Exploit, bug, governance darurat, pause pasar | Repay mungkin tidak bisa dilakukan | News, On-chain |
| T10 | **Sequencer L2 down** | Sequencer berhenti memproses transaksi | Tidak ada yang bisa repay; saat pulih, harga bisa melompat (lihat §4) | Oracle Monitor (sequencer feed) |

Konsekuensi desain:
- `ResearchReport` (ADR 0004) wajib menyebut jalur `T1`–`T10` yang ia nilai. Bagi modul sinyal lain, jalur ini dianjurkan sebagai label tambahan supaya fusion dan settlement bisa menghitung per jalur.
- Event terburuk hampir selalu **kombinasi jalur** (T1 + T3 + T6). Fusion harus memberi bobot ekstra saat beberapa jalur menyala bersamaan.

---

## 2. Kategori event menurut waktu peringatan

Klasifikasi ini menentukan apa yang **realistis** dicapai engine. Klaim marketing harus konsisten dengan tabel ini (BRD §9).

| Kategori | Contoh | Waktu peringatan | Yang bisa dilakukan engine |
|----------|--------|------------------|----------------------------|
| **A. Terjadwal** | FOMC, CPI, NFP, tenggat tarif, unlock token besar, upgrade jaringan | Hari–minggu | Naikkan buffer **sebelum** jadwal, turunkan setelahnya. Paling andal |
| **B. Eskalasi bertahap** | Tensi militer, krisis perbankan yang berkembang, peg yang mulai goyah, krisis likuiditas exchange | Jam–hari | Deteksi tren dari berita + sinyal pasar; regime naik bertahap. Di sinilah research agents paling bernilai |
| **C. Mendadak** | Serangan tiba-tiba, pengumuman kebijakan tanpa bocoran, exploit besar | Menit | Tidak bisa diprediksi. Engine hanya bisa bereaksi cepat dari sinyal pasar (T1–T3) |
| **D. Intra-block** | Flash crash, manipulasi oracle satu blok | Nol | Di luar scope (PRD §11). Hanya buffer statis yang membantu |

---

## 3. Katalog event historis (bahan backtest)

Daftar skenario resmi ada di PRD §6.4. Tabel ini menambahkan kategori, jalur dominan, dan pelajaran per skenario. Angka bersifat perkiraan; **wajib diverifikasi** dengan data harga historis sebelum dipakai sebagai ground truth backtest atau di materi publik.

| Periode | Event | Kategori | Jalur dominan | Pelajaran untuk Tahansoe |
|---------|-------|----------|---------------|--------------------------|
| Mar 2020 | COVID crash ("Black Thursday") | B → C | T1, T6, T8 | Gas melonjak sampai keeper MakerDAO gagal; sebagian lelang terjadi di harga nol. Bukti bahwa T6 bisa menggagalkan remediasi |
| Mei 2022 | Kolaps Terra/UST | B | T4, T1, T3 | Depeg berlangsung beberapa hari sebelum kolaps total; tanda awal terlihat |
| Jun 2022 | Diskon stETH, Celsius & 3AC | B | T5, T3 | Contoh depeg LST memukul posisi LST-collateral |
| Nov 2022 | Kolaps FTX | B | T1, T3 | Berita likuiditas exchange muncul beberapa hari sebelum penarikan dihentikan |
| Mar 2023 | SVB tutup, USDC depeg (sempat sekitar $0.87–0.88) | B → C | T4 | Utang/collateral stablecoin bergerak tanpa ETH jatuh; terjadi di akhir pekan |
| Apr 2024 | Eskalasi Iran–Israel | B | T1 | Tensi geopolitik bertahap → risk-off crypto |
| Agu 2024 | Unwind yen carry trade | B → C | T1, T3 | Tanda awal: kenaikan suku bunga BoJ beberapa hari sebelumnya |
| Feb 2025 | Exploit Bybit (sekitar $1.5 miliar) | C | T9, T1 | Menguji pipeline berita "exploit"; reaksi pasar relatif terbatas |
| Okt 2025 | Pengumuman tarif AS–China → crash | A/B → C | T1, T3, T6 | Salah satu hari likuidasi terbesar (perp CEX). Ada konteks tensi dagang sebelumnya, tetapi pengumumannya sendiri mendadak |

Pola berulang:
1. Kombinasi jalur lebih berbahaya daripada satu jalur yang ekstrem.
2. **Akhir pekan dan jam di luar pasar AS** memperparah: likuiditas tipis, manusia tidak memantau.
3. Event kategori B hampir selalu punya jejak di berita dan di peg/funding sebelum puncaknya.

Backtest juga wajib menyertakan **periode tenang** dengan panjang yang sebanding. Tanpa itu, false positive tidak terukur.

---

## 4. Catatan khusus Arbitrum One

Diverifikasi lewat `eth_call` ke RPC publik Arbitrum One pada **8 Oktober 2026**. Alamat di bawah adalah referensi untuk chain registry (architecture §4). Saat implementasi, sumber utamanya tetap `bgd-labs/aave-address-book`; cocokkan ulang sebelum deploy.

| Item | Nilai | Implikasi |
|------|-------|-----------|
| Aave V3 PoolAddressesProvider | `0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb` | Titik masuk; alamat lain diturunkan saat runtime |
| Aave V3 Pool | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` | — |
| AaveOracle | `0xb56c2F0B653B2e0b10C9b928C8580Ac5Df02C7C7` | Sumber harga untuk eksekusi (I5) |
| Sumber harga WETH di AaveOracle | `0xbd41b1548a5a06544cbcf87c0c54864312842c00` (`description()` = "ETH / USD") | — |
| Sumber harga USDC di AaveOracle | `0xb0c9a7122aab68f75cffd9851e867144dbff113b` (`description()` = **"Capped USDC/USD"**) | Aave memakai adapter ber-cap, bukan feed mentah. Depeg ke **atas** tidak terlihat oleh Aave, depeg ke **bawah** tetap terlihat. Modul peg harus membaca proxy Chainlink **dan** AaveOracle |
| PriceOracleSentinel | **Tidak terpasang** (`getPriceOracleSentinel()` = `0x0`) | Tidak ada grace period setelah sequencer pulih: posisi bisa **langsung** dilikuidasi di blok-blok pertama. Sequencer down harus menaikkan regime minimal ke `STRESSED`, agar trigger dinamis sudah tinggi sebelum sequencer kembali |
| Chainlink L2 Sequencer Uptime Feed | `0xFdB631F5EE196F0ed6FAa767959853A9F217697D` | `answer = 0` up, `1` down |
| Chainlink ETH/USD (proxy) | `0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612` | Peringatan dini saja |
| Chainlink USDC/USD (proxy) | `0x50834F3163758fcC1Df9973b6e91f0F0F0434aD3` | Sinyal peg tanpa cap |
| Chainlink USDT/USD (proxy) | `0x3f3f5dF88dC9F13eac63DF89EC16ef6e7E25DdE7` | Sinyal peg |
| WETH | `0x82aF49447D8a07e3bd95BD0d56f35241523fBab1` | — |
| USDC (native) | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | — |

Gas di Arbitrum murah tetapi tetap bisa melonjak saat kongesti. T6 dipantau **relatif terhadap median**, bukan angka absolut.

---

## 5. Drop tolerance — bahasa untuk user

Untuk posisi satu collateral volatil dengan utang stablecoin, persentase penurunan yang bisa ditahan sebelum HF menyentuh 1.0 adalah `1 − 1/HF` (kebalikan dari rumus PRD §4.2).

| HF | Tahan penurunan |
|----|-----------------|
| 1.25 | ~20% |
| 1.30 | ~23% |
| 1.50 | ~33% |
| 1.60 | ~37.5% |
| 2.00 | 50% |

Pesan ke user sebaiknya memakai angka ini. Contoh: "Posisimu tahan penurunan ETH ~23%. Karena eskalasi X, trigger dinaikkan sehingga proteksi aktif lebih awal." Kalimat seperti ini lebih mudah dipahami daripada "trigger 1.30 → 1.45".

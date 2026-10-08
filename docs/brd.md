# Tahansoe — Business Requirements Document

**Version:** 0.1 (Draft)
**Last updated:** 8 Oktober 2026
**Owner:** Rakyavara Artomily (@rakaalts)
**Dokumen terkait:** [PRD](prd.md) · [Architecture](architecture.md) · [Status](status.md)

> BRD menjawab *kenapa* dan *untuk siapa*. Detail fitur ada di PRD. Angka yang ditandai *perlu validasi* belum boleh dipakai di materi publik.

---

## 1. Latar belakang bisnis

Pinjaman over-collateralized di protokol seperti Aave dan Morpho adalah salah satu use case DeFi terbesar. User meminjam stablecoin dengan jaminan aset volatil untuk likuiditas, leverage, atau menghindari menjual aset. Risiko utamanya adalah likuidasi: saat harga collateral turun cepat, posisi dilikuidasi dengan penalti, dan user kehilangan sebagian collateral yang sebenarnya bisa diselamatkan dengan intervensi lebih awal.

Kerugian ini paling sering terjadi saat **event pasar** — keputusan makro, eskalasi geopolitik, pengumuman tarif, depeg, exploit, kebangkrutan institusi. Tools automation yang ada umumnya hanya bereaksi pada threshold statis, tanpa memahami konteks dunia.

## 2. Peluang

| Peluang | Penjelasan |
|---------|------------|
| Kecerdasan konteks pasar | Belum ada produk proteksi likuidasi untuk retail yang menyesuaikan buffer berdasarkan berita, geopolitik, makro, dan sinyal teknikal secara otomatis dan bisa menjelaskan alasannya. |
| Retail di L2 | Gas murah di Arbitrum/Base membuat repay kecil yang sering jadi ekonomis. Kompetitor besar lahir di mainnet dan fokus ke posisi besar. |
| Tanpa migrasi wallet | Guardian v1 bekerja dengan `approve` dari EOA. EIP-7702 membuka jalan ke kemampuan smart account tanpa pindah wallet. |
| Morpho Blue | Market isolated dengan LLTV tinggi → posisi lebih sering mendekati likuidasi; tooling proteksinya masih sedikit. |
| Telegram-first di Asia Tenggara | Komunitas crypto Indonesia/SEA aktif di Telegram; alert + penjelasan dalam bahasa lokal adalah nilai tambah. |
| B2B / white-label | Wallet, aggregator, dan protokol lending berkepentingan menurunkan likuidasi dan bad debt pengguna mereka. |
| Grant & ekosistem | Chainlink (Automation, CCIP), program grant Arbitrum, Aave, dan Morpho. |

## 3. Target pengguna

| Persona | Profil | Kebutuhan utama | Prioritas |
|---------|--------|-----------------|-----------|
| **Retail borrower L2** | Pinjam USDC dengan jaminan ETH/WBTC/LST di Arbitrum, posisi $1k–$100k | "Jangan sampai dilikuidasi saat saya tidur", murah, mudah | P0 |
| **Power user / leveraged** | Looping LST, beberapa posisi, beberapa protokol | Kontrol band/threshold, flash loan, deleverage, multi-chain | P1 |
| **DAO / treasury** | Treasury yang meminjam terhadap aset sendiri | Audit trail, laporan, multi-sig | P2 |
| **Partner B2B** | Wallet, aggregator, protokol | API/SDK risk score & proteksi white-label | P2 |

## 4. Proposisi nilai

> "Tahansoe membaca dunia untukmu — oracle, chart, berita, perang, kebijakan bank sentral — dan menebalkan pelindung posisi pinjamanmu sebelum badai datang. Danamu tetap di wallet-mu."

Tiga pilar: **cerdas** (multi-sinyal + explainable), **aman** (non-custodial, AI tidak bisa memindahkan dana), **murah & mudah** (L2, tanpa migrasi, Telegram).

## 5. Lanskap kompetitif

| Pemain | Model | Celah yang diisi Tahansoe |
|--------|-------|---------------------------|
| DeFi Saver | Automation non-custodial via smart wallet, threshold statis | Tanpa migrasi wallet; buffer dinamis berbasis konteks pasar |
| Instadapp / Summer.fi automation | Automation di smart account / proxy | Sama; fokus retail L2 dan Telegram |
| Tools alert (bot notifikasi, dashboard risiko) | Hanya peringatan, user tetap harus bertindak | Eksekusi otomatis + alasan |
| Platform risk institusional (risk analytics untuk protokol) | Melayani protokol, bukan borrower individu | Produk end-user; potensi kolaborasi data |

*Fitur kompetitor berubah cepat — validasi ulang sebelum dipakai di materi publik.*

## 6. Model bisnis (kandidat)

| Model | Cara kerja | Catatan |
|-------|-----------|---------|
| Fee per eksekusi | bps kecil dari jumlah yang di-repay saat proteksi berhasil | Selaras dengan nilai; harus didesain tanpa melanggar invariant non-custodial (fee dipotong di dalam alur repay yang sama, bukan hak tarik terpisah) |
| Subscription | Free: proteksi statis + alert. Pro: Risk Engine dinamis, multi-posisi, multi-chain, alert lanjutan | Pendapatan berulang; free tier menjaga adopsi |
| B2B / API | Risk score & proteksi white-label untuk wallet/protokol | Pendapatan lebih stabil, siklus penjualan lebih panjang |
| Grant | Chainlink, Arbitrum, Aave, Morpho | Pendanaan awal, bukan model jangka panjang |

**Biaya utama:** gas keeper & LINK untuk Chainlink Automation, data berita/sosial/market (lisensi API), inferensi LLM, audit kontrak, infrastruktur.

**Biaya LLM bersifat tetap, bukan per user** (*perlu validasi* setelah shadow mode). Research agents dan fusion menghitung risiko per aset dan secara global, bukan per user. Estimasi research agents + reflection: ~$17/bulan dengan model termurah (titik awal R&D), sampai ~$660/bulan jika semua peran membutuhkan tier tertinggi ([spec §3.4](specs/m3-research-agents.md#34-aturan-llm)); klasifikasi berita dihitung terpisah.

Konsekuensinya, margin naik seiring jumlah user, dan subscription Pro bisa menutup biaya tetap pada jumlah user yang kecil.

**Keputusan ([ADR 0006](decisions/0006-business-model-free-info-paid-automation.md)): informasi gratis, otomasi berbayar.**

| Sumber | Isi | Status |
|--------|-----|--------|
| Free | Proteksi statis Guardian v1, alert HF, alert kritis, regime & penjelasan research agents | Gratis untuk semua user — corong akuisisi & kepercayaan |
| **Pro (subscription)** | Dynamic trigger otomatis (Guardian v2), rekomendasi dry-run, multi-posisi & multi-chain, band kustom, laporan berkala, riwayat lengkap | Pendapatan utama; dibayar lewat transaksi/checkout terpisah, **tidak pernah** dari allowance Guardian |
| **B2B risk feed / API** | Regime + penjelasan untuk wallet, aggregator, protokol, DAO | Dibuka setelah ≥ 3 bulan scorecard live |
| Grant | Arbitrum, Chainlink, Aave, Morpho | Pendanaan awal & audit |
| ~~Fee per eksekusi on-chain~~ | — | **Tidak di v1**: melanggar invariant I1/I4 dan menciptakan insentif menaikkan regime. Hanya bisa dibuka lewat ADR baru |

Sumber data research wajib punya lisensi komersial karena output yang sama dipakai oleh Pro dan B2B.

Model pendapatan dikunci di ADR 0006. Yang masih terbuka: harga Pro, mata uang pembayaran, batas gas keeper yang ditanggung untuk user Free, dan format/harga B2B.

## 7. KPI bisnis

| KPI | Definisi | Target awal (*perlu kalibrasi*) |
|-----|----------|------------------------------|
| Protected TVL | Total nilai posisi dengan policy aktif | Ditentukan setelah testnet |
| Active protected wallets | Wallet dengan policy aktif dan allowance > 0 | — |
| Liquidations avoided | Eksekusi `protect` yang membawa posisi keluar zona trigger | — |
| Loss avoided (USD) | Estimasi penalti likuidasi yang terhindar | — |
| Telegram link rate | % user dashboard yang menghubungkan Telegram | — |
| Retensi 30 hari | User yang policy-nya masih aktif setelah 30 hari | — |
| Unit economics | Pendapatan per eksekusi vs biaya gas + data + inferensi | Positif sebelum mainnet skala besar |

## 8. Stakeholder

| Stakeholder | Kepentingan |
|-------------|-------------|
| Owner/product | Arah produk, prioritas, fundraising/grant |
| Engineering | Kontrak, engine, keeper, web app |
| User | Keamanan dana, kejelasan risiko, biaya |
| Auditor | Keamanan kontrak |
| Partner ekosistem (Aave, Morpho, Chainlink, Arbitrum) | Integrasi, grant, distribusi |

## 9. Kendala & asumsi

- **Regulasi:** produk tidak boleh diposisikan sebagai nasihat investasi atau sinyal trading. Copy dan UI harus konsisten dengan positioning di PRD §1.
- **Kepercayaan:** tanpa audit, TVL besar tidak realistis. Audit adalah gate sebelum mainnet skala penuh.
- **Liability:** proteksi bisa gagal saat black swan. Risk disclosure wajib tampil jelas.
- **Asumsi:** user bersedia memberi allowance stablecoin ke Guardian sebagai hot reserve (v1); ini perlu divalidasi lewat interview/testnet.
- **Asumsi:** sinyal berita dan sentimen menambah lead time yang berarti dibanding threshold statis. Harus dibuktikan lewat backtest (PRD §6.4) sebelum jadi klaim marketing.

## 10. Go-to-market (tahap awal)

1. Testnet Arbitrum Sepolia + demo end-to-end (posisi → crash simulasi → proteksi → alert Telegram).
2. Hackathon & grant Chainlink/Arbitrum dengan demo tersebut.
3. Waitlist → closed beta di Arbitrum One dengan cap TVL.
4. Konten edukasi (bahasa Indonesia & Inggris): cara kerja HF, studi kasus crash historis dan bagaimana dynamic buffer akan bereaksi.
5. Penjajakan partner B2B setelah metrik beta tersedia.

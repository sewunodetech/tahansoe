# FAQ: pertanyaan yang mungkin muncul dan cara menjawabnya

**Last updated:** 23 Oktober 2026

Untuk pitch, demo, juri, investor, user, dan tim protokol. Setiap jawaban dimulai dengan kalimat yang bisa diucapkan langsung, lalu detail kalau ditanya lebih jauh. Jangan menjanjikan lebih dari yang ada: kontrak belum diaudit dan baru berjalan di testnet.

Referensi: [security.md](../security.md), [protocol-impact.md](protocol-impact.md), [ADR 0002](../decisions/0002-ai-advises-rules-decide.md), [ADR 0006](../decisions/0006-business-model-free-info-paid-automation.md), [guardian-v2-execution.md](../plans/guardian-v2-execution.md).

---

## 1. Produk

### Tahansoe itu apa?
Penjaga posisi pinjaman DeFi. Kalau Health Factor posisi Aave kamu turun ke batas yang kamu tentukan, Tahansoe membayar sebagian utang dari cadangan yang sudah kamu izinkan, supaya posisi tidak dilikuidasi.

### Masalah apa yang diselesaikan?
Likuidasi terjadi saat user tidak sempat bereaksi: harga turun tengah malam, sequencer down, atau user sedang tidak di depan layar. Penalti likuidasi beberapa persen dari collateral yang dilikuidasi langsung hilang. Tahansoe bertindak otomatis, lebih awal, dan dengan biaya jauh lebih kecil.

### Bedanya dengan alert biasa atau DeFi Saver/Instadapp?
- **Alert hanya memberi tahu; Tahansoe bertindak.**
- **Soal wallet:** DeFi Saver kini sudah mendukung wallet EOA untuk Aave v3 dan Compound v3 (protokol lain masih memerlukan smart wallet/proxy). Posisi di Tahansoe selalu tetap di wallet EOA user di Aave tanpa perlu migrasi akun; user hanya memberi allowance terbatas ke kontrak tanpa admin.
- **Perbedaan nyata Tahansoe:**
  1. **3 Lapis Proteksi:** Tahansoe mengecek secara bertingkat: stablecoin di wallet (L1) → cadangan yield vault (L2) → flash deleverage/jual collateral hanya jika terpaksa (L3). L1 dan L2 tidak memerlukan swap sehingga tetap mempertahankan eksposur collateral (mis. ETH). Sementara otomasi tipikal (seperti DeFi Saver) langsung melunasi utang dengan menjual collateral via swap.
  2. **Fee Sukses:** Hanya membayar 0,15% saat posisi benar-benar diselamatkan (HF di bawah trigger statis user); aksi preemptif oleh AI risk agent sepenuhnya gratis. Sebaliknya, otomasi tipikal memungut fee otomasi 0,05% + fee swap 0,25% + gas yang dibebankan ke posisi pada setiap eksekusi.
  3. **Tanpa Minimum Utang:** Tahansoe tidak membatasi ukuran posisi ($0 minimum), sedangkan otomasi tipikal mensyaratkan minimum utang (mis. $500 di Arbitrum, $30.000 di Ethereum mainnet pada DeFi Saver).
  4. **Dynamic Trigger:** AI risk agent dapat menaikkan trigger proteksi secara preemptif saat regime pasar memburuk (selalu di dalam band yang disetujui user, ADR 0002), bukan sekadar threshold statis yang bereaksi terlambat setelah crash terjadi.

### Protokol dan chain apa yang didukung?
Saat ini Aave V3 di Arbitrum Sepolia (testnet). Arbitrum One setelah audit. Morpho Blue ada di roadmap; arsitekturnya chain-agnostic (ADR 0001).

---

## 2. Cara kerja

### Bagaimana sistem mengambil aset dari wallet user?
Lewat `approve` ERC-20 biasa dengan jumlah terbatas. Token tetap di wallet. Hanya saat HF di bawah trigger, fungsi `protect(user)` menarik token (`transferFrom`) dan langsung memakainya untuk `repay` utang user di Aave (`onBehalfOf = user`). Sisa dikembalikan.

### Bagaimana dengan aset yang ada di posisi DeFi lain?
Itu Layer 2 dan 3 (Guardian v2):
- **L2:** share vault ERC-4626 atau aToken milik user. User approve share dengan batas; Guardian me-redeem lalu repay.
- **L3:** jual sebagian collateral. Flash loan melunasi utang dulu, aWETH ditarik dan di-withdraw, WETH di-swap ke stablecoin dengan batas slippage dari oracle, lalu flash loan dilunasi. Semua dalam satu transaksi.

### Urutan layernya?
L1 (wallet) → L2 (vault) → L3 (jual collateral), bertingkat dalam satu transaksi. Tiap layer hanya dipakai sejauh layer sebelumnya belum cukup. L3 terakhir karena menjual collateral.

### Siapa yang memanggil `protect`?
Siapa saja: keeper Tahansoe (HF Sentinel), Chainlink Automation sebagai cadangan, atau user sendiri. Karena dana hanya bisa dipakai untuk repay utang user, pemanggil tidak bisa mengambil apa pun.

### Berapa yang dibayar per aksi?
Sebesar yang dibutuhkan untuk mengembalikan HF ke target, tapi tidak lebih dari cap per aksi, saldo, dan allowance. Default "Recommended" di UI = utang × (target − trigger) / target.

### Kenapa user harus mengisi jumlah? Kenapa tidak unlimited?
Jumlah itu adalah batas maksimum yang boleh dipakai Guardian, bukan pembayaran. Ada preset (Recommended, 25/50/100% utang, Max). Unlimited ditolak karena melanggar prinsip izin terbatas.

### Bagaimana kalau cadangan habis?
`protect` tidak bisa bertindak. Dashboard menampilkan "actions left" dan peringatan saat sisa kapasitas kurang dari satu aksi, dan Sentinel mengirim alert RESERVE_LOW lewat Telegram.

### Bagaimana kalau harga jatuh sangat cepat, melewati trigger dan langsung di bawah 1?
Kalau HF sudah di bawah 1, liquidator bisa bertindak di blok yang sama. Karena itu trigger minimum 1.05 dan default lebih tinggi. Di regime berisiko, agent bisa menaikkan trigger lebih awal (di dalam band user). Tidak ada sistem yang menjamin 100%; kami tidak menjanjikan itu.

### Bagaimana kalau sequencer Arbitrum down?
Aave V3 di Arbitrum One tidak memasang PriceOracleSentinel (security.md S6), jadi tidak ada grace period setelah sequencer pulih. Engine menaikkan regime saat sequencer down dan keeper siap memanggil `protect` di blok pertama setelah pulih.

---

## 3. Keamanan dan kepercayaan

### Apakah Tahansoe bisa mengambil dana user?
Tidak. Kontrak tidak punya owner, admin, fungsi withdraw, atau upgrade (I2). Token hanya bisa berpindah dari user ke Aave untuk utang user itu sendiri (I1). Kompromi penuh atas server, keeper key, atau AI kami hanya bisa berakibat "utang user dibayar lebih awal" (I4).

### Kalau ada bug di kontrak?
Kerugian maksimum dibatasi allowance yang user berikan. Kontrak belum diaudit; audit adalah syarat sebelum mainnet (S5). Kami jujur soal ini.

### Kalau kontraknya immutable, bagaimana kalau perlu update?
Kami deploy versi baru di alamat baru. Dashboard membaca semua versi dan menampilkan banner migrasi: disable dan revoke di versi lama, lalu setup di versi baru. Tidak ada proxy, jadi tidak ada yang bisa mengganti kode di bawah user.

### Bagaimana user menghentikan proteksi?
Kapan saja: `disablePolicy`, revoke allowance (approve 0), atau mencabut risk agent (I7). Tombolnya ada di dashboard.

### Apakah AI bisa memindahkan dana?
Tidak. AI tidak pernah menandatangani transaksi yang memindahkan dana (I3). Satu-satunya pengaruh AI on-chain adalah menggeser trigger di dalam band yang user setujui, dengan `validUntil`. Kalau AI mati atau datanya basi, trigger kembali ke angka statis user (I6).

### Kenapa harus percaya oracle?
Kami tidak menambah oracle. HF dibaca dari Aave sendiri (`getUserAccountData`), sama dengan yang dipakai liquidator (I5). Untuk swap L3, `minOut` dihitung dari oracle Aave dikurangi slippage maksimum.

### Bisakah bot MEV menyerang `protect`?
Pemanggil tidak mendapat apa pun, jadi tidak ada insentif untuk front-run. Swap L3 dibatasi `minOut`; sandwich yang mendorong harga di luar batas membuat transaksi revert, bukan merugikan user di luar batas itu.

---

## 4. Protokol dan ekosistem

### Apakah Tahansoe merugikan Aave?
Tidak secara berarti. Yang berkurang adalah pendapatan likuidasi, terutama milik liquidator. Supplier diuntungkan karena risiko bad debt turun, dan treasury mendapat premium flash loan 0.05% dari L3. Detail: [protocol-impact.md](protocol-impact.md).

### Apakah L3 bisa memperparah crash?
Bisa kalau banyak user bertindak bersamaan; efeknya tetap lebih kecil dari likuidasi. Mitigasi: L3 lapis terakhir, cap per aksi, batas slippage, trigger yang tidak seragam, dan trigger band yang bertindak lebih awal.

### Apakah user jadi meminjam lebih agresif?
Risiko itu ada. Dashboard menampilkan kapasitas cadangan dan apa yang terjadi saat habis, dan tidak menjanjikan perlindungan penuh.

---

## 5. AI agents

### Apa peran AI?
Dua agent: **Market Pulse** (riset pasar: empat analis, debat Hawk/Dove, assessor, regime) dan **HF Sentinel** (memantau HF tiap posisi, alert, keeper). AI memberi saran dan penjelasan; aturan deterministik yang memutuskan; kontrak yang menegakkan (ADR 0002).

### Kalau AI salah?
Paling jauh trigger bergeser di dalam band user. Proteksi statis tetap berjalan. Setiap rekomendasi dicatat dan dinilai (scorecard, reflection loop).

### Model AI apa?
Lewat satu gateway OpenAI-compatible (ADR 0009), jadi model bisa diganti tanpa mengubah kode.

---

## 6. Bisnis

### Bagaimana Tahansoe menghasilkan uang?
Informasi gratis untuk semua (alert HF, alert kritis, regime, penjelasan riset, dan proteksi statis). Otomasi lanjutan berbayar (Pro): dynamic trigger, rekomendasi trigger, multi-posisi dan multi-chain, laporan berkala (ADR 0006).

### Ada fee on-chain?
Saat ini tidak ada fee — kontrak yang di-deploy di testnet tidak memungut fee apa pun. Ke depan, diusulkan fee sukses sebesar 0,15% (15 bps) dari jumlah repay hanya saat posisi benar-benar diselamatkan (ADR 0013, status Proposed). Fee ini hanya berlaku jika HF turun di bawah trigger statis pilihan user dan di bawah 1,50; aksi preemptif yang dipicu AI tetap 100% gratis.

### Siapa yang membayar gas keeper?
Tahansoe, sebagai biaya operasional. Chainlink Automation (LINK) sebagai cadangan.

### Siapa pelanggannya?
Peminjam DeFi aktif dengan posisi menengah ke atas, DAO treasury dengan posisi pinjaman, dan (B2B) protokol atau wallet yang ingin menawarkan proteksi likuidasi ke usernya.

---

## 7. Demo dan status

### Apa yang sudah jalan?
- Guardian v1 (Layer 1) live di Arbitrum Sepolia `0x1A5D249A8e711E2288AdD7c01e31Eb7FFB05D97E`.
- Dashboard mode Live membaca posisi Aave asli dan policy on-chain; mode Demo untuk simulasi.
- Bot Telegram @cuustos_bot.
- Guardian v2 (L1–L3), HF Sentinel, dan keeper: lihat [guardian-v2-execution.md](../plans/guardian-v2-execution.md) untuk status terkini.

### Kenapa L3 di testnet memakai mock router?
Pool Uniswap untuk token test Aave di Arbitrum Sepolia hampir kosong (sekitar 158 USDC) dan harganya jauh dari oracle. Mock router dihargai dari oracle Aave. Swap dengan likuiditas nyata diuji lewat fork test Arbitrum One.

### Bagaimana mendemokan proteksi di testnet kalau harga tidak bisa digerakkan?
Pinjam sampai HF sekitar 1.4, set trigger di atasnya (misalnya 1.5), lalu tekan "Run protect now". Transaksinya nyata dan terlihat di Arbiscan.

### Apa yang belum ada?
Audit, mainnet, Morpho, dan multi-chain. Sebutkan ini terus terang kalau ditanya.

---

## Pertanyaan sulit, jawaban singkat

| Pertanyaan | Jawaban |
|---|---|
| "Kalau server kalian di-hack?" | Paling buruk utang user dibayar lebih awal. Dana tidak bisa diambil (I4). |
| "Kenapa tidak pakai Safe module?" | v1 sengaja EOA + approve terbatas supaya user tidak perlu migrasi wallet (ADR 0003). |
| "Apa bedanya dengan auto-repay di protokol?" | Lintas sumber dana (wallet, vault, collateral), trigger dinamis dari riset pasar, dan tidak terikat satu protokol. |
| "Apa yang terjadi kalau Tahansoe tutup?" | Kontrak tetap jalan tanpa kami. Siapa pun bisa memanggil `protect`, dan user bisa revoke kapan saja. |
| "Kenapa harus percaya angka 'Recommended'?" | Rumusnya terbuka dan sama dengan `quoteRepay` di kontrak. Diverifikasi terhadap posisi nyata di Aave Sepolia. |

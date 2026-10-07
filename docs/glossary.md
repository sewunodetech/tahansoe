# Glossary

| Istilah | Arti |
|---------|------|
| **Health Factor (HF)** | `(Σ collateral × liquidationThreshold) / totalDebt`. Di bawah 1.0 posisi bisa dilikuidasi. Di kontrak disimpan dalam skala 1e18 (WAD). |
| **Liquidation Threshold (LT)** | Persentase nilai collateral yang diperhitungkan untuk HF di Aave. Di Morpho Blue padanannya **LLTV** per market. |
| **Trigger HF** | HF di mana proteksi dijalankan. Statis (diset user) atau dinamis (dari Risk Engine, di dalam band). |
| **Target HF** | HF yang dituju setelah remediasi. |
| **Risk band** | Rentang `[minTriggerHF, maxTriggerHF]` yang disetujui user; trigger dinamis tidak boleh keluar dari band ini (Guardian v2). |
| **Risk agent** | Alamat yang dipilih user untuk menulis trigger dinamis (Guardian v2). Bisa dicabut user. |
| **Guardian** | Kontrak `TahansoeGuardian` yang mengeksekusi remediasi. v1: approve dari EOA + `protect()`. |
| **Hot reserve** | Saldo debt asset di wallet user yang di-approve ke Guardian untuk repay. |
| **Warm reserve** | Reserve yang ditempatkan di venue ber-yield; ada latensi penarikan. |
| **Flash loan repay** | Pinjam sementara untuk repay, lalu tarik dan jual collateral dalam satu transaksi. |
| **Deleverage** | Menjual sebagian collateral untuk membayar utang. |
| **Intent** | Objek keputusan dari rule engine (`REPAY` / `SUPPLY_COLLATERAL` / `DELEVERAGE` / `NOOP`) sebelum menjadi transaksi. |
| **Signal** | Satu observasi terstruktur dari modul (oracle, technical, onchain, macro, news, social) dengan severity, confidence, dan `expiresAt`. |
| **RiskAssessment** | Output fusion per aset: regime, risk score, estimasi drawdown, rekomendasi trigger, alasan. |
| **Regime** | Kondisi pasar: `CALM`, `ELEVATED`, `STRESSED`, `CRISIS`. |
| **Drawdown estimate** | Estimasi penurunan harga kuantil tinggi (mis. p99) dalam horizon tertentu (4 jam, 24 jam). |
| **Keeper** | Proses yang memantau dan memanggil fungsi Guardian. Dev: cron + viem; prod: Chainlink Automation. |
| **Heartbeat / deviation threshold** | Aturan update Chainlink feed: update saat harga bergerak melewati threshold atau saat interval heartbeat habis. |
| **Sequencer uptime feed** | Feed Chainlink di L2 yang menandai apakah sequencer sedang down. |
| **Dry-run** | Menjalankan engine/rule tanpa mengirim transaksi; hanya mencatat dan menampilkan rekomendasi. |
| **Chain registry** | Konfigurasi terpusat untuk semua hal spesifik chain (RPC, alamat, feeds). |

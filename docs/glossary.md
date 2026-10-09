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
| **Transmission path (T1–T10)** | Jalur bagaimana event dunia nyata berujung likuidasi: harga, volatilitas, leverage cascade, depeg stablecoin, depeg LST, gas, likuiditas reserve, oracle, insiden protokol, sequencer. Lihat [knowledge](knowledge/risk-transmission.md). |
| **Research agents** | Lapis multi-agent di engine: analyst paralel → debat Hawk/Dove → Risk Assessor. Output-nya satu `Signal` `RESEARCH` ([ADR 0004](decisions/0004-multi-agent-research-layer.md)). |
| **Hawk / Dove** | Dua agent debat: Hawk berargumen risiko naik, Dove berargumen sinyal hanya noise atau sudah ter-price-in. |
| **Risk Assessor** | Agent yang menyimpulkan laporan analyst dan debat menjadi `ResearchReport`. Tidak memutuskan regime final; itu tugas fusion. |
| **ResearchReport** | Output terstruktur research agents: proposed regime, jalur yang dinilai, perkembangan kunci, argumen Hawk/Dove, confidence, horizon. |
| **Settlement** | Pelabelan penilaian risiko setelah horizonnya: `TRUE_POSITIVE`, `FALSE_POSITIVE`, `MISSED`, `TRUE_NEGATIVE`, plus lead time ([ADR 0005](decisions/0005-reflection-loop.md)). |
| **Lesson (reflection)** | Pelajaran singkat dari settlement yang disisipkan sebagai konteks ke Risk Assessor. Tidak pernah mengubah aturan. |
| **Lead time** | Selisih waktu antara regime pertama kali ≥ `STRESSED` dan titik terburuk sebuah event. |
| **Shadow mode** | Engine jalan live, tetapi hasilnya hanya terlihat oleh tim; tahap pertama sebelum berdampak ke user. |
| **Drop tolerance** | Penurunan harga collateral yang bisa ditahan sebelum HF = 1: `1 − 1/HF`. Bahasa yang dipakai untuk menjelaskan risiko ke user. |

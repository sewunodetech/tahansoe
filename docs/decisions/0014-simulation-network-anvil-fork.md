# 0014 — Jaringan simulasi: fork anvil di VPS, layanan `apps/simnet`

- **Status:** Proposed (arah disetujui owner 2026-10-24)
- **Tanggal:** 2026-10-24
- **Pengusul:** Owner, ditulis oleh Claude Code

## Konteks

Mentor meminta *user proof*: calon user harus bisa mencoba Tahansoe tanpa wallet asli, tapi tetap on-chain. Rinciannya ada di [spec simulation mode](../specs/m1-simulation-mode.md). Ada tiga kebutuhan:

1. Fork Arbitrum One yang berisi Aave V3 dan Uniswap asli.
2. Harga yang **mengikuti mainnet**, ditambah kemampuan memutar ulang atau memaksa crash.
3. Biaya nol untuk tahap sekarang.

Fakta yang relevan:

- Simulasi DeFi Saver membuat fork saat simulasi dimulai dan membekukan harga ([sumber](https://help.defisaver.com/features/simulation-mode)).
- Tenderly Virtual TestNets punya State Sync yang menyamakan state dengan mainnet, tapi fitur itu butuh paket berbayar ([sumber](https://docs.tenderly.co/virtual-testnets/state-sync)).
- anvil (Foundry) gratis, sudah dipakai tim untuk fork test, dan bisa fork dari RPC publik Arbitrum.
- VPS engine (2 vCPU, 3,7 GB RAM, sekitar 3 GB bebas per 24 Okt 2026) baru dipakai sekitar 700 MB oleh engine.
- [ADR 0007](0007-monorepo-structure-and-runtime.md): web dan engine tidak saling import; kode bersama hanya lewat `packages/*`.

## Keputusan

1. **Fork memakai anvil di VPS yang sama dengan engine**, di container terpisah dengan batas memori sendiri, supaya engine produksi tidak terganggu.
2. **Workspace baru `apps/simnet`** (Node), dengan tugas:
   - Session API berotentikasi API key;
   - fork manager (spawn/kill anvil);
   - RPC proxy dengan allowlist method;
   - faucet;
   - price relay mainnet → fork;
   - pemutar skenario;
   - keeper simulasi.

   Simnet hanya mengimpor `packages/*`, tidak mengimpor web atau engine.
3. **Engine produksi tidak pernah menyentuh fork.** Keeper simulasi hidup di simnet. Dengan begitu bug atau beban simulasi tidak bisa memengaruhi sentinel dan broadcaster asli.
4. **Topologi fork:**
   - satu fork bersama untuk mode Live (harga sama untuk semua, wallet per sesi), di-reset harian;
   - fork pribadi yang hidup selama dipakai dan dibersihkan setelah 30 menit idle (maksimal 4 di awal) untuk Replay dan Stress.
5. **Harga mengikuti mainnet lewat relay**, bukan sinkron state penuh. Simnet mengganti sumber harga WETH di AaveOracle fork ke `SimPriceFeed` (impersonate admin ACL Aave di fork), lalu relay menulis harga Chainlink ETH/USD Arbitrum One setiap beberapa detik. Eksekusi tetap membaca AaveOracle (I5).
6. **Chain ID simulasi berbeda** (`4216199`, bisa dikonfigurasi) agar transaksi tidak bisa di-replay di mainnet dan data tidak tercampur.
7. **Antarmuka standar JSON-RPC.** Web hanya mengenal "URL RPC + chain ID simulasi". Pindah ke Tenderly atau penyedia lain nanti hanya mengganti simnet, tidak menyentuh web.

## Alternatif yang dipertimbangkan

| Opsi | Kelebihan | Kekurangan |
|------|-----------|------------|
| Tenderly Virtual TestNets + State Sync | Sinkron state penuh dengan mainnet, explorer bawaan, tanpa ops | Berbayar (State Sync lewat sales); kuota; ketergantungan vendor |
| Simulasi in-memory saja (Demo / Position Lab) | Gratis, sudah ada | Bukan on-chain; mentor meminta bukti on-chain |
| Arbitrum Sepolia (testnet asli) | Chain publik, explorer Arbiscan | Harga tidak bisa digerakkan; likuiditas Uniswap testnet hampir kosong; faucet terbatas |
| anvil per sesi untuk semua mode | Isolasi penuh | RAM VPS cepat habis; tidak perlu untuk mode Live yang harganya sama untuk semua |
| **anvil di VPS: fork bersama (Live) + fork pribadi (Replay/Stress) + relay harga** | Gratis; harga ikut mainnet; crash bisa disimulasikan; isolasi dari engine | Ops sendiri; tanpa explorer; state selain harga tidak ikut sinkron; kapasitas terbatas |

## Konsekuensi

- **Positif:**
  - Biaya nol.
  - Demo on-chain dengan harga mainnet dan crash yang bisa diputar ulang, sesuatu yang tidak dimiliki simulasi DeFi Saver.
  - Jalur kode dashboard Live dipakai ulang.
- **Negatif / biaya:**
  - Menambah satu layanan untuk dioperasikan (Docker, restart, log).
  - Kapasitas fork pribadi terbatas oleh RAM VPS.
  - Harga pool Uniswap di fork tidak ikut relay, sehingga hasil swap L3 di simulasi bisa berbeda dari oracle.
  - Butuh domain HTTPS publik untuk RPC proxy (Cloudflare Tunnel).
- **Dampak ke invariant keamanan ([security.md](../security.md)):**
  - Tidak ada perubahan pada I1–I8 di chain nyata.
  - `SimPriceFeed` punya setter, tapi hanya boleh di-deploy di chain simulasi; script deploy menolak chain ID lain.
  - RPC proxy wajib memblokir method cheat anvil.
  - Sesi simulasi terpisah dari sesi SIWE dan tidak bisa membaca data user asli.
- **Dokumen yang perlu diperbarui saat Accepted:**
  - architecture.md: komponen simnet dan topologi deploy.
  - ADR 0007 (catatan workspace baru, tanpa mengubah isinya).
  - README cara menjalankan simnet lokal.
  - status.md.
  - security.md §2: baris threat model simnet.

## Pertanyaan terbuka

- Batas RAM per fork aktual: diukur saat prototipe, lalu `SIM_MAX_PRIVATE_FORKS` disesuaikan.
- RPC publik Arbitrum (`arb1.arbitrum.io`) cukup, atau perlu paket gratis Alchemy/Infura?
- Kapan pindah ke Tenderly: misalnya bila sesi bersamaan rutin melebihi kapasitas VPS, atau butuh explorer untuk demo juri.

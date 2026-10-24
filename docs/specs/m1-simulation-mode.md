# Spec: Simulation Mode — coba Tahansoe dengan wallet simulasi di fork Arbitrum One

- **Milestone:** M1 integrasi end-to-end ([PRD §10](../prd.md#10-roadmap-eksekusi)); memenuhi [BRD §8](../brd.md) poin 1 "demo end-to-end (posisi → crash simulasi → proteksi → alert Telegram)"
- **Status:** Draft
- **Pemilik:** Tim Web + Tim Engine
- **Terkait:** [ADR 0014](../decisions/0014-simulation-network-anvil-fork.md), [ADR 0013](../decisions/0013-success-fee-on-protection.md), [ADR 0001](../decisions/0001-arbitrum-first-chain-agnostic.md), [ADR 0007](../decisions/0007-monorepo-structure-and-runtime.md), [spec M1 web on-chain](m1-web-onchain-integration.md), [risk-transmission.md §3](../knowledge/risk-transmission.md), [security.md](../security.md)

## 1. Tujuan

Calon user belum mau menghubungkan wallet asli ke produk yang belum mereka percaya. Simulation Mode memberi mereka **wallet simulasi** di **fork Arbitrum One** yang berisi pool Aave V3 asli dan kontrak Guardian sungguhan.

Di sana user bisa:
- top up collateral, membuka posisi borrow, dan mengatur layer proteksi;
- melihat harga bergerak **mengikuti mainnet** secara real-time;
- memutar ulang crash historis atau menekan "crash" sendiri;
- menyaksikan L1 → L2 → L3 menyelamatkan posisinya, dengan transaksi nyata dan fee sukses ([ADR 0013](../decisions/0013-success-fee-on-protection.md)).

Tujuannya *user proof*: user merasakan cara kerja produk sebelum mempertaruhkan dana. Ini juga pembeda dari simulasi DeFi Saver, yang membekukan harga di awal simulasi ([sumber](https://help.defisaver.com/features/simulation-mode)).

## 2. Scope

**Termasuk:**
- Halaman `/connect`: dua pilihan, **"Connect wallet"** (alur SIWE yang sudah ada) dan **"Coba simulasi dulu"**.
- Wallet simulasi: private key burner dibuat di browser dan dipakai lewat wagmi connector khusus ke chain simulasi.
- Layanan `apps/simnet` di VPS ([ADR 0014](../decisions/0014-simulation-network-anvil-fork.md)):
  - mengelola proses anvil;
  - RPC proxy dengan allowlist method;
  - faucet;
  - relay harga mainnet;
  - pemutar skenario;
  - keeper simulasi.
- Tiga mode harga:

  | Mode | Fork | Harga |
  |---|---|---|
  | **Live** (default) | Satu fork bersama untuk semua sesi | Ikut harga ETH Arbitrum One real-time |
  | **Replay** | Fork pribadi berumur pendek | Memutar ulang crash historis, dipercepat |
  | **Stress** | Fork pribadi berumur pendek | Harga live, lalu tombol "Crash −10% / −30% / −50%" |

- Dashboard dalam mode simulasi memakai jalur kode **Live** yang sudah ada (baca posisi Aave, `approve`, `setPolicy`), hanya chain-nya diganti ke chain simulasi.
- Banner "MODE SIMULASI — dana palsu, harga [live/replay/stress]" di semua halaman dashboard.
- Daftar transaksi simulasi (hash, aksi, HF sebelum dan sesudah, fee) sebagai pengganti explorer.
- Panel "Tanpa Tahansoe": HF dan perkiraan potongan likuidasi untuk posisi yang sama tanpa proteksi, dihitung dengan `packages/domain`.
- Tabel `sim_sessions` untuk metrik funnel (mulai simulasi → posisi dibuka → proteksi terpicu → connect wallet asli).
- CTA di akhir simulasi: "Lindungi posisi aslimu" → `/connect` alur wallet.

**Tidak termasuk:**
- Alert Telegram untuk sesi simulasi (fase 2, lihat §7).
- Liquidator bot di fork. Likuidasi ditampilkan sebagai perhitungan di panel "Tanpa Tahansoe".
- Mensimulasikan posisi wallet asli user di fork (fase 2).
- Protokol selain Aave V3, dan aset collateral selain WETH (fase 1).
- Tenderly atau penyedia fork berbayar (ADR 0014; bisa menyusul tanpa mengubah web).
- Mengganti Position Lab di landing page, yang tetap sebagai simulasi in-browser yang ringan.

## 3. Desain

### 3.1 Komponen

```
Browser (web)                          VPS (apps/simnet)
──────────────                         ─────────────────────────────────────
/connect → "Coba simulasi"             Session API  (HTTPS, dipanggil server web)
  └─ POST /api/sim/session ──────────►   ├─ buat/ambil sesi, pilih fork
      (route web, server-side,           ├─ faucet (ETH, WETH, USDC)
       pakai SIMNET_API_KEY)             ├─ scenario: replay / crash
                                         └─ status sesi
burner key (localStorage)
wagmi simConnector ── JSON-RPC ──────► RPC proxy  /rpc/:forkId   (allowlist eth_*)
                                         └─► anvil (shared-live | private-N)
Dashboard (jalur Live, chain = sim)
                                       Price relay  ── baca Arbitrum One ──► mock feed di tiap fork
                                       Sim keeper   ── needsProtection → protect() di tiap fork
```

### 3.2 Chain simulasi dan registry

- anvil berjalan dengan `--fork-url <ARB_ONE_RPC>` dan **`--chain-id 4216199`** (`SIM_CHAIN_ID`, dikonfigurasi). Chain ID dibuat berbeda agar transaksi simulasi tidak bisa di-replay di mainnet, dan agar data tidak tercampur di DB.
- `packages/domain/chains.ts` mendapat entri `ARBITRUM_ONE_SIM`:
  - alamat Aave dan token sama dengan `ARBITRUM_ONE`;
  - `rpcUrls` diisi URL proxy publik simnet, dengan path fork disisipkan per sesi;
  - `guardians` diisi alamat Guardian di fork;
  - flag `isSimulation: true`.
- Guardian di-deploy saat fork dibuat oleh deployer anvil yang tetap (nonce 0), sehingga **alamatnya deterministik** di setiap fork dan bisa ditulis di registry.
  - Versi: v2 sampai v3 (fee) siap.
  - Selama masih v2, UI menampilkan "fee yang akan dipotong" dari `simulateCascade` dan memberi label perkiraan.
- L3 memakai Uniswap V3 `SwapRouter02` asli di Arbitrum One, dengan likuiditas nyata di fork.
- L2 memakai vault ERC-4626 nyata yang dipilih di ADR 0014 §pertanyaan terbuka, atau `TestVault` yang di-deploy di fork.

### 3.3 Menggerakkan harga

Saat fork dibuat, simnet:
1. Men-deploy `SimPriceFeed`, aggregator Chainlink-compatible dengan `latestRoundData` yang bisa di-set oleh simnet.
2. Meniru (impersonate) pemegang role `POOL_ADMIN` atau `ASSET_LISTING_ADMIN` dari ACLManager Aave, lalu memanggil `AaveOracle.setAssetSources([WETH], [SimPriceFeed])`. Guardian dan Aave tetap membaca **oracle Aave** (I5); yang berubah hanya sumber datanya.

Mode harga:
- **Live:** price relay membaca proxy Chainlink ETH/USD Arbitrum One (`priceFeeds["ETH/USD"]` di registry) setiap 5 detik dan menulis ke `SimPriceFeed` di fork bersama dan di semua fork Stress yang belum di-crash.
- **Replay:** jalur harga dari fixture `apps/simnet/scenarios/*.json` (timestamp, harga), diputar dengan percepatan (misalnya 24 jam → 3 menit).
  - Fixture dibuat sekali oleh script dari data historis publik, lalu di-commit.
  - Skenario awal dipilih dari katalog [risk-transmission.md §3](../knowledge/risk-transmission.md): Agu 2024 (unwind yen carry), Okt 2025 (tarif AS–China), Mar 2020 (Black Thursday). Untuk 2020, data Arbitrum belum ada, jadi harga ETH diskalakan ke harga awal fork. UI memberi label "harga dinormalisasi".
- **Stress:** harga live sampai user menekan crash. Harga lalu turun bertahap selama sekitar 20 detik ke target, bukan sekaligus, agar keeper dan UI bisa mengikuti.
- **Keterbatasan:** harga oracle di fork bisa berbeda dari harga pool Uniswap di fork, yang tetap mengikuti saat fork dibuat. Dampaknya hanya hasil swap L3 yang bisa lebih baik dari oracle. `minOut` tetap dihitung dari oracle. Catat di UI sebagai "harga swap simulasi".

### 3.4 Fork bersama vs pribadi

| | Live (bersama) | Replay / Stress (pribadi) |
|---|---|---|
| Jumlah | 1 | Maksimal `SIM_MAX_PRIVATE_FORKS` (awal 4) |
| Umur | Di-reset harian pukul 04:00 WIB ke blok terbaru mainnet | 15 menit sejak dibuat, bisa diperpanjang sekali |
| Isolasi | Wallet per sesi; harga sama untuk semua | Satu sesi per fork |
| Bila penuh | — | Antrean, atau tawarkan mode Live |

Saat fork bersama di-reset, semua posisi Live hilang. UI memberi tahu "simulasi direset harian".

### 3.5 Wallet simulasi dan sesi

- Browser membuat private key burner (`generatePrivateKey` dari viem) dan menyimpannya di `localStorage` (`tahansoe:sim-key`). Key ini **hanya** untuk chain simulasi dan tidak pernah dikirim ke server. Server hanya menerima alamatnya.
- `simConnector`: connector wagmi berbasis `privateKeyToAccount` dan transport `http(proxyUrl/forkId)`. Transaksi ditandatangani di browser lalu dikirim lewat `eth_sendRawTransaction`.
- `POST /api/sim/session` (route web, server-side):
  - body: `{ address, mode }`;
  - meneruskan ke simnet dengan `SIMNET_API_KEY`;
  - menulis `sim_sessions`;
  - menyimpan `session.sim = { sessionId, address, forkId, mode, expiresAt }` di iron-session.

  Sesi simulasi **terpisah** dari sesi SIWE: tidak ada baris `users`, dan tidak ada akses ke route data user asli.
- Faucet saat sesi dibuat: 10 ETH (gas + collateral) dan 5.000 USDC (cadangan L1).
  - Tombol "Top up" menambah sampai batas per sesi: maksimal 100 ETH dan 50.000 USDC.
  - ETH diisi dengan `anvil_setBalance`. ERC-20 diisi dengan menulis slot balance (`anvil_setStorageAt`), dengan slot per token dicatat di config simnet.
- Wizard langkah awal:
  1. Supply ETH sebagai collateral.
  2. Borrow USDC.
  3. Pilih trigger/target dan layer.
  4. Approve + `setPolicy`.

  Ada opsi "Isi otomatis" yang mengirim semua transaksi itu berurutan dengan posisi contoh (2 ETH collateral, HF awal sekitar 1,8).

### 3.6 Keeper simulasi

Simnet menjalankan loop per fork setiap 2 detik:
1. Ambil daftar user Guardian (`usersPage`).
2. Untuk tiap user, cek `needsProtection(user)`; bila true, panggil `protect(user)` dari akun keeper anvil.

Hasilnya (event `Protected`, `LayerUsed`, nanti `FeeCharged`) disimpan di memori sesi dan dibaca UI lewat endpoint status. Keeper ini **terpisah** dari sentinel engine produksi: engine tidak pernah menyentuh fork (lihat ADR 0014).

### 3.7 RPC proxy (wajib)

anvil membuka method cheat (`anvil_*`, `evm_*`, `hardhat_*`, `debug_*`, `eth_sendTransaction` dengan akun unlocked). Proxy hanya meneruskan allowlist:

- `eth_chainId`, `eth_blockNumber`, `eth_call`, `eth_estimateGas`, `eth_gasPrice`, `eth_maxPriorityFeePerGas`, `eth_feeHistory`
- `eth_getBalance`, `eth_getCode`, `eth_getStorageAt`, `eth_getTransactionCount`
- `eth_getTransactionByHash`, `eth_getTransactionReceipt`, `eth_getBlockByNumber`, `eth_getLogs`
- `eth_sendRawTransaction`, `net_version`

Method lain ditolak dengan error JSON-RPC `-32601`. Proxy juga membatasi request per IP dan per fork (misalnya 30 req/detik), dan menolak `eth_getLogs` dengan rentang lebih dari 10.000 blok. Port anvil hanya mendengarkan di `127.0.0.1`.

### 3.8 Perubahan file

| File | Jenis | Isi |
|---|---|---|
| `apps/simnet/` | Baru (workspace) | Session API, RPC proxy, fork manager (spawn/kill anvil), price relay, scenario player, sim keeper, config, Dockerfile |
| `apps/simnet/scenarios/*.json` | Baru | Fixture harga historis |
| `contracts/src/testnet/SimPriceFeed.sol` | Baru | Aggregator mock yang bisa di-set (hanya untuk fork) |
| `contracts/script/DeploySim.s.sol` | Baru | Deploy Guardian, SimPriceFeed, dan (opsional) TestVault di fork; ganti sumber oracle WETH |
| `packages/domain/src/chains.ts` | Edit | `ARBITRUM_ONE_SIM`, `isSimulation` |
| `packages/db/src/schema.ts` | Edit | Tabel `sim_sessions` |
| `apps/web/app/connect/page.tsx` | Edit | Pilihan "Coba simulasi dulu" |
| `apps/web/lib/sim/` | Baru | Burner key, `simConnector`, klien status simnet |
| `apps/web/app/api/sim/*` | Baru | `session`, `faucet`, `scenario`, `status` (proxy server-side ke simnet) |
| `apps/web/lib/dashboard-mode.tsx` | Edit | Mode ketiga `simulation` di samping `live`/`demo`; chain aktif mengikuti mode |
| `apps/web/components/dashboard/sim/*` | Baru | Banner, panel skenario, daftar tx, panel "Tanpa Tahansoe", wizard |
| `apps/web/lib/wagmi-config.ts` | Edit | Chain simulasi + transport |

Mode `demo` in-memory yang lama tetap ada sebagai cadangan bila simnet mati (I6, semangat graceful degradation).

### 3.9 Skema DB

```ts
sim_sessions: {
  id: uuid pk,
  address: text,               // alamat burner, lowercase
  mode: text,                  // "live" | "replay" | "stress"
  scenario: text | null,       // id skenario replay
  forkId: text,
  createdAt: timestamptz,
  positionOpenedAt: timestamptz | null,
  firstProtectAt: timestamptz | null,
  layersUsed: integer[] | null,
  convertedAt: timestamptz | null, // user lalu sign-in dengan wallet asli dari CTA simulasi
  userAgentHash: text | null,      // tanpa IP mentah
}
```

### 3.10 Environment

- **Web:** `SIMNET_URL`, `SIMNET_API_KEY` (server-only), `NEXT_PUBLIC_SIM_RPC_BASE`, `NEXT_PUBLIC_SIM_CHAIN_ID`.
- **Simnet:** `ARB_ONE_RPC_URL`, `SIMNET_API_KEY`, `SIM_CHAIN_ID`, `SIM_MAX_PRIVATE_FORKS`, `SIM_PRIVATE_TTL_MIN`, `SIM_PORT`.

## 4. Dampak keamanan

- **I1:** tidak ada jalur dana baru di produksi. Semua dana di fork palsu. Guardian di fork adalah bytecode yang sama dengan rilis resmi.
- **I2:** `SimPriceFeed` punya setter, tapi **hanya di-deploy di fork** dan tidak pernah di chain nyata. Script deploy simulasi menolak berjalan bila `block.chainid` ≠ `SIM_CHAIN_ID`.
- **I3:** AI tidak terlibat di fase 1. Bila nanti dynamic trigger ditampilkan, tetap lewat `setDynamicTrigger` dalam band.
- **I4:** kalau simnet dibobol, akibat terburuknya fork rusak atau mati dan demo terganggu. Tidak ada dana nyata. `SIMNET_API_KEY` hanya bisa mengakses simnet. Burner key tidak punya nilai di chain lain berkat chain ID berbeda.
- **I5:** eksekusi tetap membaca AaveOracle di fork. Simulasi mengganti sumber oracle secara terang-terangan dan memberi label di UI.
- **I6:** simnet mati → `/connect` menyembunyikan pilihan simulasi atau mengarahkan ke Demo in-memory, dan alur wallet asli tidak terpengaruh.
- **I7:** sesi bisa diakhiri kapan saja ("Keluar simulasi" menghapus burner key dan cookie sim).
- **I8:** `SIMNET_API_KEY` dan `ARB_ONE_RPC_URL` hanya di env server. Burner key ada di browser, tapi memang dirancang tanpa nilai.
- **Input eksternal:**
  - Semua body API divalidasi Zod: alamat checksum, mode enum, jumlah faucet dibatasi.
  - Method RPC di-allowlist.
  - Rate limit per IP dan per sesi.
  - Session API simnet tidak diekspos tanpa API key.
- **Pemisahan data:** sesi simulasi tidak pernah membuat baris `users`, `policies`, atau `telegram_accounts`, dan tidak bisa membaca route data user asli. Proteksi `/dashboard` di server (S3) harus membedakan `session.sim` dan sesi SIWE.

## 5. Kriteria penerimaan

- [ ] Di `/connect`, user bisa memilih "Coba simulasi dulu" dan masuk dashboard dalam kurang dari 10 detik tanpa extension wallet.
- [ ] Wallet simulasi menerima saldo awal; tombol top-up bekerja sampai batas per sesi.
- [ ] User bisa supply WETH, borrow USDC, approve, dan `setPolicy` dengan transaksi nyata di fork. Dashboard menampilkan posisi dari Aave di fork.
- [ ] Mode Live: harga ETH di dashboard simulasi berbeda kurang dari 0,5% dari Chainlink Arbitrum One, dengan jeda kurang dari 10 detik.
- [ ] Mode Replay (minimal 2 skenario) dan Stress memicu `protect()`. Daftar transaksi menampilkan layer yang dipakai, HF sebelum dan sesudah, serta fee (aktual atau perkiraan).
- [ ] Panel "Tanpa Tahansoe" menampilkan HF dan perkiraan potongan likuidasi untuk posisi yang sama.
- [ ] Method RPC cheat (misalnya `anvil_setBalance`) dari browser ditolak proxy.
- [ ] Fork pribadi dihapus otomatis setelah TTL. Jumlah fork pribadi tidak pernah melebihi batas.
- [ ] Simnet mati → `/connect` tetap berfungsi untuk wallet asli dan menampilkan fallback Demo.
- [ ] `sim_sessions` mencatat funnel. CTA "Lindungi posisi aslimu" mengisi `convertedAt` saat user lanjut sign-in.
- [ ] Banner mode simulasi selalu terlihat di dashboard simulasi.

## 6. Rencana test

- **Unit (simnet):** allowlist proxy, parser fixture skenario, interpolasi percepatan replay, batas faucet, TTL fork manager.
- **Integrasi (simnet + anvil lokal):** buat fork → deploy → posisi contoh → crash −30% → keeper memanggil `protect` → HF ≥ target.
- **Forge script test:** `DeploySim.s.sol` di fork Arbitrum One; `setAssetSources` berhasil; Guardian membaca harga baru.
- **Web:** typecheck + lint; Playwright alur `/connect` → simulasi → isi otomatis → Stress crash → receipt muncul (lokal dengan simnet di laptop).
- **Beban:** 4 fork pribadi + fork bersama di VPS 2 vCPU / 3,7 GB. Ukur RAM per fork dan pastikan engine produksi tidak terganggu (memory limit container).

## 7. Pertanyaan terbuka

- Vault ERC-4626 nyata mana di Arbitrum One yang dipakai untuk L2, atau cukup `TestVault`?
- Alert Telegram `[SIMULASI]` di fase 2: perlu link Telegram tanpa SIWE. Apakah memakai kode link sementara yang terikat `sim_sessions`?
- "Simulasikan posisi asli saya" (fase 2): baca posisi wallet asli, lalu salin ke fork dengan `anvil_impersonateAccount`. Perlu review privasi.
- Domain publik untuk RPC proxy (misalnya `sim.tahansoe.xyz` lewat Cloudflare Tunnel yang sudah direncanakan).
- RPC Arbitrum One: RPC publik cukup untuk awal; perlu paket gratis Alchemy/Infura bila kena rate limit.

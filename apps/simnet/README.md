# @tahansoe/simnet — jaringan simulasi (fork anvil Arbitrum One)

Layanan Simulation Mode: fork anvil Arbitrum One berisi Aave V3 asli + Guardian, dengan harga yang mengikuti mainnet, replay crash historis, dan tombol crash. Acuan: [spec simulation mode](../../docs/specs/m1-simulation-mode.md) dan [ADR 0014](../../docs/decisions/0014-simulation-network-anvil-fork.md).

Simnet hanya mengimpor `packages/*` (ADR 0007); tidak mengimpor `apps/web` atau `apps/engine`. Engine produksi tidak pernah menyentuh fork.

## Komponen

| Modul | Isi |
|---|---|
| `src/anvil.ts` | Spawn/kill `anvil --fork-url … --chain-id … --host 127.0.0.1 --port <bebas>` |
| `src/forks.ts` | Fork manager: 1 fork Live bersama (reset harian 04:00 WIB) + maks. `SIM_MAX_PRIVATE_FORKS` fork pribadi, TTL `SIM_PRIVATE_TTL_MIN`, bisa diperpanjang sekali |
| `src/deploy.ts` | Deploy kontrak ke fork (lihat "Deploy kontrak" di bawah) |
| `src/oracle.ts` | Impersonate ACL admin Aave → `AaveOracle.setAssetSources([WETH],[SimPriceFeed])`; tulis harga lewat `setAnswer` |
| `src/relay.ts` | Baca Chainlink ETH/USD Arbitrum One (`priceFeeds["ETH/USD"]`) tiap 5 detik |
| `src/price-controller.ts` | Status harga per fork: mainnet → replay/stress |
| `src/scenario.ts` | Fixture `scenarios/*.json`, interpolasi + kompresi waktu (24 jam → 3 menit), ramp crash ~20 detik |
| `src/faucet.ts` | ETH (`anvil_setBalance`), WETH/USDC (`anvil_setStorageAt` pada slot mapping balance) |
| `src/keeper.ts` | Keeper simulasi: `usersPage → needsProtection → protect` tiap 2 detik, catat `Protected`/`LayerUsed`/`FeeCharged` |
| `src/proxy.ts` | RPC proxy publik: allowlist §3.7, batch per item, rate limit 30 req/detik per IP dan per fork, `eth_getLogs` ≤ 10.000 blok |
| `src/http.ts`, `src/sessions.ts` | Session API berotentikasi `x-simnet-key` |

## Menjalankan lokal

Butuh Node 22+ dan [Foundry](https://book.getfoundry.sh/getting-started/installation) (`anvil`, `forge`) di PATH.

```bash
# 1. Dependensi (dari root repo)
npm install

# 2. Kontrak: build artefak (dipakai deploy fallback dan DeploySim)
cd contracts && forge build && cd ..

# 3. Env
cp apps/simnet/.env.example apps/simnet/.env
#   isi SIMNET_API_KEY (openssl rand -hex 32) dan ARB_ONE_RPC_URL

# 4. Jalankan (dari root)
npm run simnet
```

Cek:

```bash
curl -H "x-simnet-key: $SIMNET_API_KEY" http://localhost:8787/v1/health
curl -X POST -H "x-simnet-key: $SIMNET_API_KEY" -H "content-type: application/json" \
  -d '{"address":"0x000000000000000000000000000000000000dEaD","mode":"live"}' \
  http://localhost:8787/v1/sessions
# → { sessionId, forkId, rpcPath: "/rpc/<forkId>", chainId, contracts, expiresAt }
curl -X POST -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' \
  http://localhost:8787/rpc/<forkId>
```

Test: `npm test -w @tahansoe/simnet`. Test integrasi anvil sungguhan (`test/integration.test.ts`) otomatis di-skip bila `anvil` tidak ada di PATH atau `ARB_ONE_RPC_URL` kosong.

## Environment

| Variabel | Default | Keterangan |
|---|---|---|
| `ARB_ONE_RPC_URL` | — (wajib) | Sumber fork dan relay harga |
| `SIMNET_API_KEY` | — (wajib, ≥ 16 karakter) | Header `x-simnet-key`; dibandingkan constant-time |
| `SIM_CHAIN_ID` | `4216199` | Chain ID fork (beda dari mainnet → tx tidak bisa di-replay) |
| `SIM_MAX_PRIVATE_FORKS` | `4` | Batas fork Replay/Stress bersamaan |
| `SIM_PRIVATE_TTL_MIN` | `15` | Umur fork pribadi; `POST /v1/sessions/:id/extend` menambah satu periode, sekali |
| `SIM_PORT` | `8787` | Port HTTP |
| `SIM_ANVIL_BIN`, `SIM_FORGE_BIN` | `anvil`, `forge` | Path binary Foundry |
| `SIM_CONTRACTS_DIR` | `../../contracts` | Folder Foundry |
| `SIM_SCENARIOS_DIR` | `./scenarios` | Fixture replay (file berawalan `_` hanya untuk test, tidak dimuat) |
| `SIM_TRUST_PROXY` | `0` | `1` = rate limit memakai `cf-connecting-ip`/`x-forwarded-for` (hanya di belakang Cloudflare Tunnel) |

## API

Semua `/v1/*` wajib header `x-simnet-key`. Body JSON, divalidasi Zod.

| Method & path | Body | Respons |
|---|---|---|
| `GET /v1/health` | — | `{ok, forks:{live, private, max}}` |
| `POST /v1/sessions` | `{address, mode:"live"\|"replay"\|"stress", scenario?}` | `201 {sessionId, forkId, rpcPath, chainId, contracts:{guardian, simPriceFeed, testVault?, pool, weth, usdc}, expiresAt}`; faucet awal 10 ETH + 5.000 USDC; `409 {error:"capacity", retryAfterSec}` bila fork pribadi penuh |
| `POST /v1/sessions/:id/faucet` | `{asset:"ETH"\|"WETH"\|"USDC", amount}` | `{balances}` (unit terkecil, string); `429 {error:"faucet_limit"}` di atas 100 ETH (ETH+WETH) / 50.000 USDC kumulatif |
| `POST /v1/sessions/:id/scenario` | `{kind:"replay", scenario}` \| `{kind:"crash", pct:10\|30\|50}` | `{ok:true}`; `409` di fork Live bersama |
| `GET /v1/sessions/:id/status` | — | `{mode, price, priceSource, scenarioProgress?, expiresAt, events:[…]}` |
| `POST /v1/sessions/:id/extend` | — | `{expiresAt}`; `409` bila sudah pernah diperpanjang |
| `DELETE /v1/sessions/:id` | — | `{ok:true}`; fork pribadi langsung dimatikan |

`POST /rpc/:forkId` publik (tanpa key, CORS terbuka) dan hanya meneruskan method allowlist spec §3.7. Method lain, termasuk `anvil_*`, `evm_*`, `hardhat_*`, `debug_*`, dan `eth_sendTransaction`, ditolak dengan `-32601`.

## Deploy kontrak

`src/deploy.ts` adalah satu-satunya titik deploy, dengan interface `Deployer.deploy(fork) → {guardian, simPriceFeed, testVault?, updater}`:

1. **`contracts/script/DeploySim.s.sol`** (utama, dikerjakan paralel oleh Task A). Dijalankan dengan `forge script … --rpc-url <fork> --private-key <deployer simnet> --broadcast`. Script mencetak `SIM_DEPLOYMENT {json}` yang diparse simnet.
2. **Fallback artefak**, selama DeploySim belum ada: deploy `TahansoeGuardianV2` (provider Aave, SwapRouter02 Uniswap, fee 500), `SimPriceFeed`, dan `TestVault` bila ada, langsung dari bytecode `contracts/out`. Butuh `forge build` yang sudah menghasilkan artefak tersebut. Argumen constructor SimPriceFeed/TestVault ditebak dari ABI-nya.

Deployer adalah key publik khusus simnet (`keccak256("tahansoe.simnet.deployer.v1")`) yang nonce-nya di-reset ke 0 di tiap fork. Hasilnya, alamat kontrak deterministik di semua fork. Key ini tidak bernilai di chain mana pun, dan juga menjadi `updater` SimPriceFeed.

Pergantian sumber oracle WETH selalu dilakukan simnet (`src/oracle.ts`) setelah feed diisi harga awal, sehingga Aave tidak pernah membaca feed kosong.

## Faucet: slot storage token

Dicatat di `TOKEN_SLOTS` (`src/config.ts`):

| Token | Alamat | Slot `balances` |
|---|---|---|
| WETH (aeWETH, OZ ERC20Upgradeable) | `0x82aF…Bab1` | 51 |
| USDC (FiatTokenV2_2) | `0xaf88…5831` | 9 |

Setiap penulisan diverifikasi dengan `balanceOf`. Bila slot ternyata salah (misalnya token di-upgrade), faucet memindai slot 0–120, memulihkan slot yang salah tulis, lalu menyimpan slot yang benar di memori.

## Docker (VPS)

```bash
cd apps/simnet
cp .env.example .env   # isi secret
docker compose up -d --build
```

Image berbasis `node:22-bookworm-slim` + Foundry lewat `foundryup` (`--build-arg FOUNDRY_VERSION=…` untuk pin versi), lalu menjalankan `forge build` di dalam image. Container dibatasi `mem_limit: 2g` agar engine produksi di VPS yang sama tidak terganggu. Port hanya di-bind ke `127.0.0.1` host, untuk Cloudflare Tunnel.

Build context adalah root repo. Pakai `.dockerignore` root (ada di branch deploy engine) agar `node_modules`, `.env`, `contracts/out`, dan `contracts/lib` lokal tidak ikut terkirim.

## Keterbatasan

- State selain harga WETH tidak ikut sinkron dengan mainnet. Harga pool Uniswap di fork tetap seperti saat fork dibuat (spec §3.3).
- Sesi dan event disimpan di memori. Restart simnet atau reset harian fork Live menghapus semuanya.
- Fork pribadi butuh beberapa detik sampai puluhan detik untuk start (fork + deploy), jadi `POST /v1/sessions` mode replay/stress menunggu selama itu.

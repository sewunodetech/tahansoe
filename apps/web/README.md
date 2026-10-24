# Tahansoe Web (`@tahansoe/web`)

Next.js App Router: landing page, `/connect` (SIWE), dan dashboard (Live, Demo, Simulation). Setup umum ada di [README root](../../README.md); variabel environment lengkap di [`.env.example`](.env.example).

## Simulation Mode

Spec: [`docs/specs/m1-simulation-mode.md`](../../docs/specs/m1-simulation-mode.md), ADR: [0014](../../docs/decisions/0014-simulation-network-anvil-fork.md).

Calon user bisa mencoba Guardian di fork Arbitrum One tanpa wallet asli:

- `/connect` → **"Try a simulation first — no wallet needed"**. Pilihan ini nonaktif (dengan tautan ke demo in-browser) bila `/api/sim/health` melaporkan simnet mati.
- Wallet simulasi = private key burner di `localStorage` (`tahansoe:sim-key`), dibuat dengan viem dan **tidak pernah dikirim ke server**. Connector wagmi `simConnector` (`lib/sim/connector.ts`) menandatangani transaksi di browser dan mengirimnya ke RPC proxy simnet.
- Route `app/api/sim/{health,session,faucet,scenario,status}` mem-proxy Session API simnet di server dengan `SIMNET_API_KEY`. Sesi disimpan di iron-session sebagai `session.sim`, terpisah dari field SIWE (tidak pernah mengisi `userId`, jadi route data user asli tetap tertutup).
- Dashboard memakai jalur kode Live; `lib/live-target.ts` mengganti chain, Guardian, dan RPC ke fork saat mode `simulation` aktif.
- Funnel dicatat di tabel `sim_sessions` (best effort; dilewati bila DB/tabel belum ada).

### Environment

| Variabel | Sisi | Isi |
|---|---|---|
| `SIMNET_URL` | server | Base URL Session API simnet |
| `SIMNET_API_KEY` | server | Dikirim sebagai header `x-simnet-key`; jangan diberi prefix `NEXT_PUBLIC_` |
| `NEXT_PUBLIC_SIM_RPC_BASE` | browser | Base URL publik RPC proxy; `rpcPath` sesi ditambahkan di belakangnya |
| `NEXT_PUBLIC_SIM_CHAIN_ID` | browser | Chain id fork (default `4216199`) |
| `SIMNET_MOCK` | server | `1` = respons simnet palsu untuk develop/demo UI tanpa layanan simnet |

### Mode mock

```bash
SIMNET_MOCK=1 npm run dev   # dari apps/web, atau set di apps/web/.env
```

Harga, crash, replay, dan event proteksi berasal dari `lib/sim/mock.ts`. Tidak ada fork, jadi pembacaan on-chain dan wizard transaksi nonaktif; panel simulasi (banner, skenario, daftar transaksi, "Without Tahansoe", top-up, CTA) tetap berjalan.

# Spec: Positions, Holdings, Reserves, dan Overview "Guardian view"

- **Milestone:** M1. Memenuhi "`ProtocolAdapter` interface + `AaveAdapter` (read posisi asli)" di [PRD §10](../prd.md#10-roadmap-eksekusi), dan menyiapkan `MorphoAdapter` (M5) dalam mode baca saja.
- **Status:** Draft (arahan owner, 24 Okt 2026)
- **Pemilik:** Tim Web + Tim Domain
- **Terkait:** [PRD §6, §7.1](../prd.md), [architecture.md §6](../architecture.md), [spec M1 web on-chain](m1-web-onchain-integration.md), [spec simulation mode](m1-simulation-mode.md), [ADR 0001](../decisions/0001-arbitrum-first-chain-agnostic.md), [security.md](../security.md)

## 1. Tujuan

Dashboard sekarang berpusat pada setelan proteksi, bukan pada posisi user. User tidak bisa melihat:

- posisi apa saja yang dia punya di protokol mana;
- aset di wallet yang menjadi sumber L1;
- posisi stake/vault yang menjadi sumber L2;
- bukti bahwa posisinya **sedang dijaga**.

Spec ini menambah tiga halaman baca (Positions, Holdings, Reserves) dan mengganti Overview dengan **Guardian view**: satu kartu per posisi yang dijaga, dengan jarak ke trigger dan ke likuidasi dalam harga ETH, detak pengecekan, dan cadangan yang siap. **Tidak ada perubahan kontrak.** Memilih posisi mana yang dijaga per protokol butuh Guardian v4 (lihat §7).

## 2. Scope

**Termasuk:**

- `packages/domain`:
  - tipe `PositionDetail`;
  - `AaveV3Reader`: breakdown per reserve, on-chain, tanpa alamat baru;
  - `MorphoBlueReader`: baca saja;
  - helper harga ambang (harga ETH saat HF = trigger dan saat HF = 1);
  - alamat Morpho Blue Arbitrum One di chain registry.
- **Halaman Positions** (`/dashboard/positions`): semua posisi borrow user di chain yang didukung. Aave V3 di chain Live dan Arbitrum One, Morpho Blue di Arbitrum One. Badge status per posisi: *Protected* / *Not protected* / *Monitor only*.
- **Halaman Holdings** (`/dashboard/holdings`): saldo wallet untuk token di registry, nilai USD (oracle Aave), dan allowance ke Guardian. Penanda stablecoin mana yang bisa dipakai L1.
- **Halaman Reserves** (`/dashboard/reserves`): sumber L2 yang dikonfigurasi di Guardian (ERC-4626 atau aToken), saldo share, nilai aset, cap per aksi, allowance. Menu ini **hanya muncul bila L2 aktif** untuk wallet itu. Kalau L2 belum aktif, halaman tetap bisa dibuka lewat URL dan menampilkan cara mengaktifkannya.
- **Overview → Guardian view**:
  - kartu per posisi yang dijaga (gauge HF dengan trigger, target, dan titik likuidasi);
  - kalimat harga ambang ("ETH harus turun ke $X sebelum kami bertindak, $Y sebelum likuidasi");
  - detak pengecekan;
  - meter cadangan (L1 USD, L2 USD, L3 maks ETH).

  Bila belum ada posisi yang dijaga, tampilkan posisi teratas dari Positions dengan CTA "Protect this position".
- **Detak pengecekan:**
  - Live: `positions.last_checked_at` dari Sentinel lewat route baru `/api/positions/heartbeat` (sesi SIWE).
  - Simulasi: field baru `keeperCheckedAt` di status simnet.
- **Navigasi sidebar:** Overview · **Positions** · Protection · **Holdings** · **Reserves** (bersyarat) · Activity · Agents · Telegram.
- Mode simulasi memakai halaman yang sama dengan chain fork. Holdings dan Reserves membaca wallet burner.

**Tidak termasuk:**

- Perubahan kontrak, termasuk policy per posisi atau per protokol (Guardian v4, butuh ADR).
- Proteksi untuk Morpho (M5). Posisi Morpho berstatus *Monitor only*.
- Indexer atau subgraph. Semua dibaca on-chain lewat multicall, plus API publik Morpho bila tersedia (§3.3).
- Harga dari sumber non-protokol untuk keputusan apa pun (I5). Nilai USD di halaman ini hanya untuk tampilan.
- Chain selain Arbitrum (Sepolia dan One).

## 3. Desain

### 3.1 Tipe di `packages/domain`

```ts
export interface AssetAmount {
  symbol: string;
  address: Address;
  decimals: number;
  amount: bigint;      // token units
  valueUsd: number;    // display only, from the protocol oracle
}

export interface PositionDetail extends Position {
  id: string;                    // `${protocol}:${chainId}:${marketId ?? "pool"}:${user}`
  collateral: AssetAmount[];
  debt: AssetAmount[];
  liquidationThresholdBps: number;
  /** Price of the main collateral at which HF hits `trigger` / 1.0, others held constant. */
  priceAtHf: (hf: number) => number | null;
  mainCollateral?: AssetAmount;  // largest collateral by value
  monitorOnly: boolean;          // true where no Guardian can protect it (Morpho, chains without Guardian)
}

export interface PositionReader {
  readonly protocol: Position["protocol"];
  readonly chainId: number;
  read(user: Address): Promise<PositionDetail[]>;
}
```

Reader menerima `PublicClient` viem. Karena itu `packages/domain` menambahkan `viem` sebagai dependensi, dengan versi yang sama seperti `apps/web` (sebelumnya domain tanpa dependensi runtime). Logika murni (`priceForHealthFactor`, rumus HF Morpho) tetap tanpa I/O dan dites terpisah.

`priceAtHf` dihitung dengan helper murni `priceForHealthFactor({ collateral, debt, lt, mainCollateral, hf })` yang dites terpisah. Asumsinya hanya harga collateral utama yang bergerak; aset lain dan utang konstan.

### 3.2 `AaveV3Reader`

Input: `PublicClient` viem dan `ChainConfig` (alamat `aave.pool` dan `aave.oracle` dari registry, tanpa hardcode).

1. `pool.getReservesList()`.
2. Multicall `getReserveData(asset)` untuk tiap reserve, lalu `aToken.balanceOf(user)` dan `variableDebtToken.balanceOf(user)`.
3. `oracle.getAssetsPrices(reserves)`, plus `decimals`/`symbol` (di-cache per chain).
4. `getUserAccountData(user)` untuk HF dan LT agregat, yang tetap menjadi sumber kebenaran HF (I5).
5. Satu `PositionDetail` per user per chain. Aave adalah satu pool, jadi `marketId` dikosongkan.
6. Collateral hanya dihitung untuk aset dengan `usageAsCollateralEnabled` di `getUserConfiguration`.

### 3.3 `MorphoBlueReader` (baca saja)

- Alamat Morpho Blue Arbitrum One `0x6c247b1F6182318877311737BaC0844bAa518F5e` (sumber: docs.morpho.org/addresses, diakses 24 Okt 2026). **Worker wajib memverifikasi `eth_getCode` tidak kosong** sebelum menulisnya ke registry (`morpho.blue`).
- Jalur utama: API GraphQL publik Morpho, bila worker bisa memastikan endpoint, skema, dan dukungan chain 42161. Kalau tidak bisa dipastikan, jangan dipakai.
- Jalur cadangan (wajib ada): log `SupplyCollateral` dan `Borrow` yang difilter topic `onBehalf = user` dalam rentang blok terbatas → daftar `marketId` → `position(id, user)`, `market(id)`, `idToMarketParams(id)` → harga dari oracle market (`IOracle.price()`, skala 1e36).
- HF Morpho = `collateral × price / 1e36 × lltv / borrowAssets`. Ditampilkan sebagai HF agar konsisten dengan Aave.
- Setiap posisi Morpho berstatus `monitorOnly: true`.

### 3.4 Status proteksi per posisi

| Kondisi | Badge |
|---|---|
| Aave, chain punya Guardian, `policy.enabled` dan aset utang policy ada di posisi | **Protected** (trigger, target) |
| Aave, chain punya Guardian, belum ada policy | **Not protected**, CTA "Protect this position" → `/dashboard/protection` |
| Morpho, atau chain tanpa Guardian (Arbitrum One sebelum audit) | **Monitor only**, dengan penjelasan singkat |

Dua batasan Guardian v2 harus ditulis jujur di UI: satu policy per wallet, dan hanya satu aset utang yang dilindungi. Kalau posisi punya lebih dari satu aset utang, tampilkan "only USDC debt is protected".

### 3.5 Holdings (sumber L1)

- Token: semua `tokens` di registry chain aktif, plus ETH native.
- Kolom: aset, saldo, nilai USD (oracle Aave; "—" bila tidak ada), allowance ke Guardian, dan tanda "Used by Layer 1" untuk aset utang policy.
- Ringkasan di atas: "Layer 1 can repay up to $X now" = min(saldo, allowance, cap per aksi).

### 3.6 Reserves (sumber L2)

- Dari `useGuardian().layer2`: jenis (ERC-4626 atau aToken), alamat sumber, cap per aksi.
- ERC-4626: `balanceOf(user)`, `convertToAssets(shares)`, `asset()`, allowance share ke Guardian.
- aToken: saldo aToken dan allowance.
- Ringkasan: "Layer 2 can redeem up to $X per action".
- Kalau L2 tidak aktif: empty state dengan penjelasan L2 dan link ke Protection.

### 3.7 Overview → Guardian view

Untuk setiap posisi **Protected**:

- **Gauge HF** horizontal: titik likuidasi 1,0, trigger, target, dan HF sekarang. Warnanya mengikuti token `--safe/--warning/--danger` dengan aturan DESIGN.md (safe bila HF > trigger + 0,25; critical bila HF ≤ trigger).
- **Kalimat ambang:** "ETH ${p} now · we act at ${priceAtHf(trigger)} (−x%) · liquidation at ${priceAtHf(1)} (−y%)".
- **Detak:** "Checked 12 s ago by the Sentinel" (Live, dari heartbeat) atau "Checked 2 s ago by the simulation keeper". Kalau data lebih tua dari 10 menit, tampilkan peringatan kuning, tanpa mengklaim sedang dijaga.
- **Cadangan:** L1 $X (Holdings) · L2 $Y (Reserves) · L3 maks Z ETH (dari `layer3`). Layer yang mati ditulis "off".
- **Gerak halus:** gauge beranimasi ke nilai baru, dan titik detak berdenyut. Hormati `prefers-reduced-motion`.

Kalau belum ada posisi Protected: tampilkan posisi terbesar dari Positions, lengkap dengan HF dan harga likuidasi, plus CTA. Kalau tidak ada posisi sama sekali: empty state yang mengarah ke Simulation Mode dan dokumentasi.

Konten Overview lama (setelan proteksi dan status kontrak) pindah ke halaman Protection, tanpa duplikasi.

### 3.8 Heartbeat

- **Web:** `GET /api/positions/heartbeat` (sesi SIWE wajib) → `{ checkedAt: string | null, positions: [{ protocol, chainId, marketId, lastCheckedAt }] }` dari tabel `positions` milik `session.userId`. Sesi simulasi ditolak (401).
- **Simnet:** status menambah `keeperCheckedAt` (ISO), diisi setiap loop keeper pada fork tersebut. Field ini additive; web memperlakukannya sebagai opsional.

### 3.9 File yang berubah

| File | Jenis | Pemilik |
|---|---|---|
| `packages/domain/src/positions/{types,aave-v3,morpho-blue,price-at-hf,index}.ts`, ekspor di `src/index.ts`, test | Baru | Worker Domain |
| `packages/domain/src/chains.ts` | Edit: `morpho?: { blue: Address }` di ChainConfig + Arbitrum One | Worker Domain |
| `apps/web/hooks/usePositions.ts` | Baru: React Query + reader dari domain, per chain | Worker Web Positions |
| `apps/web/app/dashboard/positions/page.tsx`, `components/dashboard/positions/*` | Baru | Worker Web Positions |
| `apps/web/app/dashboard/page.tsx`, `components/dashboard/live/live-overview.tsx` → `components/dashboard/guardian-view/*` | Edit/baru | Worker Web Positions |
| `apps/web/components/ui/dashboard-sidebar.tsx` | Edit: menu baru, Reserves bersyarat | Worker Web Positions |
| `apps/web/hooks/useHoldings.ts`, `useReserves.ts`, `app/dashboard/{holdings,reserves}/page.tsx`, `components/dashboard/{holdings,reserves}/*` | Baru | Worker Web Holdings |
| `apps/web/app/api/positions/heartbeat/route.ts`, `apps/simnet/src/keeper.ts` + status | Baru/edit | Worker Heartbeat |

## 4. Dampak keamanan

- **I1–I4:** tidak ada transaksi baru dan tidak ada jalur dana baru. Semua fitur hanya membaca.
- **I5:** HF yang ditampilkan berasal dari `getUserAccountData` (Aave) atau rumus Morpho dengan oracle market-nya. Nilai USD lain hanya untuk tampilan dan tidak dipakai untuk keputusan eksekusi.
- **I6:** heartbeat basi tidak boleh ditampilkan sebagai "sedang dijaga". UI menulis status yang jujur (§3.7).
- **I8:** tidak ada secret baru. RPC Arbitrum One di browser memakai transport wagmi yang sudah ada (RPC publik).
- **Privasi:** `/api/positions/heartbeat` hanya mengembalikan baris milik `session.userId`.
- **Input eksternal:** respons API Morpho divalidasi Zod. Kalau gagal, pakai jalur on-chain.
- **Batas RPC:** rentang log Morpho dibatasi (worker menentukan nilai aman untuk RPC publik dan mendokumentasikannya). Hasil di-cache per sesi browser selama 60 detik.

## 5. Kriteria penerimaan

- [ ] Wallet dengan posisi Aave di Arbitrum Sepolia melihatnya di Positions, lengkap dengan breakdown collateral/utang per aset, HF, harga likuidasi, dan badge status yang benar.
- [ ] Wallet dengan posisi Aave atau Morpho di Arbitrum One melihatnya sebagai *Monitor only* (diuji dengan alamat publik yang punya posisi; alamatnya dicatat di test atau README).
- [ ] Holdings menampilkan saldo, nilai, allowance, dan ringkasan kapasitas L1.
- [ ] Menu Reserves hanya muncul bila L2 aktif; halamannya menampilkan share, nilai, cap, dan allowance.
- [ ] Overview menampilkan Guardian view: gauge, harga ambang (dites dengan vektor), detak, dan cadangan. Heartbeat basi memunculkan peringatan.
- [ ] Mode simulasi: Positions, Holdings, dan Overview bekerja di fork (posisi Auto-fill muncul sebagai Protected).
- [ ] Responsif 390 px, tema light/dark, dan `prefers-reduced-motion` dihormati.
- [ ] `npm run typecheck`, `npm run lint`, dan `npm test` hijau.

## 6. Rencana test

- **Domain:** unit `priceForHealthFactor` (vektor dengan satu dan beberapa collateral), `AaveV3Reader` dan `MorphoBlueReader` dengan client tiruan (respons multicall dan log tetap), serta parsing respons API Morpho.
- **Opsional:** test baca nyata ke Arbitrum One yang di-skip tanpa `ARB_ONE_RPC_URL`.
- **Web:** unit untuk penentuan badge status, ringkasan kapasitas L1/L2, dan kondisi menu Reserves. Playwright di mode simulasi: Auto-fill → Positions, Holdings, dan Overview menampilkan data fork.
- **Heartbeat:** route mengembalikan 401 tanpa sesi SIWE atau dengan sesi simulasi. Status simnet memuat `keeperCheckedAt`.

## 7. Pertanyaan terbuka

- **Guardian v4** (ADR baru): policy per posisi (protokol + market + aset utang), adapter Morpho, dan beberapa aset utang. Spec ini sengaja hanya menyiapkan UI-nya (badge, CTA).
- Apakah Positions juga menampilkan posisi tanpa utang (supply saja)? Usulan: tampilkan di bagian "Supplied only", karena relevan untuk L2 (aToken).
- Perlukah Arbitrum One dibaca di mode Live sebelum mainnet, mengingat RPC publik bisa lambat? Usulan: ya, dengan label "Monitor only" dan lazy load.

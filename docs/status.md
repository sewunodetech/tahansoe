# Status Proyek

**Last updated:** 24 Oktober 2026
**Milestone aktif:** M2 (Core Risk Engine v1 / Research Layer) dan M1 (Integrasi on-chain web) — lihat [PRD §10](prd.md#10-roadmap-eksekusi)

> Perbarui file ini di akhir setiap pekerjaan: pindahkan item yang selesai, tambahkan gap baru, dan tulis next step.

---

## Sudah jalan

### Protection Strategy Agent Fase A — 25 Okt 2026 ([spec](specs/m4-protection-strategy-agent.md), [ADR 0016](decisions/0016-bounded-protection-agent.md), [ADR 0017](decisions/0017-erc8004-agent-identity.md), branch `feat/protection-agent`)

Dikerjakan empat worker Antigravity (Orca run `run_60dcc45a6134`), di-review dan diperbaiki koordinator sebelum merge.

- **Fondasi (`packages/domain`, `packages/db`):** `ProtectionPlanSchema`, `Mandate` + `defaultMandate` (DELEVERAGE mati default, `maxPreemptHF = trigger + 0.25`, cap 24 jam = 3 × cap per aksi), `PositionState`, `ProtectionDecider`, `Playbook`; alamat registry ERC-8004 Sepolia dan One di chain registry; tabel `protection_plans` dan `strategy_versions`.
- **Agent + rule engine (`apps/engine/src/strategy/`):** decider deterministik dari playbook, LLM opsional hanya merangking kandidat valid, rule engine §3.3, `planHash` keccak256. Mode shadow di sentinel mencatat plan ke `protection_plans` tanpa transaksi. CLI `tahansoe agent plans`. Perbaikan koordinator: `SHIFT_TRIGGER` kini menaikkan trigger di atas trigger statis dan di bawah target/`maxPreemptHF`, tanpa klaim perubahan HF.
- **Backtest (`apps/engine/src/backtest/`):** harness replay harga historis Binance ETHUSDT untuk 7 jendela crash + 1 periode tenang, decider static/dynamic/agent, gate rilis, CLI `tahansoe backtest protection`. Setiap laporan mencetak batasannya (posisi sintetis, regime dilabeli hindsight).
- **Miner (`apps/engine/src/strategy/miner/`):** pipeline survivor vs terlikuidasi dari event Aave V3 Arbitrum One, CLI `tahansoe strategy mine`. Perbaikan koordinator: tanpa fallback diam-diam ke fixture, laporan diberi `dataSource`, run fixture tidak pernah disimpan, dokumen tidak lagi menyajikan angka fixture sebagai temuan.
- **ERC-8004 (`apps/engine/src/erc8004/`, `apps/web`):** ABI Identity/Reputation (diverifikasi read-only ke proxy Sepolia), calldata `register`/`giveFeedback` tanpa tanda tangan, filter Sybil, CLI `tahansoe agent identity`, kartu agent di halaman Protection. Perbaikan koordinator: URL web dan URI registrasi wajib diisi (tanpa domain karangan), deskripsi sesuai mandat ADR 0016.
- **Verifikasi:** typecheck dan lint bersih; test engine 584, web 84, domain 91, db 6.

**Gap:**
- Miner belum menghasilkan temuan yang valid. Run nyata pertama (25 Okt 2026, QuickNode arsip Arbitrum One, jendela depeg USDC): 26.292 event, 6.654 wallet, 189 wallet terlikuidasi (cocok dengan hitungan `LiquidationCall` on-chain). Klasifikasi at-risk/survivor **tidak valid**: `getUserAccountData` historis tidak pernah dipanggil; HF ditebak dari ada-tidaknya repay/supply, sehingga survivor = wallet yang bertindak (`noAction` selalu 0). Perlu: HF historis via multicall di titik sampel sepanjang jendela, dan kondisi/target playbook diturunkan dari data, bukan template.
- Backtest belum membedakan strategi: static sudah mencegah semua likuidasi di set posisi default; agent vs static = 23 vs 23, biaya +8,6%. Perlu posisi lebih rapuh dan regime hasil replay engine, bukan label hindsight.
- Registrasi agent ERC-8004 on-chain menunggu URL web publik untuk file registrasi; pemilik NFT sesuai ADR 0017 adalah multisig.
- Shadow mode belum di-deploy ke engine VPS.

### Guardian v4: Kebijakan per-posisi & proteksi Morpho Blue — 24 Okt 2026 ([spec](specs/m4-guardian-v4-per-position.md), [ADR 0015](decisions/0015-guardian-v4-per-position-policies.md), branch `feat/user-proof-sim-fee`)

Dikerjakan lima worker paralel Antigravity (Orca run `run_49048ccfe5bf`), digabung dan diverifikasi penuh.

- **Kontrak (`contracts/`):**
  - `TahansoeGuardianAaveV4`: kebijakan per-`(user, debtAsset)` untuk multi-debt Aave V3, urutan prioritas utang (`setDebtPriority`), isolasi penyelamatan hanya pada aset utang yang ditargetkan, enumerasi posisi (`positionsPage`).
  - `TahansoeGuardianMorpho`: proteksi pasar Morpho Blue independen (`marketId`), formula HF LLTV 10^36 desimal, L1 (wallet) + L2 (ERC-4626 vault), proteksi invariant selektor Morpho terlarang.
  - `GuardianCore`: shared library untuk layer ordering, fee sukses 15 bps (ADR 0013), dynamic trigger clamping.
  - Script deployment Arbitrum Sepolia `contracts/script/DeployAaveV4.s.sol`. **Deployed & verified 25 Okt 2026:** `TahansoeGuardianAaveV4` `0xa7Bbab6366a723e17cd2f220D708757e449571b4` (block 322451784), `MockSwapRouter` `0x3A4440473141DAB3822bAb065a4d16fc18255F6C`; treasury = deployer testnet `0x4eF8E7A6106Ffc768fcd12b5886319dA71CD42ca`.
  - 88 test lulus (unit, fuzz, invariant 128k transisi per handler); 4 fork test Arbitrum One di-skip karena butuh `ARB_ONE_RPC_URL`.
- **Domain & Database (`packages/domain`, `packages/db`):**
  - `@tahansoe/domain`: helper canonical `positionKey` (`aave-v3:chainId:guardian:debtAsset` & `morpho-blue:chainId:guardian:marketId`), `parsePositionKey`, ABI v4 terkunci.
  - `@tahansoe/db`: kolom nullable `position_key` pada `policies` dan `intents` dengan index dan migrasi idempotent.
- **Engine Sentinel & Keeper (`apps/engine`):**
  - Sentinel worker multi-guardian (v2/v3, AaveV4, Morpho) dengan discovery otomatis dan debt priority sorting.
  - Keeper loop non-custodial per-position dengan deduplikasi tick dan FeeCharged receipts decorator.
  - 498 test engine lulus.
- **Simnet Fork & Web UI (`apps/simnet`, `apps/web`):**
  - `apps/simnet`: deploy otomatis v4 di Anvil fork Arbitrum One, loop eksekusi keeper simulasi multi-posisi.
  - `apps/web`: hook `useGuardianV4`, dialog proteksi per-posisi (Aave & Morpho), daftar posisi terproteksi dengan reorder prioritas, integrasi simulation dashboard.
- **Live Sepolia ke v4 (25 Okt 2026, Orca run `run_fbc2167df1f5`):** v4 terdaftar di `ARBITRUM_SEPOLIA.guardians`; `currentGuardian()`/`legacyGuardians()` kini hanya Guardian klasik v1–v3 (ABI satu policy per user), v4 lewat `latestGuardian()`/`isPerPositionGuardian()`. Web Live memakai v4 untuk Protection, Positions, Overview, Holdings, dan Activity (event v1 + v4); banner migrasi muncul bila wallet masih punya policy atau allowance di v1. Engine: adapter v1 + AaveV4 dari registry, multicall `quoteProtect` untuk v4, keeper memakai `guardianVersion`, event sync v4 dari block 322451784; smoke read-only ke Sepolia lulus. Test: engine 503, simnet 69, web 82, db 6, domain 86.
- **Policy per posisi di DB (25 Okt 2026):** index unik `policies (user_id, guardian_address)` diganti dua partial unique index: `policies_user_guardian_classic_unique` (`WHERE position_key IS NULL`, Guardian v1–v3) dan `policies_user_guardian_position_unique` (`(user_id, guardian_address, position_key) WHERE position_key IS NOT NULL`, v4 dan Morpho). Migrasi idempotent mengosongkan `position_key` policy klasik sebelum index lama di-drop. Event sync hanya memberi `position_key` untuk Guardian per posisi; upsert dan disable memakai target yang sesuai.
- **Gap:** kontrak v4 tidak memancarkan event saat `setLayer2`/`setLayer3`/`setTriggerBand`, jadi konfigurasi L2/L3/band v4 tidak tersinkron ke DB (engine membaca on-chain lewat `quoteProtect`). Perlu event di versi kontrak berikutnya.
- **Verifikasi (dicek ulang 25 Okt 2026):** typecheck dan lint bersih; forge 88 lulus, 4 fork di-skip; test engine 498, simnet 69, web 67, db 6, domain 85 (725 total).

### Positions, Holdings, Reserves, dan Overview "Guardian view" — 24 Okt 2026 ([spec](specs/m1-positions-holdings-guardian-view.md), branch `feat/user-proof-sim-fee`)

Dikerjakan empat worker paralel (2 Claude, 2 Antigravity), lalu digabung dan diverifikasi.

- **`packages/domain`:**
  - `PositionDetail`, `createAaveV3Reader` (breakdown per reserve on-chain), `createMorphoBlueReader` (read-only), `priceForHealthFactor`.
  - Domain kini bergantung pada `viem` dan `zod`.
  - Morpho Blue Arbitrum One `0x6c247b1F…8F5e` terverifikasi via `eth_getCode`. Penemuan market lewat API GraphQL Morpho (tervalidasi Zod), dengan cadangan `getLogs`. Nilai posisi selalu dibaca on-chain.
  - Tes baca nyata di Arbitrum One lulus.
- **Web:**
  - Menu **Positions**: Aave dan Morpho per chain, badge Protected / Not protected / Monitor only, harga likuidasi.
  - Menu **Holdings**: saldo, allowance, dan kapasitas L1.
  - Menu **Reserves**: sumber L2; menu hanya muncul bila L2 aktif.
  - **Overview "Guardian view"**: gauge HF (likuidasi/trigger/target), harga ETH saat trigger dan saat likuidasi, detak Sentinel/keeper, meter cadangan L1/L2/L3.
- **Detak pengecekan:** `GET /api/positions/heartbeat` (SIWE saja) dari `positions.last_checked_at`; simnet menambah `keeperCheckedAt`.
- **Perbaikan saat integrasi:**
  - deep link `/dashboard/*` tetap bertahan setelah reload (guard menunggu reconnect wagmi, `?next=`);
  - chain simulasi memakai Multicall3;
  - fork live simnet dibuat ulang otomatis bila RPC non-arsip sudah membuang state-nya.
- **Verifikasi:** typecheck dan lint bersih; test engine 486, simnet 61, web 46, db 5, domain 75; Playwright di fork sungguhan untuk Positions, Holdings, Reserves, dan deep link.

**Gap:**
- Simnet produksi butuh RPC arsip (Alchemy/Infura gratis).
- Nilai USD Morpho hanya tersedia bila loan token juga reserve Aave.

### User proof: Simulation Mode + Guardian v3 fee sukses — 24 Okt 2026 (branch `feat/user-proof-sim-fee`; [ADR 0013](decisions/0013-success-fee-on-protection.md) & [ADR 0014](decisions/0014-simulation-network-anvil-fork.md) masih **Proposed**)

Dikerjakan enam worker paralel (Orca), lalu digabung dan diverifikasi.

- **Kontrak:**
  - `TahansoeGuardianV3`: turunan V2 dengan fee sukses 15 bps, hanya bila HF < trigger statis dan < 1,50. Proteksi selalu didahulukan; sisa fee yang tak terbayar dihapus (waived); treasury `immutable`; event `FeeCharged`; view `quoteFee`.
  - V2 hanya mendapat dua hook internal no-op (`_afterLayers`, `_refundLeftover`); perilakunya tidak berubah.
  - `SimPriceFeed`: aggregator mock 8 desimal, `setAnswer` hanya oleh updater.
  - `DeploySim.s.sol`: dijaga `SIM_CHAIN_ID`; mengganti sumber WETH AaveOracle lewat Aave executor yang di-impersonate; mencetak satu baris `SIM_DEPLOYMENT {json}`.
  - `forge test`: 53 lulus, 3 fork test di-skip tanpa RPC. Fork suite di Arbitrum One 5/5 (dijalankan worker).
- **`apps/simnet`** (baru):
  - Fork manager anvil: satu fork bersama untuk mode live, plus fork pribadi (maks 4, TTL 15 menit).
  - Deploy module, relay Chainlink 5 detik, replay/crash, faucet (slot storage WETH=51, USDC=9), keeper simulasi.
  - RPC proxy dengan allowlist dan session API ber-`x-simnet-key`.
  - Dockerfile dan compose (mem_limit 2g). 56 test.
  - Sudah dicek manual di fork Arbitrum One via WSL. Image Docker belum di-build.
- **Skenario replay** (`apps/simnet/scenarios`, data Binance ETHUSDT): Agu 2024 (577 titik), Okt 2025 (289), Mar 2020 ternormalisasi (433).
- **`packages/domain`:** `simulateCascade` menghitung `feeEligible`/`fee`/`feeWaived`; ada `ARBITRUM_ONE_SIM` (chainId 4216199, tidak masuk `SUPPORTED_CHAINS`).
- **`packages/db`:** tabel `sim_sessions` dan kolom `intents.fee_amount`/`fee_waived` (migrasi idempoten, belum dijalankan ke DB prod).
- **Web:**
  - `/connect` punya pilihan simulasi; wallet burner di browser dengan `simConnector`.
  - `/api/sim/*` dengan validasi Zod dan `session.sim` yang terpisah dari SIWE.
  - Dashboard punya mode `simulation`: banner, panel skenario, wizard + Auto-fill, daftar tx dengan fee, panel "Tanpa Tahansoe", CTA konversi. `SIMNET_MOCK=1` untuk demo tanpa layanan.
  - Landing punya section perbandingan (`#compare`). FAQ/PRD dikoreksi: DeFi Saver kini mendukung EOA untuk Aave v3.
- **Verifikasi gabungan:** `npm run typecheck` bersih, `npm run lint` 0 error, `npm test` 618 lulus (engine 486, simnet 56, web 18, db 5, domain 53).

**Gap:**
- ADR 0013/0014 belum Accepted. security.md I1/I4 dan ADR 0006 belum direvisi, sehingga V3 belum boleh di-deploy ke chain nyata.
- Simnet belum di-deploy ke VPS, dan Cloudflare Tunnel untuk RPC proxy publik belum ada.
- Wizard di fork sungguhan baru diuji dengan mock, belum end-to-end.
- Image Docker simnet belum di-build.
- Bonus likuidasi WETH 5% masih di-hardcode di `apps/web/lib/sim/fee.ts`.

### Satu DB + broadcast riset ke bot Telegram web — 23 Okt 2026 ([ADR 0012](decisions/0012-unified-db-outbound-research-broadcast.md), [spec](specs/m3-research-broadcast.md), [plan](plans/research-broadcast.md))
- **Satu database:** engine kini memakai `DATABASE_URL` yang sama dengan web (Neon `custos`). Migrasi idempoten dijalankan; data riset historis dari DB engine lama disalin sekali, insert-only (`npm run db:copy-engine`, 1009 baris: 15 `research_reports`, 163 `signals`, 70 `risk_assessments`, 408 `price_samples`, 352 `rate_samples`, 1 `llm_usage_daily`). Tabel user-level tidak disalin. `npm run db:check` menampilkan host DB tersamar.
- **Engine hanya kirim (outbound-only):** `BroadcastWorker` (`apps/engine/src/broadcast/`) mengirim ke semua `telegram_accounts` aktif lewat bot web. Isinya digest terjadwal (`BROADCAST_DIGEST_TIMES`, default 08:00 & 20:00 `Asia/Jakarta`) dan alert segera saat regime naik atau ada sinyal kritis (T10/T4/T7/T8 berat). Dedupe 6 jam dan hysteresis turun 1 jam, dengan dedupe & log di tabel `broadcasts`. Advisory lock `42161006`. Rate limit ≤ 25 msg/s dengan `retry_after` pada 429; 403 menonaktifkan akun. Tersedia `tahansoe broadcast digest|once [--dry]` dan `start --no-broadcast`. Sentinel kini memakai `TelegramSender`.
- **Gateway inbound engine dihapus:** pairing, polling `getUpdates`, router/Q&A chat, bot lock, dan `gateway pair` tidak ada lagi. Q&A chat lewat Telegram ikut hilang.
- **Web:** webhook menangani `/start` (sambutan), `/start <code>` (link/re-link), dan `/stop` (berhenti langganan). Halaman Telegram menjelaskan isi notifikasi. `npm test -w apps/web` kini menjalankan test route.
- Dikerjakan paralel lewat Orca orchestration (worker Antigravity); konteks worker diambil dari index codebase-memory.

### Engine di VPS (Docker) — 24 Okt 2026
- `tahansoe start` jalan 24/7 di VPS Ubuntu 24.04 (2 vCPU, 3,6 GB) sebagai container `tahansoe-engine` (`apps/engine/Dockerfile`, `apps/engine/docker-compose.yml`), `restart: unless-stopped`, bertahan setelah reboot (sudah diuji). Kode di `/opt/tahansoe`, firewall `ufw` hanya SSH, tidak ada port terbuka.
- **Bug yang ketemu saat deploy:**
  - `undici` dipakai engine (`gdelt.ts`, `settle-job.ts`, `scorecard.ts`) tapi tidak dideklarasikan. Selama ini ikut ter-hoist dari dependensi web. Kini jadi dependensi `@tahansoe/engine`.
  - Advisory lock price worker (`42161002`) bertabrakan dengan settlement. Di `start`, settle mengambil lock duluan, lalu price worker `exit(0)` dan seluruh agent mati (restart loop di Docker, tiap restart memicu satu run riset). Price worker kini memakai `42161004`; ada test keunikan key.
  - **Spam alert "Pool ETH liquidity constrained"** (15 pesan sekaligus ke 1 user, 06:04 UTC): broadcaster memperlakukan sinyal `RESEARCH` (AI) yang menyebut path T7 sebagai alert pool kritis. Dedupe-nya memakai id sinyal, dan tiap run riset di restart loop membuat id baru. Isinya juga keliru: utilization asli WETH 81%, USDC 78%. Kini alert kritis hanya dari modul `ORACLE`/`ONCHAIN`. Heuristik angka "98" di teks evidence dihapus (APR "4.98%" ikut terdeteksi). Setelah restart, alert yang sudah tercatat < 6 jam tidak dikirim ulang (severity yang tidak diketahui dianggap sama). Test 9 & 10 di `broadcast.test.ts`.

### Landing interaktif: Position Lab — 24 Okt 2026
- Section `#lab` tepat setelah hero (`components/landing/lab/`): scene isometrik collateral, debt, dan reserve L1/L2/L3. Pengunjung bisa menggeser harga ETH atau menjalankan "3 a.m. crash"; layer menyala berurutan dengan animasi aliran dana, dan di sampingnya ada perbandingan posisi yang sama tanpa proteksi (likuidasi + penalti).
- Setiap objek bisa di-inspect (hover, klik, atau keyboard). Inspector menjelaskan apa objek itu, kenapa penting, dan angka live-nya (termasuk harga likuidasi). Layer bisa dimatikan atau dinyalakan dari inspector atau panel.
- Model simulasi (`lab/model.ts`) memakai angka ilustratif (2 ETH, LT 0.83, trigger 1.30, target 1.60), bukan parameter protokol live. Disclaimer tampil di bawah section.
- Langkah tiap layer di section Layers kini diputar berurutan saat terlihat di layar (`StepTrack`).
- Semua ilustrasi isometrik lain (Problem, Cascade, L1/L2/L3, kedua Agent) kini bisa di-inspect lewat `illustrations/inspect.tsx` (`Inspectable` + `Hot`): hover, klik, atau keyboard memilih satu bagian, bagian lain meredup, dan kartu di bawahnya menjelaskan bagian itu. Kode kontrak di "Open by default" menjelaskan tiap baris penting (`AnnotatedCode`), dan langkah "How it works" bisa dipilih untuk melihat detailnya (`HowSteps`).

### Web, Dashboard & Kontrak
- Landing page + dashboard (positions, history, bot, chat placeholder, settings)
- Login wallet via SIWE + session cookie
- Simulation engine di dashboard (drift harga ETH, HF, pemilihan strategi)
- Linking & notifikasi Telegram dari antarmuka web
- Skema database (Drizzle) + script migrasi di `packages/db`
- `TahansoeGuardian` v1: hot reserve repay, unit + fuzz test, fork test Aave V3 Arbitrum Sepolia
- Guardian v1 ter-deploy di Arbitrum Sepolia: `0x1A5D249A8e711E2288AdD7c01e31Eb7FFB05D97E`
- Dokumentasi & workflow agent (PRD v0.3, BRD, architecture, security, ADR)
- Struktur monorepo npm workspaces (ADR 0007): `apps/web`, `apps/engine`, `packages/db`, `packages/domain`
- ~~**Pilihan Database Lokal: PGlite (ADR 0010)**~~ — **dihapus 14 Okt 2026** ([ADR 0011](decisions/0011-postgres-only-gateway-only-chat.md)): engine kini Postgres server (Neon) saja; PGlite tidak aman dibuka beberapa proses sekaligus.
- **Gateway Hardening & Single Poller Per Bot (10 Okt 2026):**
  - Exclusive bot lock file (`gateway-<sha256(token) first 12 hex>.lock`) dengan PID, heartbeat 15s, stale takeover 60s/dead PID, auto-cleanup saat stop/exit. Mencegah getUpdates simultan ke satu bot.
  - No Backlog Replies: Skip update `date < startup - 30s` pada poll pertama sambil tetap memajukan offset Telegram; `telegramDeleteWebhook` default `drop_pending_updates: true`.
  - Outbound Safety: Per-chat reply cap (max 5/10s, excess di-drop dengan notifikasi slow down maks 1x/menit), penanganan 429 patuh `retry_after` tanpa retry-loop tak terbatas, dan balasan private bot dibatasi maks 1x/jam per chat.
  - Pairing Persistence: Perbaikan skema Zod `telegramChannelSchema` (dukungan `botUsername` & `.passthrough()`), atomic rename fallback untuk Windows pada `writeSettings`, dan resolusi path settings target.
  - Reset state: `apps/engine/.data/gateway-state.json` `pendingPairings` direset bersih ke `{}`.
  - Test suite komprehensif (`apps/engine/test/gateway/hardening.test.ts`) 10/10 lulus, suite engine 435/435 hijau.

### Health Factor Sentinel & Keeper — Workstream C (Oktober 2026)
- **Event Sync:** membaca dan memproses log on-chain `PolicySet`, `PolicyDisabled`, dan `Protected` (serta event v2 `Layer*` dan `TriggerBand*`) dari blok deploy dengan cursor tersimpan di tabel `event_cursors`.
- **Sentinel Worker Loop (60s):** advisory lock Postgres (`42161005`) mencegah overlap. Multicall batch `getUserAccountData`, `allowance`, `balanceOf`, dan `quoteRepay` untuk semua policy aktif. Memperbarui tabel `positions` dan mendeteksi transisi zona risiko (`calculateZone` di `@tahansoe/domain`).
- **Alert Telegram Server-Side:** pengiriman peringatan otomatis saat terjadi transisi zona (`Warning`, `Critical`), kapasitas cadangan tipis (`RESERVE_LOW` jika `min(allowance, balance) < maxRepayPerAction`), dan eksekusi proteksi berhasil (`Protected`). Dideduplikasi sehingga hanya terkirim saat transisi zona baru.
- **Keeper Non-Custodial:** memanggil `protect(user)` pada kontrak Guardian saat HF < trigger dan `quoteRepay > 0`. Mode dry-run aman bila `KEEPER_PRIVATE_KEY` tidak disetel (I4). Dilengkapi in-flight mutex per user dan exponential backoff bila terjadi revert.
- **CLI & Scripts:** `npm run sentinel -w apps/engine` (alias `tahansoe sentinel run`), `tahansoe sentinel once`, `tahansoe sentinel sync`.

### Engine fix — audit 14 Okt 2026 ([ADR 0011](decisions/0011-postgres-only-gateway-only-chat.md))
- **Postgres server saja:** driver PGlite, `DB_DRIVER`, `PGLITE_DATA_DIR`, dan file lock PGlite dihapus dari `packages/db` & engine. `DATABASE_URL` wajib; `setup` meminta `DATABASE_URL` lalu menjalankan migrasi (`--db-url-env` untuk mode non-interaktif). `start` memperingatkan bila DB kosong.
- **Timeout & pembatalan LLM:** timeout per request (`LLM_REQUEST_TIMEOUT_MS`, default 90 s) + deadline per research run (`RESEARCH_RUN_TIMEOUT_MS`, default 15 menit) + signal shutdown dari worker. Router berhenti tanpa retry/fallback saat dibatalkan, menghormati `retry-after` (maks 30 s), dan mengecek budget sebelum setiap panggilan. Body respons bukan JSON tidak lagi melempar.
- **Pipeline agent lebih tahan:** exception analyst tercatat sebagai kegagalan dengan alasan (sebelumnya hilang diam-diam), debat gagal total → assessor tetap jalan dengan debat kosong (I6), exception assessor → run null dengan alasan, cek budget/deadline sebelum debat & assessor, gagal menulis salinan `out/` setelah simpan DB tidak menggagalkan run, retensi `out/` (`OUT_KEEP_RUNS`, default 50).
- **Budget harian bersama:** tabel `llm_usage_daily`; `LLM_DAILY_BUDGET_USD` berlaku lintas proses (daemon, `analyze`, chat gateway) dan tidak reset saat restart. Chat gateway menolak menjawab bila budget habis.
- **REPL & `tahansoe ask` dihapus:** chat hanya lewat channel gateway. Modul Q&A pindah ke `apps/engine/src/chat/`. Raw-mode input `setup` kini melepas stdin setelah selesai.
- **Mode background:** `tahansoe start --detach` + `stop` / `status` / `logs [-f]` (`src/cli/commands/daemon.ts`). Stop bersih lewat file permintaan (aman di Windows), force kill setelah 30 s. Smoke test nyata di Windows: start → status → logs → stop bersih.
- **Test RSS "flaky" ternyata time bomb** (fixture 8 Okt vs filter 48 jam memakai jam sistem) — diperbaiki dengan `now` tetap (Antigravity).
- **Bug pairing "kode kedaluwarsa" saat agent sudah jalan:** daemon menyimpan seluruh state memorinya tiap offset Telegram berubah, padahal kode dari `gateway pair` baru dimuat ulang di awal siklus long-poll (50 detik) → kode CLI tertimpa, `/start <kode>` ditolak. Kini `saveGatewayState` menggabungkan pairing & percobaan gagal dari disk sebelum menulis (`mergePairingsFromDisk`), dengan test regresi.
- **Pesan Telegram ramah HP + penjelasan** (`apps/engine/src/gateway/views.ts`): `/status`, `/fuse`, `/carry`, `/report`, `/history`, `/help`, jawaban chat, dan semua alert kini HTML ringkas (emoji regime, arti tiap regime, arti trigger/target HF, carry & kink dijelaskan, "yang bisa dicek" pada alert) mengikuti `ui.language` (id/en). Sebelumnya mengirim tabel terminal mentah. `captureCommandOutput` (membajak stdout global proses daemon) dihapus; data diambil langsung (`runFusion`, `fetchAaveRates` + `computeCarryData`, `fetchReport`, `recentReports`). Output CLI `carry` juga diberi penjelasan per bagian.
- **`tahansoe eval --help`** kini menampilkan bantuan (sebelumnya langsung menjalankan eval berbayar); flag tak dikenal ditolak.
- **Harga model "tidak diketahui"**: `settings.json` dari `setup` tidak memuat `pricingUrl` → budget memakai harga fallback termahal (±300× harga asli gpt-6-luna; ±Rp 13 vs ±Rp 4.500 per run). Kini `gatewayPricingUrl` menurunkan URL harga dari `LLM_API_URL` untuk gateway yang dikenal (Bynara, OpenRouter) dan `setup` selalu mengisinya ke `settings.json` bila masih kosong.
- Test engine 516/516 hijau, typecheck semua workspace bersih, lint 0 error.

### Core Risk Engine & Research Agents (M3)
- **Pipeline Riset Multi-Agent Penuh:** 4 analis domain paralel (Geopolitics, Macro, Market, Onchain) $\rightarrow$ debat dialektika Hawk vs Dove $\rightarrow$ sintesis Risk Assessor $\rightarrow$ pemetaan ke `Signal` (`RESEARCH`, confidence cap $\le 0.6$).
- **Adapter Sumber Data Gratis & Kredibel:**
  - RSS feed outlet berita terkurasi (BBC World, Al Jazeera, The Guardian, CNBC Economy, Federal Reserve, CoinDesk, The Block).
  - FinancialJuice RSS added (macro headlines, prefix strip, tick filter, speaker cap 2, per-feed cap 12).
  - FRED API untuk data makro ekonomi resmi (suku bunga Fed Funds, CPI, kurva yield 10Y-2Y).
  - Kalender makro resmi: jadwal FOMC dari federalreserve.gov (horizon 30 hari) dan rilis CPI/NFP dari data rilis FRED.
  - DefiLlama API untuk monitoring peg stablecoin (USDC, USDT, DAI, FRAX) dan insiden hack/exploit protokol DeFi dengan scaling ukuran dan relevansi Tahansoe.
  - On-chain Arbitrum One: pembacaan oracle Aave vs Chainlink proxy dan Sequencer Uptime Feed.
- **Single LLM Gateway OpenAI-Compatible (9 Okt 2026 — ADR 0009):**
  - Menggantikan konfigurasi multi-provider yang kompleks (men-supersede sebagian ADR 0008).
  - Environment server hanya membutuhkan dua secret: `LLM_API_URL` dan `LLM_API_KEY`. Berganti provider cukup mengganti dua nilai ini tanpa menyentuh kode.
  - Konfigurasi model per peran (`analyst`, `debate`, `assessor`, `reflector`) dan harga token disimpan di `settings.json` v2 (non-rahasia, di-gitignore) sebagai daftar nama model murni (*plain model names*) dengan fallback berantai.
  - JSON Schema di-embed langsung ke dalam system prompt, didukung toleransi ekstraksi teks, 1x repair retry jika schema tidak valid, lalu fallback ke model berikutnya.
  - Perhitungan budget harian terintegrasi dinamis dengan harga gateway (`settings.modelPrices` > `pricingUrl` > fallback konservatif).
- **CLI Terpadu `tahansoe` (9 Okt 2026 — [spec m3-cli](specs/m3-cli.md)):**
  - Satu pintu interaksi terminal operator (`apps/engine/src/cli/tahansoe.ts`, helper terpusat di `render.ts`).
  - Mendukung subcommand lengkap: `analyze` (live progress per tahap + kartu laporan), `schedule` (`run` foreground dengan advisory lock & live dashboard, `status`), `history`, `report` (`<id|latest>` format `--md` atau `--json`), `doctor`, `models`, `settings`, `eval`, `carry`, `fuse`, `settle`, `scorecard`, `setup`, `gateway`, serta `start [--detach]` / `stop` / `status` / `logs` (14 Okt 2026). `ask` dihapus (ADR 0011).
  - ~~Mode interaktif (REPL) dengan slash commands dan `tahansoe ask`~~ — dihapus 14 Okt 2026 (ADR 0011); grounded Q&A dengan guardrail yang sama kini hanya lewat gateway Telegram.
- **Carry & Interest-Rate Monitoring — jalur T11 (9 Okt 2026, [spec](specs/m3-carry-interest-monitoring.md)):**
  - Tabel `rate_samples` + sampler bunga Aave V3 Arbitrum tiap 15 menit (`RATE_SAMPLE_INTERVAL_MIN`), on-chain via Pool/strategy (I5).
  - Pemancar sinyal deterministik T11 (`src/signals/emit.ts`): kink proximity, lonjakan bunga (≥ 2× atau > 20% APR stablecoin), carry negatif 5 pasangan representatif; T7 bila utilization ≥ 98%. Guardrail: T11 tanpa konfirmasi lain maksimal ELEVATED (dihitung dari modul terkonfirmasi saja; property test).
  - `tahansoe carry`: tabel reserve + "HF 1.50 → 1.45 dalam N hari" + skenario lewat kink; tanpa kata ranking/saran investasi (test).
  - Verifikasi live: USDC.e util 92,1% (borrow 18–20%), GHO 93%, USDC native 91,7% lewat kink; WETH→USDC carry −4,7%/thn (≈ 265 hari ke HF 1.45). Fusion ETH/USDC naik CALM → ELEVATED dari sinyal on-chain.
- **Modul Sinyal Deterministik & Deduplikasi (9 Okt 2026, [spec](specs/m2-deterministic-signal-modules.md), commit 1803000):**
  - Modul deterministik lengkap memancarkan sinyal terkonfirmasi via `src/signals/emit.ts`:
    - `ORACLE`: Sequencer uptime (T10, down = 1.0, grace period 1 jam = 0.7), staleness & deviasi AaveOracle vs Chainlink proxy (T8).
    - `ONCHAIN`: Depeg stablecoin USDC/USDT/DAI > 1% (T4, linear s.d. 5%), suku bunga dekat kink & negative carry (T11), reserve kering (T7).
    - `MACRO`: Event ekonomi resmi FOMC, CPI, NFP dalam rentang 48 jam mendatang (T1/T2, severity 0.4–0.6, horizon terstruktur).
  - **Stable dedupe keys:** Menggunakan `getSignalDedupeKey(s)` (`${module}:${primaryPath}:${asset}:${type}`) untuk mencegah penggandaan skor sinyal di tabel `signals` saat fusion tick berulang (15 menit).
  - **Risk Fusion v1 Terintegrasi:** Menggabungkan sinyal terkonfirmasi (`ONCHAIN`, `ORACLE`, `MACRO`) dan sinyal `RESEARCH`. Guardrail deterministik menjamin sinyal riset AI unconfirmed (cap confidence 0.60) tidak pernah bisa menaikkan regime ke `STRESSED`/`CRISIS` sendirian tanpa konfirmasi pasar nyata. Status sinyal dan hasil fusion dapat langsung diinspeksi via `tahansoe fuse`.
- **Pemilihan model final (9 Okt 2026, prompt 2026.10.2 + redaksi instruksi):** `gpt-6-luna` (OpenAI) lolos eval **24/24** (injeksi 16/16 tanpa bocoran, skenario 8/8, schema 100%), biaya eval Rp 110 (~Rp 4,6 per kasus). Dipakai sebagai default semua peran, cadangan `deepseek-v4-flash`. `agnes-2.5-flash` ditinggalkan karena asal-usul model tidak jelas dan masih ada bocoran injeksi/overrun schema.
  - Mengonsumsi ~36.5k token dengan biaya operasional sangat efisien (~Rp6/run) dan menghasilkan proposal regime `CALM`.
- **Penyimpanan Database Neon Postgres:** Tabel `research_reports` (dengan diagnostik per-peran audit G7) dan `signals` (`RESEARCH`), serta skrip inspeksi riwayat `tahansoe history`.
- **Scheduled Background Research Worker:**
  - Single-instance enforcement via PostgreSQL session advisory lock (`pg_try_advisory_lock(42161001)` pada koneksi direct non-pooler) mencegah tabrakan proses.
  - Penjadwalan adaptif berdasarkan regime hasil terakhir (`CALM` $\rightarrow$ 2 jam; `ELEVATED`/`STRESSED`/`CRISIS` $\rightarrow$ 1 jam; dapat dioverride lewat env).
  - Guard anti-overlap, kill switch `RESEARCH_ENABLED=false`, proteksi budget harian `LLM_DAILY_BUDGET_USD`, logging terformat satu baris per run, dan shutdown bersih pada `SIGINT`/`SIGTERM`.
- **Eval Set & Runner Sadar Kuota:**
  - 16 kasus prompt injection (menguji ketahanan guardrail G3 dan kebocoran instruksi) + 8 kasus skenario pasar acuan dengan rentang regime yang disepakati.
  - Runner eval dengan kesadaran kuota dan konkurensi: worker pool `--concurrency N` (default 1), jeda antar kasus (`DEFAULT_CASE_DELAY_MS`), deteksi error kuota harian (menghentikan run, menandai kasus tersisa `skipped: quota`, menulis laporan parsial), hard spend cap IDR (`--max-cost-idr`, default Rp 3000), dan retry otomatis pada rate limit 429 per-menit.
  - Opsi CLI lengkap: `--set injection|scenarios|all`, `--limit N`, `--concurrency N`, `--label <name>`, `--initial-spent-idr N`, dan `--dry-plan` untuk perencanaan offline.
  - 17 unit test offline lulus 100% menggunakan `FakeProvider` dan fake `runCase` deterministik.
- **Hasil Benchmark Evaluasi Gateway Bynara (9 Okt 2026 — Prompt v2026.10.2):**
  - **Combo A-v2 (`all agnes-2.5-flash`):** Pass rate 87.5% (21/24), Scenario Agreement 87.5% (7/8, target $\ge 70\%$ terpenuhi), Injection 14/16 pass, Biaya Rp 76.53 (~Rp 3.19/kasus).
  - Terbukti sebagai kombinasi paling murah dan andal dibandingkan opsi lain (`deepseek-v4-flash` jauh lebih rentan kebocoran prompt injeksi dan 6-7x lebih mahal).
- **Scheduled Settlement & Scorecard Pipeline (ADR 0005, spec §3.5 & §3.6):**
  - Evaluasi deterministik hasil prediksi research agent (`TRUE_POSITIVE`, `FALSE_POSITIVE`, `MISSED`, `TRUE_NEGATIVE`) menggunakan sampel harga AaveOracle (I5) dan sinyal on-chain.
  - Guard kelengkapan jendela data (toleransi batas awal/akhir 30 menit, celah internal maks 60 menit) menghindari penyimpanan label spekulatif/palsu di database.
  - Eksekusi idempotent (`runSettlementJob`) aman terhadap eksekusi berulang tanpa duplikasi baris di `risk_settlements`.
  - Scorecard generator & CLI tabel ASCII (`apps/engine/src/cli/scorecard.ts`) menghitung Recall, Presisi (≥ STRESSED), Median Lead Time, dan pelacakan laporan yang kekurangan data.
  - 31 unit test offline lulus 100% dan terverifikasi live pada database Neon.
- **~~CLI Mode Interaktif (REPL) & `tahansoe ask`~~ (9 Okt 2026, dihapus 14 Okt 2026 — ADR 0011; Q&A grounded di bawah tetap berlaku lewat gateway Telegram):**
  - Prompt interaktif terminal `tahansoe` tanpa argumen: REPL readline dengan banner, status line terkini, autocomplete Tab untuk slash commands (`/analyze`, `/fuse`, `/carry`, `/history`, `/report`, `/settle`, `/scorecard`, `/models`, `/settings`, `/doctor`, `/status`, `/help`, `/clear`, `/exit`).
  - Command non-interaktif `tahansoe ask "<question>"` (`--json`, `--no-color`) untuk scripting & verifikasi CI/CD.
  - Runtime pricing otomatis dibootstrap dari gateway pricing/settings (`bootstrapBudgetPricing`), menampilkan estimasi biaya aktual dalam IDR ("Rp 1" – "Rp 2") tanpa fallback warning palsu.
  - Pelacakan kesegaran data per-sumber (`report`, `assessments`, `signals`, `rate_samples`, `price_samples`) dengan ambang 6 jam; penanda eksplisit `STALE since <time>` diteruskan ke model, dan baris penutup otomatis mencantumkan sumber stale berserta rekomendasi refresh (`schedule run --with-price` atau `/analyze`).
  - Guardrail keamanan: penolakan ketat instruksi trading, saran investasi, prediksi harga token, dan jaminan anti-likuidasi (PRD §11); redaksi prompt injection tersisip (`redactInstructions`); sanitasi karakter kontrol terminal; footer "informational · not investment advice".
  - 20 unit test offline lulus 100% dan terverifikasi live dengan gateway Bynara / `gpt-6-luna`.

---

## Gap yang diketahui

### Broadcast riset (ADR 0012, review alignment 23 Okt 2026)
- [ ] `broadcast/worker.ts` masih hardcode `chainId = 42161` (I6) → ambil dari chain registry / opsi config.
- [ ] Severity alert sinyal (`alertSeverities`) hanya tersimpan di memori. Sejak 24 Okt, restart tidak lagi mengirim ulang alert, tapi kenaikan severity pertama setelah restart (dalam 6 jam) tidak terdeteksi. Simpan severity di tabel `broadcasts`.
- [ ] `packages/db/scripts/copy-engine-data.ts` fallback ke path `.env` lokal developer → wajibkan `SOURCE_DATABASE_URL`.
- [ ] Belum ada test regresi untuk `onRunCompleted` di `tahansoe start` yang terpanggil sebelum broadcaster dibuat (bug TDZ sudah diperbaiki 23 Okt).
- [ ] Preferensi per user (bahasa, matikan digest, filter aset) belum ada; semua akun aktif menerima broadcast yang sama.

### Evaluasi & Model LLM
- [ ] Batasan skema 800 karakter untuk `hawkCase`/`doveCase` terkadang ketat pada model selain `gpt-6-luna`; pertimbangkan relaksasi ke 1200 karakter bila diperlukan saat evaluasi model alternatif.

### Engine, Fusion & Settlement
- [ ] Verifikasi syarat penggunaan (ToS) FinancialJuice untuk pemakaian komersial sebelum produksi.
- [ ] FinancialJuice membalas HTTP 429 bila diambil beberapa kali dalam hitungan menit (terlihat saat uji 15 Okt 2026). Sudah terdegradasi aman (warning, feed lain tetap jalan); pertimbangkan cache respons RSS per URL ±10 menit bila `analyze` manual + scheduler sering berbarengan.
- [ ] `runResearch` dan `fetchGdeltEvents` belum menerima `now` yang bisa di-inject (temuan sweep test; mempersulit test deterministik).
- [ ] Belum ada test integrasi DB setelah PGlite dihapus (dulu memakai PGlite in-memory); butuh branch Neon/Postgres khusus test.
- [ ] Price worker tetap men-sampling tanpa `DATABASE_URL` (hasil tidak tersimpan); pertimbangkan berhenti/peringatan per tick.
- [ ] Scorecard belum direkap otomatis mingguan (settlement sendiri sudah berjalan tiap 60 menit di `tahansoe schedule run`, lock terpisah; data scorecard baru bermakna setelah scheduler jalan beberapa hari).
- [ ] Modul teknikal lanjutan M2 (volatilitas realized EWMA/GARCH, funding rate ekstrem, open interest perp DEX) belum diimplementasikan.
- [x] Pengiriman notifikasi alert Telegram langsung dari server engine sudah selesai via Sentinel Worker (Workstream C).
- [x] Host deployment engine worker: VPS Ubuntu 24.04 + Docker (24 Okt 2026), lihat entri "Engine di VPS".
- [ ] Deploy VPS masih salin manual (tar + scp ke `/opt/tahansoe`); belum ada skrip/CI deploy. Cloudflare Tunnel belum dipasang (belum perlu, worker outbound-only).
- [ ] Sentinel & keeper (`tahansoe sentinel run`) belum dijalankan di VPS.
- [ ] Price worker memanggil `process.exit(0)` saat lock dipegang instance lain, sehingga ikut mematikan seluruh `tahansoe start`. Sebaiknya lewati sampler saja, seperti job settle/fusion.

### Produk Web & Kontrak (M1)
- [ ] Web app belum terhubung ke kontrak Guardian v1 (belum ada read/write on-chain langsung).
- [ ] Settings user masih disimpan di `localStorage`, belum tersinkronisasi ke kontrak atau database.
- [ ] Dashboard masih menampilkan data simulasi demo, bukan posisi borrow Aave asli dari wallet terhubung.
- [ ] Tabel `users` unik per `(wallet, chainId)` $\rightarrow$ perlu disederhanakan per wallet.
- [ ] Tabel `positions`, `policies`, `intents`, `notification_logs` belum aktif digunakan oleh web app.

### Kontrak & Keamanan
- [ ] `checkUpkeep` memakai daftar user statis di `checkData`; butuh registry/pagination on-chain.
- [ ] Satu policy & satu debt asset per user di v1.
- [ ] Kontrak Guardian v1 belum diaudit formal.
- [ ] Guardian v2 (risk band dinamis, pergeseran trigger via AI agent, flash loan) direncanakan untuk M4.

---

## Next steps (urutan disarankan)

1. **Jalankan agent di background** dengan `tahansoe start --detach` (atau systemd/pm2 di VPS) dan pantau lewat `tahansoe status` / `logs -f`; pastikan `llm_usage_daily` terisi setelah `npm run db:migrate`.
2. **Jalankan scheduler beberapa hari** (`tahansoe schedule run --with-price`) agar settlement otomatis (sudah tiap 60 menit) menghasilkan label `TRUE_POSITIVE`/`FALSE_POSITIVE`/`MISSED` nyata, lalu uji reflector (lessons) dan rekap scorecard mingguan.
3. **Implementasi Notifikasi Telegram Server:** Memindahkan trigger alert Telegram dari frontend browser ke engine worker agar alert tetap terkirim saat user tidak membuka web.
4. **Implementasi Integrasi Web On-chain (Spec M1):** Menghubungkan settings web ke `TahansoeGuardian` v1 (`approve` + `setPolicy`), membaca posisi Aave nyata via wagmi/viem, dan menyelesaikan transisi dashboard demo.
5. **Modul Teknikal Lanjutan M2:** Volatilitas realized (EWMA), funding rate ekstrem, dan open interest pada perp DEX Arbitrum.
6. **User proof (masukan mentor, 24 Okt 2026), masih Proposed/Draft dan menunggu review owner:**
   - [ADR 0013](decisions/0013-success-fee-on-protection.md): fee sukses 0,15%, hanya saat HF di bawah trigger statis dan di bawah 1,50. Menggantikan butir 2–4 ADR 0006 dan merevisi I1/I4 saat Accepted.
   - [ADR 0014](decisions/0014-simulation-network-anvil-fork.md): fork anvil di VPS dan workspace `apps/simnet`.
   - Spec [simulation mode](specs/m1-simulation-mode.md) dan [Guardian v3 fee](specs/m4-guardian-success-fee.md).
   - Section perbandingan dengan DeFi Saver di landing.
   - Koreksi FAQ/PRD: DeFi Saver kini mendukung EOA untuk Aave v3.

---

## Backlog / ide

- ~~**Test flaky**~~ (selesai 14 Okt 2026): penyebabnya test RSS bergantung tanggal sistem; kini memakai `now` tetap.

- **(SELESAI 9 Okt 2026, commit 8bfa840) `tahansoe setup` wizard:** input `LLM_API_URL` + `LLM_API_KEY` (tersembunyi) → tes `/models` → pilih model + estimasi biaya → simpan `settings.json`; isi `DATABASE_URL` (+ migrasi) & RPC; tutup dengan `doctor`. Secret hanya ke `.env` (gitignored), tidak pernah dicetak ulang.
- [x] ~~**Pilihan database lokal (ADR 0010)**~~ — di-supersede ADR 0011 (14 Okt 2026), PGlite dihapus: `DB_DRIVER=pglite` (Postgres embedded, data di `apps/engine/.data/`, tanpa server/akun — skema & query Drizzle tetap sama) di samping `DB_DRIVER=neon`. Auto-migrasi dan file advisory lock selesai.

- Guardian v4 `setLayer2` kind `L2_ATOKEN`: validasi `source` sama dengan `getReserveData(debtAsset).aTokenAddress`, bukan hanya `UNDERLYING_ASSET_ADDRESS()` (pola warisan V2; aToken palsu hanya merugikan user yang mengaturnya, tapi bisa memakai aToken yang nyasar ke Guardian).
- EIP-7702 untuk smart account tanpa migrasi wallet
- `repayWithATokens` sebagai opsi sumber dana tanpa modal idle
- API risk score untuk partner B2B
- Shadow mode 2 minggu research agents sebelum notifikasi Telegram diaktifkan untuk user

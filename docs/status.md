# Status Proyek

**Last updated:** 8 Oktober 2026
**Milestone aktif:** M1 (integrasi end-to-end) dan M2 (Core Risk Engine v1) — lihat [PRD §10](prd.md#10-roadmap-eksekusi)

> Perbarui file ini di akhir setiap pekerjaan: pindahkan item yang selesai, tambahkan gap baru, dan tulis next step.

---

## Sudah jalan

- Landing page + dashboard (positions, history, bot, chat placeholder, settings)
- Login wallet via SIWE + session cookie
- Simulation engine di dashboard (drift harga ETH, HF, pemilihan strategi)
- Linking & notifikasi Telegram
- Skema database (Drizzle) + script migrasi
- `TahansoeGuardian` v1: hot reserve repay, unit + fuzz test, fork test Aave V3 Arbitrum Sepolia
- Guardian v1 ter-deploy di Arbitrum Sepolia: `0x1A5D249A8e711E2288AdD7c01e31Eb7FFB05D97E`
- Dokumentasi & workflow agent (PRD v0.2, BRD, architecture, security, ADR)
- Struktur repo & runtime: ADR 0007 (*Accepted*) — npm workspaces, Next.js + worker terpisah, tanpa indexer dulu. Fase 0–2 selesai: `.gitattributes`, CI, `packages/domain`, `packages/db` (skema tunggal, termasuk tabel research yang belum dimigrasi), web di `apps/web`, engine di `apps/engine` (typecheck, test 22+16, build hijau)
- Spec draft (menunggu persetujuan): [M1 integrasi web on-chain](specs/m1-web-onchain-integration.md), [M2 kerangka engine](specs/m2-engine-skeleton.md)
- Prompt LLM engine berbahasa Inggris (`promptVersion` 2026.10.1)
- Lint web 0 error; UI menampilkan chain Arbitrum; `arbitrumSepolia` ada di wagmi
- Model bisnis: ADR 0006 (*Accepted*) — informasi gratis, otomasi Pro, tanpa fee on-chain di v1
- Desain research agents & reflection: ADR 0004/0005 (*Accepted*), [spec m3-research-agents](specs/m3-research-agents.md), [knowledge/risk-transmission](knowledge/risk-transmission.md), PRD v0.3

## Gap yang diketahui

### Produk inti (prioritas tertinggi)
- [ ] Web app belum terhubung ke kontrak (tidak ada read/write Guardian)
- [ ] Settings hanya disimpan di localStorage; belum ke kontrak/DB
- [ ] Dashboard memakai data simulasi, bukan posisi Aave asli
- [ ] Belum ada keeper/worker; alert Telegram dipicu dari browser (hanya jalan saat tab terbuka)
- [ ] Core Risk Engine (`engine/`) belum dimulai

### Konsistensi
- [ ] Copy Telegram "execution success" menyebut flash loan; v1 memakai hot reserve
- [ ] FAQ/landing menyebut Safe Module; v1 memakai approve dari EOA (lihat ADR 0003)
- [ ] `contracts/README.md` merujuk `.env.example` yang belum ada (`.gitignore` kini mengizinkan `.env.example`; file-nya belum dibuat)
- [ ] Form waitlist tidak menyimpan email

### Data & teknis
- [ ] `users` unik per `(wallet, chainId)` → ganti jadi per wallet
- [ ] Tabel `positions`, `policies`, `intents`, `notification_logs` belum dipakai
- [ ] Tabel `guardian_modules` mengasumsikan Safe; tinjau ulang
- [ ] CI baru ditambahkan (`.github/workflows/ci.yml`); belum terbukti hijau di GitHub
- [ ] **Vercel: ubah Root Directory proyek ke `apps/web`** saat branch ini di-merge (web sudah pindah); env Vercel tidak berubah. Lokal: pindahkan `.env` ke `apps/web/.env`
- [ ] Migrasi struktur ADR 0007 fase 3: simulasi & mock data → `apps/web/features/demo/` (bersama M1)
- [ ] Tabel research (`packages/db/src/research.ts`) belum ada di `packages/db/scripts/migrate.ts`
- [ ] 12 warning lint lama di web (non-blocking)
- [ ] Konfigurasi npm mesin dev memakai `legacy-peer-deps=true`; `ethers` (peer dep `siwe`) kini dependensi eksplisit web
- [ ] Host untuk engine (worker selalu hidup) belum dipilih
- [ ] Belum ada test untuk web app

### Kontrak
- [ ] `checkUpkeep` memakai daftar user statis di `checkData`; butuh registry/pagination
- [ ] Satu policy & satu debt asset per user
- [ ] Belum ada insentif/biaya keeper
- [ ] Guardian v2 (risk band, risk agent, dynamic trigger, flash loan) belum ada
- [ ] Tanpa PriceOracleSentinel di Aave Arbitrum One → keeper harus siap `protect` di blok pertama setelah sequencer pulih (security S6)
- [ ] Belum diaudit

### Keamanan
Lihat [security.md §3](security.md#3-temuan-terbuka).

## Next steps (urutan disarankan)

> **Prioritas tim (8 Okt 2026): AI research dulu.** Pekerjaan web (spec M1) ditunda sampai research agent berjalan end-to-end. Wave aktif: pipeline research dry-run (LLM + agents) dan sumber data gratis & kredibel (GDELT, FRED, on-chain snapshot; Polymarket dikeluarkan).

1. Setujui spec M1 & M2, lalu implementasi [M2 kerangka engine](specs/m2-engine-skeleton.md) (chain registry, AaveAdapter read, scheduler, event sync, Oracle Monitor, tabel signals/risk_assessments)
2. Keeper v1 di engine: `needsProtection` → `protect` + log `intents` + Telegram dari server
3. Web: implementasi [spec M1](specs/m1-web-onchain-integration.md) — Settings → `approve` + `setPolicy`, dashboard baca posisi asli, demo mode
4. Oracle monitor + technical module + macro calendar → RiskAssessment dry-run
5. CI
6. Verifikasi lisensi komersial sumber data research (FRED, GDELT, DefiLlama, Reddit) dan cara baca OI/funding perp DEX on-chain di Arbitrum
7. Settlement deterministik + scorecard bersamaan dengan Risk Fusion v1 (M2), agar ada baseline sebelum research agents (M3)

## Backlog / ide

- Perketat filter relevansi berita RSS (`apps/engine/src/sources/rss.ts`): kata kunci umum seperti "attack" dan "election" masih meloloskan berita non-pasar (mis. kriminal lokal, kebijakan perumahan)

- EIP-7702 untuk kemampuan smart account tanpa migrasi wallet
- `repayWithATokens` sebagai sumber dana tanpa modal idle
- API risk score untuk partner B2B

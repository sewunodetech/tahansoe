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
- Model bisnis: ADR 0006 (*Accepted*) — informasi gratis, otomasi Pro, tanpa fee on-chain di v1
- Desain research agents & reflection: ADR 0004/0005 (*Accepted*), [spec m3-research-agents](specs/m3-research-agents.md), [knowledge/risk-transmission](knowledge/risk-transmission.md), PRD v0.3

## Gap yang diketahui

### Produk inti (prioritas tertinggi)
- [ ] Web app belum terhubung ke kontrak (tidak ada read/write Guardian)
- [ ] `arbitrumSepolia` belum ada di `lib/wagmi-config.ts`
- [ ] Settings hanya disimpan di localStorage; belum ke kontrak/DB
- [ ] Dashboard memakai data simulasi, bukan posisi Aave asli
- [ ] Belum ada keeper/worker; alert Telegram dipicu dari browser (hanya jalan saat tab terbuka)
- [ ] Core Risk Engine (`engine/`) belum dimulai

### Konsistensi
- [ ] Copy Telegram "execution success" menyebut flash loan; v1 memakai hot reserve
- [ ] FAQ/landing menyebut Safe Module; v1 memakai approve dari EOA (lihat ADR 0003)
- [ ] `contracts/README.md` merujuk `.env.example` yang belum ada
- [ ] Form waitlist tidak menyimpan email
- [ ] UI masih menyebut chain "Base" (`components/landing/HFCard.tsx`, `components/ui/dashboard-sidebar.tsx`, `lib/mock-data.ts`); `base` jadi chain pertama di `lib/wagmi-config.ts`

### Data & teknis
- [ ] `users` unik per `(wallet, chainId)` → ganti jadi per wallet
- [ ] Tabel `positions`, `policies`, `intents`, `notification_logs` belum dipakai
- [ ] Tabel `guardian_modules` mengasumsikan Safe; tinjau ulang
- [ ] Belum ada CI (lint + `forge test`)
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

1. Spec M2: kerangka `engine/` (chain registry, AaveAdapter read, scheduler, tabel signals/risk_assessments)
2. Keeper v1 di engine: `needsProtection` → `protect` + log `intents` + Telegram dari server
3. Web: `arbitrumSepolia` di wagmi, Settings → `approve` + `setPolicy`, dashboard baca posisi asli (simulasi jadi "demo mode")
4. Oracle monitor + technical module + macro calendar → RiskAssessment dry-run
5. CI
6. Verifikasi lisensi komersial sumber data research (FRED, Polymarket, Alpha Vantage, Yahoo, Reddit, GDELT) dan cara baca OI/funding perp DEX on-chain di Arbitrum
7. Settlement deterministik + scorecard bersamaan dengan Risk Fusion v1 (M2), agar ada baseline sebelum research agents (M3)

## Backlog / ide

- EIP-7702 untuk kemampuan smart account tanpa migrasi wallet
- `repayWithATokens` sebagai sumber dana tanpa modal idle
- API risk score untuk partner B2B

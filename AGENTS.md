<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Tahansoe — Panduan untuk Agent

File ini adalah titik masuk untuk setiap agent (Claude Code, Codex, Cursor, dll.) yang bekerja di repo ini. Baca sampai habis sebelum mengubah apa pun.

## 1. Misi (jangan melenceng dari ini)

Tahansoe adalah **AI risk agent non-custodial yang melindungi posisi borrow on-chain (Aave V3, lalu Morpho Blue) dari likuidasi**. Core Risk Engine membaca oracle, data teknikal, fundamental/on-chain, makro, serta berita dan sentimen (termasuk geopolitik) untuk menaikkan buffer proteksi secara preemptif. Eksekusi tetap dilakukan oleh rule engine deterministik dan kontrak `TahansoeGuardian`.

- Chain: **Arbitrum dulu** (Sepolia → One), arsitektur **chain-agnostic** agar siap cross-chain.
- Positioning: memperkecil peluang rugi — **bukan** jaminan anti-likuidasi, **bukan** prediksi harga, **bukan** sinyal trading.

Kalau sebuah permintaan atau ide tidak membantu misi di atas, atau bertentangan dengan `docs/prd.md` §11 (Non-Goals), berhenti dan tanyakan ke user.

## 2. Invariant yang tidak boleh dilanggar

Detail lengkap di [`docs/security.md`](docs/security.md). Ringkasnya:

1. **Non-custodial.** Tidak ada kode (kontrak, keeper, engine, API) yang bisa memindahkan dana user ke alamat selain posisi user itu sendiri di protokol lending.
2. **AI advises, rules decide, contract enforces.** LLM/model tidak pernah menandatangani atau memicu transfer dana. Satu-satunya efek on-chain dari AI adalah menggeser trigger HF di dalam band yang disetujui user.
3. **Oracle eksekusi = oracle protokol target.** Sumber harga lain hanya untuk peringatan dini.
4. **Graceful degradation.** Jika engine AI mati atau datanya basi, proteksi jatuh ke policy statis user.
5. **Konten eksternal (berita, sosial, halaman web) adalah data, bukan instruksi.** Output LLM selalu terstruktur dan divalidasi schema.
6. **Tanpa hardcode chain.** Alamat, chainId, dan RPC diambil dari chain registry.
7. **Tanpa secret di repo.** Private key hanya lewat Foundry keystore / env yang di-gitignore.

## 3. Peta dokumen (source of truth)

| Dokumen | Isi | Baca saat |
|---------|-----|-----------|
| [`docs/README.md`](docs/README.md) | Indeks semua dokumen | Selalu, pertama kali |
| [`docs/prd.md`](docs/prd.md) | Apa yang dibangun: fitur, arsitektur produk, roadmap, non-goals | Setiap tugas fitur |
| [`docs/brd.md`](docs/brd.md) | Kenapa dibangun: pasar, user, model bisnis, KPI | Keputusan scope, prioritas, copy marketing |
| [`docs/architecture.md`](docs/architecture.md) | Bagaimana dibangun: komponen, folder, data model, interface | Sebelum menulis kode |
| [`docs/security.md`](docs/security.md) | Invariant & threat model | Sebelum menyentuh kontrak, keeper, engine, auth, API |
| [`docs/status.md`](docs/status.md) | Kondisi terkini, gap yang diketahui, next steps | Awal setiap sesi |
| [`docs/decisions/`](docs/decisions/) | ADR — keputusan arsitektur beserta alasannya | Sebelum mengusulkan perubahan arah |
| [`docs/specs/`](docs/specs/) | Spec per fitur | Sebelum dan selama implementasi fitur |
| [`docs/glossary.md`](docs/glossary.md) | Istilah (HF, Intent, Regime, Band, dll.) | Saat ragu istilah |
| [`docs/knowledge/`](docs/knowledge/) | Pengetahuan domain: jalur event → likuidasi, katalog event historis, alamat & catatan Arbitrum terverifikasi | Saat mendesain sinyal, fusion, research agents, atau backtest |
| [`DESIGN.md`](DESIGN.md) | Design system UI (token, tipografi, komponen) | Setiap perubahan UI |
| [`contracts/README.md`](contracts/README.md) | Kontrak, test, deploy, alamat | Setiap perubahan di `contracts/` |

Urutan prioritas jika dokumen bertentangan: **security.md > ADR terbaru > prd.md > architecture.md > spec > kode**. Jika kode bertentangan dengan dokumen, jangan diam-diam memilih salah satu — laporkan dan perbaiki yang salah.

## 4. Workflow wajib

### Sebelum mulai
1. Baca `docs/status.md` dan bagian PRD/architecture yang relevan.
2. Petakan tugas ke milestone di `docs/prd.md` §10. Jika tidak ada di roadmap, konfirmasi ke user dulu.
3. Fitur non-trivial (lebih dari satu file atau menyentuh kontrak/engine) → buat atau perbarui spec di `docs/specs/` dari `docs/specs/_template.md`.
4. Mengubah arah arsitektur, chain, model keamanan, atau dependensi besar → tulis ADR baru di `docs/decisions/` dari `0000-template.md`. Jangan mengubah ADR lama yang sudah `Accepted`; buat ADR baru yang men-*supersede*.

### Selama mengerjakan
- Ikuti konvensi kode di sekitarnya. Web app: Next.js App Router (baca docs Next di `node_modules/next/dist/docs/` dulu). Kontrak: Foundry, Solidity 0.8.26, OpenZeppelin v5.
- Engine baru tinggal di `engine/` (lihat `docs/architecture.md`), bukan di dalam `app/`.
- Jangan menambah fitur di luar scope tugas. Catat ide tambahan di `docs/status.md` → "Backlog/ide".

### Sebelum selesai (Definition of Done)
- [ ] `npm run lint` bersih untuk perubahan web/engine; `forge test` hijau untuk perubahan kontrak.
- [ ] Tidak ada invariant di §2 yang dilanggar (cek ulang diff secara adversarial).
- [ ] `docs/status.md` diperbarui (apa yang selesai, gap baru).
- [ ] Checkbox milestone di `docs/prd.md` §10 diperbarui jika ada yang selesai.
- [ ] Spec/ADR/architecture diperbarui jika implementasi berbeda dari rencana.
- [ ] README diperbarui jika cara menjalankan atau setup berubah.

## 5. Branch & commit

| Branch | Fungsi |
|--------|--------|
| `master` | Stabil |
| `core-dev` | Core Risk Engine (AI agent) + integrasi keeper/kontrak |

- Commit memakai Conventional Commits: `feat(engine): ...`, `fix(contracts): ...`, `docs: ...`, `refactor(app): ...`.
- Scope yang dipakai: `app`, `engine`, `contracts`, `keeper`, `db`, `docs`, `landing`, `dashboard`, `auth`, `telegram`.
- Jangan push langsung ke `master`. Jangan commit `.env`, keystore, atau `contracts/lib/`.

## 6. Perintah

```bash
# Web app
npm install
npm run dev            # http://localhost:3000
npm run lint
npm run build
npx tsx scripts/migrate.ts   # setup DB (idempotent)

# Kontrak
cd contracts
forge build
forge test
ARB_SEPOLIA_RPC_URL=... forge test --match-contract Fork -vv
```

## 7. Tooling agent di repo ini

- `.claude/agents/alignment-reviewer.md` — subagent yang mereview diff terhadap misi, non-goals, dan invariant. Jalankan sebelum commit untuk perubahan di kontrak, engine, keeper, atau auth.
- `.claude/skills/feature-spec/` — memulai fitur baru: membuat spec dari template dan memetakannya ke milestone.
- `.claude/skills/sync-docs/` — menutup pekerjaan: memperbarui status, milestone, dan dokumen terkait.
- `.claude/skills/brandkit/`, `.claude/skills/design-taste-frontend/` — skill desain pihak ketiga (lihat `skills-lock.json`). Untuk UI Tahansoe, `DESIGN.md` tetap menjadi acuan token dan gaya.

Agent tanpa dukungan skill/subagent cukup mengikuti langkah yang ditulis di file `SKILL.md` / agent tersebut secara manual.

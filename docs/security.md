# Tahansoe — Security Invariants & Threat Model

**Last updated:** 8 Oktober 2026

Dokumen ini adalah prioritas tertinggi di antara semua dokumen proyek. Setiap perubahan di `contracts/`, `engine/`, keeper, auth, atau API yang menerima input eksternal wajib dicek terhadap dokumen ini.

---

## 1. Invariant

| # | Invariant | Ditegakkan oleh |
|---|-----------|-----------------|
| I1 | Dana user hanya boleh berpindah dari wallet user ke protokol lending **untuk posisi user itu sendiri** (repay utangnya / supply collateral-nya). Sisa selalu dikembalikan ke user. | Kontrak Guardian |
| I2 | Guardian tidak menyimpan saldo di antara transaksi, tidak punya owner/admin, tidak punya fungsi withdraw/upgrade. | Kontrak Guardian |
| I3 | AI/LLM tidak pernah menandatangani transaksi yang memindahkan dana. Pengaruh AI on-chain terbatas pada trigger HF di dalam band yang disetujui user. | Arsitektur + Guardian v2 |
| I4 | Kompromi penuh atas Tahansoe (server, keeper key, agent, LLM) hanya boleh berdampak "utang user dibayar lebih awal", tidak pernah kehilangan dana. | I1–I3 |
| I5 | Perhitungan HF untuk eksekusi memakai oracle protokol target. | Rule engine + kontrak (baca `getUserAccountData`) |
| I6 | Jika engine AI mati, data basi, atau assessment kedaluwarsa, sistem memakai policy statis user. | Rule engine + `validUntil` on-chain (v2) |
| I7 | User selalu bisa menghentikan proteksi sendiri (`disablePolicy`, cabut allowance, cabut risk agent). | Kontrak |
| I8 | Tidak ada secret (private key, token, API key) di repo atau di bundle client. | Review + `.gitignore` |

Setiap fitur yang tidak bisa memenuhi semua invariant di atas **tidak boleh di-merge** tanpa ADR yang disetujui owner.

---

## 2. Threat model per komponen

### 2.1 Kontrak Guardian

| Ancaman | Mitigasi |
|---------|----------|
| Caller jahat memanggil `protect` untuk menguras user | `protect` hanya repay utang user sendiri, dibatasi kebutuhan mencapai target, cap per aksi, saldo & allowance; sisa dikembalikan; HF wajib naik |
| Reentrancy lewat token | `nonReentrant`, SafeERC20 |
| Allowance berlebih | UI menyarankan allowance terbatas; `maxRepayPerAction` |
| (v2) Agent jahat menggeser trigger ekstrem | Clamp ke band user, batas perubahan per update, `validUntil`, user bisa cabut agent |
| (v2) Swap/deleverage di-sandwich | Router allowlist, batas slippage, simulasi sebelum kirim |
| Bug | Unit + fuzz + fork test; audit sebelum mainnet |

### 2.2 Keeper

| Ancaman | Mitigasi |
|---------|----------|
| Kunci keeper bocor | Kunci hanya bisa memanggil fungsi publik yang tunduk pada I1–I3; saldo keeper hanya untuk gas |
| Keeper down | Chainlink Automation + cron cadangan; siapa pun bisa memanggil `protect` |
| Transaksi gagal saat gas spike | Simulasi dulu, gas strategy, retry, alert `EXECUTION_FAILED` |

### 2.3 Core Risk Engine & LLM

| Ancaman | Mitigasi |
|---------|----------|
| Prompt injection dari berita/sosial | Konten eksternal diperlakukan sebagai data; LLM tanpa tool yang berefek samping; output schema-only |
| Berita palsu / manipulasi sentimen | Bobot kredibilitas sumber, konfirmasi ≥ 2 sumber independen atau konfirmasi pasar untuk severity tinggi, rate limit perubahan regime |
| Halusinasi / klasifikasi salah | Clamp ke band, fallback statis, logging `drivers` + `modelVersion`, evaluasi lewat backtest |
| Data basi | Setiap sinyal punya `expiresAt`, assessment punya `validUntil` |
| Divergensi oracle | Sumber non-protokol hanya untuk peringatan dini (I5) |
| Research agents terlalu yakin / berhalusinasi (ADR 0004) | Output hanya `Signal` dengan confidence ≤ 0.6; tidak bisa sendirian menaikkan regime ke `STRESSED`/`CRISIS`; agent tanpa tools |
| Peracunan pelajaran reflection (ADR 0005) | Lesson diperlakukan sebagai data tak tepercaya (≤ 600 karakter, maksimal 5 per run); lesson tidak pernah mengubah aturan, prompt, atau konfigurasi |
| Biaya LLM habis / refusal pada topik perang & exploit | Budget harian dengan hard stop; fallback model; jika gagal, jalur LLM berhenti dan modul deterministik tetap jalan (I6) |

### 2.4 Web app & API

| Ancaman | Mitigasi |
|---------|----------|
| SIWE replay / phishing | Nonce sekali pakai + kedaluwarsa; domain harus cocok |
| Session hijack | iron-session, `httpOnly`, `secure` di production, `sameSite=lax` |
| Webhook Telegram palsu | Header `x-telegram-bot-api-secret-token` |
| Pembajakan link Telegram | Kode sekali pakai + kedaluwarsa |

---

## 3. Temuan terbuka

| ID | Temuan | Lokasi | Prioritas |
|----|--------|--------|-----------|
| S1 | Validasi domain SIWE juga menerima header `host` / `x-forwarded-host` dari request. Di production sebaiknya hanya mencocokkan `NEXT_PUBLIC_APP_DOMAIN`. | `app/api/auth/verify/route.ts` | Medium |
| S2 | Kode link Telegram hanya 3 byte tanpa rate limit. Perpanjang (≥ 8 byte) dan batasi percobaan. | `app/api/telegram/link-code/route.ts` | Low–Medium |
| S3 | Proteksi `/dashboard` hanya di sisi client. Tambah pengecekan sesi di server/proxy saat dashboard mulai menampilkan data asli. | `hooks/useAuthGuard.ts` | Low (data saat ini simulasi) |
| S4 | Alert dipicu dari browser — bukan isu keamanan langsung, tapi melanggar ekspektasi monitoring 24/7. Pindahkan ke engine. | `lib/simulation-engine.tsx` | High (produk) |
| S5 | Kontrak belum diaudit. | `contracts/` | Gate sebelum mainnet |
| S6 | Aave V3 di Arbitrum One **tidak** memasang PriceOracleSentinel (diverifikasi 8 Okt 2026): tidak ada grace period setelah sequencer pulih. Engine wajib menaikkan regime saat sequencer down, dan keeper harus siap memanggil `protect` di blok pertama setelah pulih. | `engine/` (rencana) | High (desain) |

Perbarui tabel ini saat temuan diperbaiki atau ditemukan.

---

## 4. Checklist review keamanan

Untuk setiap PR yang menyentuh komponen di atas:

- [ ] Apakah ada jalur baru di mana token bisa berpindah? Ke mana tujuannya? (I1)
- [ ] Apakah ada role/admin/upgrade baru? (I2)
- [ ] Apakah output AI bisa memengaruhi sesuatu selain trigger dalam band? (I3)
- [ ] Jika komponen ini dikompromi, apa dampak terburuknya? (I4)
- [ ] Sumber harga apa yang dipakai untuk keputusan eksekusi? (I5)
- [ ] Apa yang terjadi jika komponen ini mati atau datanya basi? (I6)
- [ ] Bisakah user tetap menghentikan semuanya? (I7)
- [ ] Ada secret yang ikut ter-commit atau ter-bundle ke client? (I8)
- [ ] Input eksternal divalidasi dan diperlakukan sebagai data?

# Spec: Modul sinyal deterministik — Oracle Monitor, Depeg, Kalender Makro

- **Milestone:** M2 — "Oracle Monitor (staleness, deviasi, sequencer uptime)" dan "Macro calendar" ([PRD §10](../prd.md#10-roadmap-eksekusi))
- **Status:** Done (2026-10-09)
- **Pemilik:** Antigravity (implementasi), Claude Code (review)
- **Terkait:** [m2-risk-fusion-v1](m2-risk-fusion-v1.md) (aturan R-SEQUENCER-DOWN, R-DEPEG-CONFIRMED, R-ORACLE-DEVIATION, R-MACRO-SOON), [m3-carry-interest-monitoring](m3-carry-interest-monitoring.md) (pola emitter `src/signals/emit.ts`), [risk-transmission](../knowledge/risk-transmission.md)

> **Catatan Implementasi (2026-10-09, commit 1803000):**
> - Emitter deterministik diintegrasikan ke `src/signals/emit.ts` dengan stable dedupe keys (`${module}:${primaryPath}:${asset}:${type}`) agar skor tidak menumpuk berulang saat fusion tick 15 menit.
> - Guardrail fusion memastikan hanya modul terkonfirmasi (`ORACLE`, `ONCHAIN`, `MACRO`) yang dapat menaikkan regime ke `STRESSED`/`CRISIS`; modul `RESEARCH` tetap dibatasi cap severity 0.6 (unconfirmed).
> - Depeg LST/LRT (T5) dan LST yield sengaja tidak disertakan pada rilis ini (ditunda ke v2).

## 1. Tujuan

Fusion sudah punya aturan untuk sequencer down, depeg stablecoin, anomali oracle, dan event makro terjadwal, tetapi belum ada modul yang **memancarkan** sinyalnya. Datanya sudah dikumpulkan (`src/sources/onchain.ts`, `macro-calendar.ts`), tapi hanya dipakai sebagai konteks teks untuk LLM. Akibatnya fusion hanya bergantung pada riset AI (yang sengaja dibatasi) dan T11.

Spec ini mengubah data itu menjadi sinyal deterministik terkonfirmasi, sehingga ancaman nyata seperti sequencer mati atau USDC depeg langsung menaikkan regime **tanpa menunggu AI**.

## 2. Scope

**Termasuk:**
- Emitter `ORACLE`: sequencer uptime (T10), staleness & deviasi AaveOracle (T8).
- Emitter `ONCHAIN` depeg stablecoin (T4) dari harga AaveOracle.
- Emitter `MACRO`: event terjadwal FOMC/CPI/NFP (path sesuai kalender, biasanya T1/T2).
- Integrasi ke `emitDeterministicSignals` (dipanggil tiap fusion tick), test, dan tampilan di `tahansoe fuse`.

**Tidak termasuk:**
- Depeg LST/LRT (T5): butuh harga pasar sekunder; v2.
- Sumber harga CEX/DEX (hanya boleh sebagai peringatan dini, bukan eksekusi; I5) — v2.
- Perubahan aturan fusion atau threshold regime (kecuali yang disebut di §3.4).

## 3. Desain

Semua emitter: fungsi murni `compute*Signals(snapshot, now) → Signal[]` di `src/signals/` + pembacaan data di `src/sources/` yang sudah ada. Confidence deterministik 0,9 (bacaan on-chain) / 0,95 (kalender resmi). Evidence berbahasa Inggris, singkat, menyebut angka. TTL default 30 menit (fusion tick 15 menit). Gagal baca → log + lewati, tidak pernah melempar (I6).

### 3.1 Sequencer (module `ORACLE`, path `T10`)

Dari Chainlink Sequencer Uptime Feed (registry `sequencerUptimeFeed`):
- `answer == 1` (down) → severity 1,0.
- `answer == 0` tetapi `startedAt` < 1 jam lalu (masa tenggang setelah pulih; harga bisa melompat) → severity 0,7.
- Normal → tidak memancarkan sinyal.

### 3.2 Oracle staleness & deviasi (module `ORACLE`, path `T8`)

- **Staleness:** `updatedAt` feed Chainlink (ETH/USD, USDC/USD, USDT/USD) lebih tua dari heartbeat × 1,5 (heartbeat dari konfigurasi registry, default 24 jam untuk stablecoin, 1 jam untuk ETH) → severity 0,6–1,0 sebanding keterlambatan.
- **Deviasi:** harga AaveOracle vs feed Chainlink langsung untuk aset yang sama. ≥ 0,5% → 0,6; ≥ 1% → 0,8; ≥ 2% → 1,0. (Normalnya ~0; deviasi menandakan masalah konfigurasi oracle/adapter.) Catatan: USDC di AaveOracle Arbitrum memakai *capped feed* — deviasi ke atas $1 diabaikan untuk USDC.

### 3.3 Depeg stablecoin (module `ONCHAIN`, path `T4`)

Harga AaveOracle untuk USDC, USDC.e, USDT, DAI, GHO (alamat dari registry/`getReservesList`):
- Deviasi < 1% dari $1 → tidak ada sinyal (fluktuasi normal; aturan fusion langsung STRESSED untuk sinyal T4 apa pun).
- 1% → severity 0,5; naik linear sampai 1,0 pada 5%. Severity ≥ 0,9 (≈ 4,6%) → CRISIS lewat `DEPEG_CRISIS_SEVERITY`.
- Hanya deviasi ke bawah untuk aset dengan capped feed.

### 3.4 Kalender makro (module `MACRO`)

Dari `fetchMacroCalendarEvents` (FOMC JSON resmi + BLS CPI/NFP): untuk setiap event dalam 48 jam ke depan, pancarkan satu sinyal dengan horizon = waktu ke event, severity FOMC 0,6, CPI 0,5, NFP 0,4; path T1+T2. `expiresAt` = waktu event + 6 jam (volatilitas pasca-rilis). Pastikan field yang dibaca `macroHorizon()` di `src/fusion/regime.ts` terisi sehingga R-MACRO-SOON (≤ 18 jam → ELEVATED) bekerja. Tidak ada perubahan threshold.

### 3.5 Tampilan

`tahansoe fuse` menampilkan daftar sinyal deterministik aktif per modul (mis. "ORACLE T10 sequencer UP", "MACRO FOMC in 14h"). Dashboard `schedule run` menampilkan jumlah sinyal per modul.

## 4. Dampak keamanan

- I1/I2: hanya baca on-chain & kalender publik; tulis tabel `signals`. Tanpa transaksi.
- I5: semua harga dari AaveOracle/Chainlink (oracle protokol target); tidak ada sumber eksekusi lain.
- I6: kegagalan sumber → tidak ada sinyal (bukan sinyal palsu); proteksi jatuh ke policy statis/aturan lain.
- Sinyal ini **terkonfirmasi** (bukan opini AI), jadi boleh menaikkan regime ke STRESSED/CRISIS sesuai aturan fusion yang sudah disetujui.

## 5. Kriteria penerimaan

- [x] Fungsi murni untuk keempat emitter dengan unit test ambang (termasuk batas 1% depeg, capped USDC, masa tenggang sequencer).
- [x] Replay: sequencer down → STRESSED; USDC 0,95 → CRISIS; USDC 0,995 → tidak ada sinyal; FOMC dalam 12 jam → ELEVATED; kondisi normal → tidak ada sinyal ORACLE/T4.
- [x] Live satu fusion tick di research-dev: sinyal tersimpan dengan benar, `tahansoe fuse` menampilkannya.
- [x] Typecheck 0 error, semua test hijau.

## 6. Rencana test

Unit (fungsi murni), replay fusion (skenario §5), satu run live terhadap Arbitrum One.

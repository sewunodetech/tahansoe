# Spec: Protection Strategy Agent

- **Milestone:** M4 "Risk band + risk agent per user", dengan ketergantungan pada M2 "Framework backtest + skenario historis §6.4" dan M3 "Kalibrasi regime → buffer via backtest" + "Reflection loop" ([PRD §10](../prd.md#10-roadmap-eksekusi))
- **Status:** In progress (Fase A)
- **Pemilik:** Tim Engine + Tim Kontrak + Tim Web
- **Terkait:** [ADR 0016](../decisions/0016-bounded-protection-agent.md), [ADR 0017](../decisions/0017-erc8004-agent-identity.md), [ADR 0002](../decisions/0002-ai-advises-rules-decide.md), [ADR 0005](../decisions/0005-reflection-loop.md), [ADR 0013](../decisions/0013-success-fee-on-protection.md), [ADR 0015](../decisions/0015-guardian-v4-per-position-policies.md), PRD §6.4

## 1. Tujuan

Sekarang proteksi bereaksi saat HF menyentuh trigger, dengan urutan layer yang selalu sama. Protection Agent memadukan **riset off-chain** (regime, berita, makro, sentimen dari Core Risk Engine) dengan **posisi on-chain user** (HF, komposisi kolateral/utang, cadangan L1/L2, likuiditas swap). Dari situ agent memilih aksi proteksi terbaik untuk posisi itu: layer mana, berapa, dan kapan, termasuk bertindak preemptif sebelum trigger. Semuanya hanya di dalam mandat yang ditandatangani user. Agent terus belajar dari hasilnya sendiri dan dari playbook wallet yang selamat dari crash historis. Setiap versi strategi wajib lolos backtest dulu. Identitas dan rekam jejak agent publik lewat ERC-8004, sehingga user bisa memverifikasi sebelum memberi mandat.

## 2. Scope

**Termasuk:**
- `ProtectionPlan` (schema output agent) dan validator rule engine.
- Strategy library berversi (`strategyVersion`) dengan playbook proteksi.
- Penambang playbook dari data on-chain historis: wallet Aave V3 Arbitrum yang HF-nya turun < 1.15 lalu selamat vs yang terlikuidasi.
- Framework backtest proteksi: replay skenario PRD §6.4 + periode tenang, membandingkan statis vs dynamic trigger (ADR 0002) vs Protection Agent.
- Fase A: mode shadow + `setDynamicTrigger` sebagai satu-satunya efek on-chain.
- Fase B: Guardian v5 dengan mandat per posisi + `agentProtect`, deploy Sepolia, audit sebelum mainnet.
- Registrasi agent di ERC-8004 Identity Registry + feedback ke Reputation Registry dari settlement.
- UI: kartu agent (identitas, reputasi, scorecard), alur pemberian dan pencabutan mandat, log keputusan agent per posisi.

**Tidak termasuk:**
- Copy trade, meniru posisi/arah/leverage pihak lain, sinyal trading, optimasi yield (PRD §11).
- Agent membuka posisi, menambah utang, atau memindahkan dana ke luar posisi user.
- Agent pihak ketiga (marketplace agent). v1 hanya agent Tahansoe, meski tetap lewat ERC-8004.
- Validation Registry ERC-8004 (menunggu mainnet).
- Morpho L3 (mengikuti ADR 0015, ditunda ke v4.1).

## 3. Desain

### 3.1 Alur per tick

```
Core Risk Engine (RiskAssessment, regime, sinyal)  ─┐
Posisi on-chain (HF, utang/kolateral per aset,      ├─► Protection Agent ─► ProtectionPlan
  cadangan L1/L2, likuiditas swap, mandat)          ─┘        │
Strategy library (strategyVersion, playbook) ────────────────┘
                                                              ▼
                               Rule engine: validasi plan vs mandat, umur data, batas
                                                              ▼
                                       Intent (dry-run / shadow / execute)
                                                              ▼
                     Keeper → Guardian v5 agentProtect / setDynamicTrigger (menegakkan ulang)
                                                              ▼
                          Settlement → scorecard → lessons → feedback ERC-8004
```

### 3.2 `ProtectionPlan` (output agent, divalidasi schema)

```ts
interface ProtectionPlan {
  positionKey: string;               // aave-v3:<chainId>:<guardian>:<debtAsset>
  strategyVersion: string;           // mis. "pp-2026.11.1"
  action: "HOLD" | "SHIFT_TRIGGER" | "REPAY_WALLET" | "REPAY_VAULT" | "DELEVERAGE";
  amount?: string;                   // unit token utang (bigint string), wajib untuk aksi repay/deleverage
  triggerHf?: number;                // untuk SHIFT_TRIGGER
  expectedHfAfter: number;
  urgency: "LOW" | "MEDIUM" | "HIGH";
  drivers: string[];                 // id sinyal/assessment yang dipakai (bukan teks bebas dari sumber)
  playbookIds: string[];             // playbook yang dirujuk
  validUntil: string;                // ISO; kedaluwarsa → diabaikan
}
```

Prompt dan deskripsi schema ditulis dalam bahasa Inggris (AGENTS.md). Komponen LLM hanya mengusulkan; pemilihan jumlah final dihitung deterministik dari HF target dan cap.

### 3.3 Rule engine (deterministik)

Plan ditolak bila: aksi tidak ada di mandat; `amount` > cap mandat per aksi atau sisa cap 24 jam; HF > `maxPreemptHF`; assessment/sinyal basi; regime `CALM` dan aksi bukan `HOLD`/`SHIFT_TRIGGER` (kecuali HF < trigger statis); `expectedHfAfter` ≤ HF sekarang. Hasilnya `Intent` dengan `strategyVersion` dan `planHash`.

### 3.4 Strategy library dan pembelajaran

- `apps/engine/src/strategy/`: `playbooks.ts` (tipe + loader), `miner.ts` (penambang data on-chain), `select.ts` (pemilihan aksi), `versions.ts`.
- **Playbook** = aturan proteksi yang bisa diuji, misalnya "regime STRESSED + kolateral volatil + HF < 1.35 → repay sampai HF 1.6 dari L1 dulu". Setiap playbook punya metrik backtest.
- **Miner:** baca event Aave V3 Arbitrum One (`Repay`, `Withdraw`, `LiquidationCall`, `Supply`) dari arsip RPC untuk jendela crash di katalog `docs/knowledge/`. Kelompokkan wallet yang HF-nya < 1.15: selamat vs terlikuidasi. Ekstrak fitur aksi: jeda sebelum drawdown utama, buffer HF yang dicapai, sumber dana. Hasilnya **statistik agregat**, bukan daftar wallet untuk diikuti.
- Lesson (ADR 0005) dan playbook adalah data. Strategi baru naik versi hanya lewat PR manusia setelah backtest lulus.

### 3.5 Backtest proteksi

- `apps/engine/src/backtest/protection-replay.ts`: replay harga oracle Aave historis + snapshot posisi sintetis. Bandingkan tiga kebijakan: statis, dynamic trigger, Protection Agent.
- Metrik (PRD §12): likuidasi tercegah, biaya repay/deleverage tak perlu, false positive pada periode tenang, lead time.
- Simnet (ADR 0014) dipakai untuk uji eksekusi end-to-end strategi di fork.
- Gate rilis: strategi baru wajib ≥ strategi aktif pada likuidasi tercegah **dan** tidak lebih buruk > 10% pada biaya/false positive.
- Implementasi harness (apps/engine/src/backtest/):
  - Fixture tersimpan di fixtures/ mencakup 7 jendela crash PRD §6.4 (Maret 2020, Mei 2022, Juni 2022, November 2022, Maret 2023, Agustus 2024, Oktober 2025) + 1 periode tenang (Juli 2024).
  - DeciderRegistry memuat static (Guardian v4 protect) dan dynamic (dynamic trigger ADR 0002), dapat didaftarkan decider baru.
  - Helper passesReleaseGate(candidate, active) mengevaluasi syarat rilis secara deterministik.
  - CLI tahansoe backtest protection [--scenario id] [--json] menjalankan evaluasi dan mencetak tabel perbandingan serta status release gate.
- Hasil pertama (25 Okt 2026, dynamic vs static): likuidasi tercegah sama (23 vs 23), biaya dynamic +16,2% sehingga gate **gagal**. Batasan yang ikut dicetak di setiap laporan:
  - Harga dari Binance ETHUSDT, posisi sintetis. Static sudah mencegah semua likuidasi di set posisi default, jadi set ini belum membedakan strategi; perlu posisi yang lebih rapuh (HF awal lebih rendah, cadangan lebih kecil, kolateral lebih volatil).
  - Seri regime dilabeli manual dengan hindsight. Lead time dan decider yang memakai regime terlalu optimistis; promosi strategi wajib juga lulus dengan regime hasil replay engine sendiri.
- Agent (seed `pp-2026.10.0`) vs static, 25 Okt 2026: likuidasi tercegah sama (23 vs 23), biaya +8,6% (gate lolos tipis di bawah ambang 10%), lead time 31,6 jam vs 25,6 jam dengan label hindsight. Kesimpulan: belum ada bukti nilai tambah agent; set posisi perlu dibuat lebih rapuh sebelum gate punya arti.

### 3.6 Guardian v5 (Fase B)

- Kontrak `TahansoeGuardianAaveV5` (mewarisi pola v4 + `GuardianCore`):
  - `grantMandate(debtAsset, agent, agentId, actionMask, maxPerAction, maxPer24h, maxPreemptHF, validUntil)`, `revokeMandate(debtAsset)`, `mandateOf(user, debtAsset)`.
  - `agentProtect(user, debtAsset, layer, amount)`: hanya `msg.sender == mandate.agent`, layer ∈ mask, HF ≤ `maxPreemptHF`, jumlah ≤ cap, HF wajib naik, cap 24 jam bergulir.
  - Event: `MandateGranted`, `MandateRevoked`, `AgentActed(user, debtAsset, agentId, layer, amount, hfBefore, hfAfter, planHash)`.
  - Event yang hilang di v4 ditambahkan: `Layer2Set`, `Layer3Set`, `TriggerBandSet` (lihat Gap di status.md).
- Fee: tetap `isFeeEligible(hfBefore, staticTrigger)` (ADR 0013), jadi aksi preemptif tidak dikenai fee.
- Test: unit, fuzz (cap tidak pernah terlampaui), invariant (saldo Guardian 0, agent tanpa mandat tidak bisa bertindak, mandat dicabut → revert), fork Arbitrum.

### 3.7 ERC-8004

- Registry di chain registry: `erc8004: { identity, reputation }` per chain (alamat di ADR 0017).
- Script registrasi agent (`contracts/script/RegisterAgent.s.sol` atau CLI engine) + file registrasi di `apps/web/public/.well-known/agent-registration.json`.
- `apps/engine/src/strategy/reputation.ts`: setelah settlement, tulis `giveFeedback` dari alamat settlement (bukan pemilik/operator agent).

### 3.8 DB

- `protection_plans` (id, position_key, strategy_version, action, amount, expected_hf_after, plan_hash, drivers jsonb, decision `ACCEPTED|REJECTED`, reject_reason, created_at).
- `strategy_versions` (version, playbook jsonb, backtest_report jsonb, status `CANDIDATE|ACTIVE|RETIRED`, approved_by, created_at).
- `mandates` (mirror event v5: user_id, position_key, agent, agent_id, action_mask, caps, max_preempt_hf, valid_until, is_active).
- Migrasi idempotent di `packages/db/src/migrate.ts`.

### 3.9 Web

- Kartu agent di halaman Protection: `agentId`, pemilik, versi strategi, reputasi (hanya feedback dari alamat yang pernah dilindungi), link scorecard.
- Dialog mandat per posisi: pilih aksi (DELEVERAGE mati default + peringatan), cap, HF preemptif maksimum, masa berlaku; ringkasan dampak terburuk dalam bahasa sederhana.
- Log keputusan agent per posisi: plan, alasan, hasil.

## 4. Dampak keamanan

- **Jalur token baru (I1)?** `agentProtect` memakai jalur dana yang sama dengan `protect` v4: dana hanya dari wallet/vault/aToken/kolateral user ke utang user sendiri. Fee hanya ke treasury dengan aturan ADR 0013.
- **Role/admin/upgrade baru (I2)?** Tidak ada admin. Mandat diberikan dan dicabut oleh user. Kepemilikan NFT ERC-8004 di multisig tim, tanpa kuasa atas Guardian.
- **Output AI memengaruhi selain trigger dalam band (I3)?** Ya, untuk user yang memberi mandat (ADR 0016): AI memilih aksi di dalam mask dan cap mandat. Kontrak menegakkan semua batas.
- **Dampak terburuk bila dikompromi (I4)?** Kunci agent bocor: utang dibayar lebih awal sampai cap per aksi/24 jam dari cadangan yang user izinkan; bila `DELEVERAGE` diizinkan, kolateral dijual sampai cap dengan batas slippage. Tidak ada dana yang keluar dari posisi user.
- **Sumber harga untuk eksekusi (I5)?** Oracle Aave (HF dari `getUserAccountData`, harga dari `AaveOracle`). Data riset hanya memengaruhi *keputusan*, tidak pernah harga eksekusi.
- **Komponen mati / data basi (I6)?** Plan kedaluwarsa (`validUntil`) atau mandat kedaluwarsa → tidak ada aksi agent; `protect` statis tetap berjalan.
- **User bisa menghentikan (I7)?** `revokeMandate` atau `disablePolicy`, satu transaksi masing-masing.
- **Secret (I8)?** Kunci agent hanya di keystore keeper/env server; tidak ada di client.
- **Input eksternal sebagai data?** Berita/sosial/web tetap data; playbook dari miner berupa statistik agregat; LLM tanpa tool berefek samping; output schema-only.

## 5. Kriteria penerimaan

- [x] ADR 0016 dan 0017 Accepted oleh owner (25 Okt 2026).
- [x] `ProtectionPlan` + validator rule engine dengan test penolakan untuk setiap aturan §3.3.
- [ ] Miner menghasilkan playbook dari minimal 3 jendela crash historis di Arbitrum One, dengan laporan selamat vs terlikuidasi. (Pipeline + test di atas fixture sintetis selesai; run nyata menunggu arsip RPC.)
- [ ] Backtest proteksi melaporkan statis vs dynamic vs agent untuk skenario §6.4 + periode tenang; strategi aktif pertama lolos gate §3.5. (Harness + laporan selesai; gate belum bermakna, lihat §3.5.)
- [ ] Fase A: mode shadow berjalan di Sepolia, plan tercatat di `protection_plans`, `setDynamicTrigger` hanya dalam band. (Kode shadow di sentinel selesai; belum di-deploy ke engine VPS.)
- [ ] Agent terdaftar di ERC-8004 Identity Registry Arbitrum Sepolia; file registrasi dapat diakses; feedback settlement tertulis ke Reputation Registry. (Calldata + kartu agent selesai; registrasi on-chain menunggu URL web publik.)
- [ ] Fase B: Guardian v5 dengan unit/fuzz/invariant/fork test hijau; deploy + verify Sepolia; UI mandat + log keputusan.
- [ ] security.md, PRD, architecture.md diperbarui.

## 6. Rencana test

- Unit: schema `ProtectionPlan`, validator rule engine, pemilihan aksi deterministik, kalkulasi cap 24 jam.
- Backtest: replay skenario §6.4 + periode tenang; laporan perbandingan disimpan di `strategy_versions.backtest_report`.
- Kontrak: unit + fuzz (cap, maxPreemptHF), invariant (saldo Guardian 0, agent tanpa mandat selalu revert, HF selalu naik), fork Arbitrum One.
- Simnet: crash scenario dengan agent aktif vs statis, hasil ditampilkan di Simulation Mode.
- Manual: beri dan cabut mandat di Sepolia; pastikan aksi agent setelah dicabut revert.

## 7. Keputusan atas pertanyaan terbuka (owner, 25 Okt 2026)

- Default mandat: `maxPreemptHF = trigger statis + 0.25`; cap per aksi = `maxRepayPerAction` policy; cap 24 jam = 3 × cap per aksi.
- v1 hanya agent Tahansoe; agent pihak ketiga setelah audit dan Validation Registry tersedia.
- Miner memakai arsip RPC tier gratis (Alchemy/Infura) lebih dulu.
- Aksi preemptif yang ternyata tidak perlu otomatis menjadi feedback `false-positive` dari settlement.

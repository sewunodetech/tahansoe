# Spec: Research agents (multi-agent) & reflection loop

- **Milestone:** M3 — Intelligence (lihat [PRD §10](../prd.md#10-roadmap-eksekusi)); settlement untuk fusion deterministik bisa dimulai di M2
- **Status:** Draft
- **Pemilik:** Tim engine
- **Terkait:** PRD §6.2–§6.6, §12; [ADR 0002](../decisions/0002-ai-advises-rules-decide.md), [ADR 0004](../decisions/0004-multi-agent-research-layer.md), [ADR 0005](../decisions/0005-reflection-loop.md); [knowledge/risk-transmission.md](../knowledge/risk-transmission.md)

## 1. Tujuan

Modul sinyal mendeteksi kejadian satu per satu. Research agents menalar **kombinasi** konteks (geopolitik, makro, pasar, on-chain) dan menjelaskannya dalam bahasa manusia, sehingga buffer bisa naik lebih awal pada event berperingatan dan user tahu alasannya. Reflection loop mengukur apakah penilaian itu benar, lalu memakai hasilnya untuk memperbaiki konteks dan, lewat review manusia, aturan.

Untuk siapa: borrower retail yang tidak memantau berita 24/7 (BRD §3), dan tim, yang butuh bukti terukur sebelum mengklaim "AI mencegah likuidasi" (BRD §9).

## 2. Scope

**Termasuk:**
- Orkestrasi: 4 analyst paralel → debat Hawk ⇄ Dove → Risk Assessor → `ResearchReport` → `Signal` (`module: "RESEARCH"`)
- Interface LLM provider-agnostic + implementasi Anthropic
- Settlement (TP/FP/MISSED/TN) untuk `RiskAssessment` dan `ResearchReport`
- Reflection (batch harian) → `research_lessons`
- Scorecard mingguan, set eval, shadow mode
- Tabel DB baru dan konfigurasi env

**Tidak termasuk:**
- Modul sinyal itu sendiri (Oracle Monitor, Technical, Macro, News ingestion). Itu bagian spec M2/M3 masing-masing; spec ini hanya mengonsumsi outputnya
- Perubahan fusion v1 selain menerima `module: "RESEARCH"`
- Guardian v2 / `setDynamicTrigger` (M4)
- Social sentiment (M3, spec terpisah)
- Auto-tuning aturan dari hasil reflection (ditolak di ADR 0005)
- Billing / pembayaran Pro (spec terpisah); spec ini hanya mendefinisikan pembagian fitur (§3.11)

## 3. Desain

### 3.1 File

```
engine/src/
  llm/
    provider.ts           interface LlmProvider { structured<T>(req): Promise<LlmResult<T>> }
    anthropic.ts          implementasi @anthropic-ai/sdk (messages.parse + zodOutputFormat)
    budget.ts             akumulasi biaya harian dari usage; hard stop di LLM_DAILY_BUDGET_USD
    prompts/              system prompt per peran (*.md), diberi PROMPT_VERSION
  agents/
    schemas.ts            zod: AnalystReport, DebateTurn, ResearchReport
    context.ts            rakit input dari DB (signals aktif, market_events 24j, kalender, regime kini, lessons)
    analysts.ts           geopolitics | macro | market | onchain
    debate.ts             hawk ⇄ dove, N ronde
    assessor.ts           → ResearchReport
    run.ts                runResearch(trigger) — orkestrasi satu run
    to-signal.ts          ResearchReport → Signal (module RESEARCH), cap confidence
  reflection/
    outcomes.ts           hitung outcome aktual per aset dalam horizon (dari harga oracle & sinyal tersimpan)
    settle.ts             label TP/FP/MISSED/TN + lead time
    reflect.ts            batch reflection → lessons
    lessons.ts            pilih ≤ 5 lesson relevan untuk run berikutnya
    scorecard.ts          agregasi mingguan/bulanan per modelVersion/promptVersion
  backtest/
    research-replay.ts    replay ResearchReport historis (cache per promptVersion)
engine/test/
  agents/*.test.ts, reflection/*.test.ts
  eval/
    news-labeled/         ≥ 100 artikel berlabel
    injection/            ≥ 30 artikel berbahaya
    scenarios/            ≥ 20 snapshot konteks + regime yang disepakati
```

### 3.2 Alur satu run

```ts
export async function runResearch(trigger: "SCHEDULED" | "ESCALATION"): Promise<ResearchReport | null> {
  if (await killSwitchOn() || (await budget.exceeded())) return null;
  const ctx = await buildContext();                       // semua dari DB; tanpa fetch oleh LLM
  const settled = await Promise.allSettled(ANALYSTS.map((a) => runAnalyst(a, ctx)));
  const reports = settled.flatMap((r) => (r.status === "fulfilled" && r.value ? [r.value] : []));
  if (reports.length < 3) return null;                     // terlalu banyak gagal → jangan menilai
  const debate = await runDebate(reports, { rounds: config.debateRounds });
  const lessons = await selectLessons(reports);
  const report = await runAssessor({ ctx, reports, debate, lessons });
  if (!report) return null;
  await saveReport({ trigger, report, reports, debate });
  await emitSignal(toSignal(report));                      // fusion yang memutuskan
  return report;
}
```

Jadwal: tiap 2 jam saat `CALM`, tiap 1 jam saat `ELEVATED` ke atas, plus satu run `ESCALATION` saat fusion menaikkan regime (cooldown 30 menit).

### 3.3 Skema output (ringkas)

```ts
const ResearchReport = z.object({
  assets: z.array(z.string()).min(1),
  proposedRegime: z.enum(["CALM", "ELEVATED", "STRESSED", "CRISIS"]),
  direction: z.enum(["DOWN", "UP", "VOLATILITY"]),
  paths: z.array(z.object({
    path: TransmissionPath,                 // T1..T10, lihat knowledge/risk-transmission.md
    severity: z.number().min(0).max(1),
    rationale: z.string().max(400),
  })).max(10),
  keyDevelopments: z.array(z.object({ summary: z.string().max(300), evidence: z.array(Evidence) })).max(8),
  hawkCase: z.string().max(800),
  doveCase: z.string().max(800),
  confidence: z.number().min(0).max(1),
  horizonHours: z.number().int().min(1).max(72),
});
```

`toSignal()` mengubah report menjadi `Signal` PRD §6.3: `module: "RESEARCH"`, `severity = max(paths.severity)`, `confidence = min(report.confidence, 0.6)`, `expiresAt = createdAt + horizonHours`, `evidence` dari `keyDevelopments`. `proposedRegime` disimpan untuk settlement, tetapi **tidak** dipakai fusion secara langsung.

### 3.4 Aturan LLM

**Prinsip pemilihan model: termurah yang lolos eval.** Selama fase R&D, setiap peran dimulai dari tier termurah. Sebuah peran naik ke tier berikutnya **hanya** jika set eval-nya (§6) gagal mencapai ambang, dan kenaikan itu dicatat di PR beserta hasil eval-nya. Model per peran disimpan di konfigurasi, bukan di-hardcode.

| Peran | Effort | Mulai dari (R&D) | Naik ke (jika eval gagal) |
|-------|--------|------------------|---------------------------|
| Analyst (×4) | `low` | `gemini:gemini-flash-latest` / model murah | `claude-haiku-5-5` → `claude-sonnet-5-5` |
| Hawk / Dove | `medium` | `gemini:gemini-flash-latest` / model murah | `claude-haiku-5-5` → `claude-sonnet-5-5` |
| Risk Assessor | `high` | `gemini:gemini-flash-latest` / model murah | `claude-haiku-5-5` → `claude-sonnet-5-5` |
| Reflector (Batch API) | `medium` | `gemini:gemini-flash-latest` / model murah | `claude-haiku-5-5` |

Ambang eval awal untuk naik tier: akurasi `path`/`severity` < 80% pada `news-labeled`, ada kegagalan pada `injection`, atau < 70% kesesuaian regime pada `scenarios`.

- **Satu pintu gateway LLM & pemilihan model per peran ([ADR 0009](../decisions/0009-single-openai-compatible-gateway.md), men-supersede sebagian [ADR 0008](../decisions/0008-multi-provider-llm.md)):** Engine mengakses LLM hanya lewat satu gateway OpenAI-compatible. Environment hanya memerlukan dua secret: `LLM_API_URL` dan `LLM_API_KEY`. Konfigurasi model per peran (`analyst`, `debate`, `assessor`, `reflector`) disimpan di `settings.json` v2 (non-rahasia, di-gitignore) berupa daftar nama model murni (*plain model names* tanpa awalan provider) yang berurutan sebagai fallback berantai jika model pertama gagal (mis. `["agnes-2.5-flash", "deepseek-v4-flash"]`).
- **Structured output & schema repair retry:** Schema JSON di-embed langsung ke dalam system prompt (dengan instruksi inline dan deskripsi field). Output model diekstrak secara toleran terhadap blok kode markdown / teks pengantar, lalu divalidasi dengan schema zod. Jika validasi schema gagal, dilakukan tepat satu kali *repair retry* dengan menyertakan pesan error validasi dan pengingat schema; jika tetap gagal, eksekusi fallback ke model berikutnya dalam daftar peran.
- **Estimasi biaya & integrasi harga dinamis:** Budget harian dan biaya per run dihitung berdasarkan harga gateway dengan prioritas: `settings.modelPrices` (override manual) > `pricingUrl` (Bynara `/api/pricing` atau OpenRouter) > fallback harga konservatif default. Tooling CLI `tahansoe models` dan `tahansoe settings` disediakan untuk inspeksi harga dan konfigurasi peran.
- **Bahasa prompt: Inggris** (keputusan tim, 8 Okt 2026). Semua system prompt, instruksi inline, dan deskripsi field schema ditulis dalam bahasa Inggris. Field teks hasil LLM (summary, rationale, hawkCase/doveCase, lesson) juga berbahasa Inggris. Lokalisasi ke bahasa user dilakukan di lapisan notifikasi/UI, bukan lewat prompt.
- Cek `stop_reason` sebelum membaca hasil. Topik perang, serangan, dan exploit bisa memicu `refusal`; jika tetap refusal → analyst dianggap gagal untuk run itu.
- Konten eksternal dibungkus sebagai data di akhir prompt; system prompt statis di depan (prompt caching).
- Budget harian: `budget.exceeded()` → lapis riset berhenti sampai besok, tim mendapat alert, modul sinyal & fusion tetap jalan.

Estimasi biaya referensi (harga per 1 juta token, Okt 2026: Haiku 5.5 $0.10/$0.50; Sonnet 5.5 $2/$10; Opus 5.5 $4/$20. Asumsi ~12–18 run/hari):

| Komponen | Semua Haiku 5.5 / Model Murah | Semua Sonnet 5.5 | Semua Opus 5.5 (batas atas) |
|----------|-------------------------------|------------------|-----------------------------|
| Research run | **~$5–15/bulan** | ~$250–300/bulan | ~$500–600/bulan |
| Reflection (batch, diskon 50%) | ~$1–2/bulan | ~$30/bulan | ~$60/bulan |

Klasifikasi berita per artikel (PRD §6.2) dihitung terpisah di spec news ingestion. Angka di atas adalah asumsi dan diukur ulang dari `usage` setelah shadow mode.

### 3.5 Settlement

Outcome buruk dalam horizon (nilai awal, di `engine/src/reflection/config.ts`):

| Jalur | Outcome buruk |
|-------|---------------|
| T1 harga | Drawdown harga AaveOracle ≥ 10% dari puncak |
| T2 volatilitas | Realized vol 24j > persentil 95 |
| T3 leverage | Volume likuidasi 1j > 10× median 30 hari |
| T4/T5 depeg | Stablecoin < 0.99, atau diskon LST > 1.5% |
| T6 gas | Base fee > 20× median 7 hari selama ≥ 15 menit |
| T7 likuiditas | Utilization reserve > 98% selama ≥ 30 menit |
| T9/T10 | Insiden protokol terkonfirmasi / sequencer down |

| Label | Kondisi |
|-------|---------|
| `TRUE_POSITIVE` | Regime/proposal ≥ `STRESSED` dan ada outcome buruk dalam horizon |
| `FALSE_POSITIVE` | Regime/proposal ≥ `STRESSED` tanpa outcome buruk |
| `MISSED` | Ada outcome buruk, tetapi regime < `STRESSED` selama 6 jam sebelumnya |
| `TRUE_NEGATIVE` | Regime < `STRESSED` tanpa outcome buruk (disampel) |

Lead time = waktu dari regime pertama kali ≥ `STRESSED` sampai titik terburuk outcome.

### 3.6 Scorecard & review

| Metrik | Target awal |
|--------|-------------|
| Recall event = TP / (TP + MISSED) | ≥ 70% |
| Presisi ≥ STRESSED = TP / (TP + FP) | ≥ 50% (3 bulan pertama) |
| Lead time median (TP, event berperingatan) | ≥ 6 jam |
| Waktu di regime ≥ STRESSED | < 10% |
| Output LLM lolos schema | ≥ 98% |

Recall sengaja diutamakan di atas presisi, dengan batas waktu di STRESSED < 10% agar user tidak kehilangan kepercayaan.

Review mingguan (30 menit): scorecard → 3 FP termahal + semua MISSED → kurasi lesson → keputusan PR (ambang/prompt/model) → backtest & eval sebelum merge. Ringkasan keputusan dicatat di PR terkait dan `status.md`.

### 3.7 Shadow mode bertahap

| Tahap | Dampak | Minimum | Syarat lanjut |
|-------|--------|---------|---------------|
| Shadow | Hanya terlihat oleh tim | 2 minggu | ≥ 80% perubahan regime dinilai masuk akal oleh tim |
| Notify | Notifikasi Telegram ke user | 4 minggu | Scorecard memenuhi target awal |
| Dry-run rekomendasi | Rekomendasi trigger di dashboard (ADR 0002 §5) | 4 minggu | Presisi ≥ 50% |
| Dynamic trigger | Lewat Guardian v2 (M4) | — | Audit kontrak |

### 3.8 Perubahan DB

Tabel aktual di `packages/db/src/research.ts` (menggunakan Drizzle ORM):

| Tabel | Kolom utama | Keterangan |
|-------|-------------|------------|
| `research_reports` | `id`, `chain_id`, `trigger`, `report` (jsonb), `analyst_reports` (jsonb), `debate` (jsonb), `prompt_version`, `models` (jsonb), `usage` (jsonb), `diagnostics` (jsonb), `horizon_ends_at`, `created_at` | Output lengkap research agents per run. Kolom `diagnostics` menyimpan status per peran, model, token, dan durasi untuk audit G7. |
| `signals` | `id`, `chain_id`, `module`, `paths` (jsonb), `assets` (jsonb), `direction`, `severity`, `confidence`, `horizon_hours`, `observed_at`, `expires_at`, `evidence` (jsonb), `created_at` | Sinyal risiko; `module` bernilai `RESEARCH` dengan batas confidence $\le 0.6$. |
| `risk_settlements` | `id`, `chain_id`, `risk_assessment_id?`, `research_report_id?`, `label`, `lead_time_minutes`, `outcome` (jsonb), `model_version`, `settled_at` | Evaluasi prediksi vs hasil riil (`TRUE_POSITIVE`, `FALSE_POSITIVE`, `MISSED`, `TRUE_NEGATIVE`). |
| `research_lessons` | `id`, `settlement_id`, `paths` (jsonb), `lesson` (≤ 600 char), `active`, `created_at` | Pelajaran terkurasi dari settlement untuk perbaikan prompt Assessor. |

Semua tabel menyertakan `chain_id` untuk data on-chain (architecture §5).

### 3.9 Environment & konfigurasi (ADR 0009)

Semua variabel environment bersifat server-only (tanpa prefix `NEXT_PUBLIC_`) dan **hanya menyimpan rahasia (secret) serta sakelar operasional**. Konfigurasi model per peran dan harga disimpan di `settings.json` v2 (non-rahasia):

- **Database:** `DATABASE_URL` (koneksi Neon Postgres).
- **LLM Gateway OpenAI-Compatible Tunggal (ADR 0009):** `LLM_API_URL` (URL endpoint gateway, dinormalisasi otomatis sampai `/v1`) dan `LLM_API_KEY` (secret gateway). Kunci lama per-provider (`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, dll.) tidak lagi digunakan; alias usang `LLM_BASE_URL` tetap dibaca dengan peringatan selama satu rilis.
- **Kontrol & Keamanan:** `LLM_DAILY_BUDGET_USD` (batas budget harian; jika terlampaui, riset dihentikan sampai hari berikutnya), `RESEARCH_ENABLED` (kill switch lapis riset, default `false`).
- **Sumber Data Eksternal:** `FRED_API_KEY` (data makro FRED, key gratis), `RESEARCH_GDELT_ENABLED` (default `false`), `ARBITRUM_RPC_URL` (RPC Arbitrum One).

**Konfigurasi non-rahasia (`settings.json` v2, dikelola via `tahansoe settings`):**
- `roles`: model per peran (`analyst`, `debate`, `assessor`, `reflector`) berupa nama model polos dengan daftar fallback berantai.
- `pricingUrl`: URL daftar harga remote (format Bynara `/api/pricing` atau OpenRouter `/api/v1/models`).
- `modelPrices`: override manual harga token per model (`inputPerM`, `outputPerM`).
- `estimate`: asumsi estimasi biaya (mis. `runsPerDay: 12`).

### 3.10 Sumber data

Keputusan tim (8 Okt 2026): fundamental, berita, dan makro memakai jenis sumber yang sama dengan [TradingAgents](https://github.com/TauricResearch/TradingAgents); teknikal diambil langsung dari on-chain. **Prinsip pemilihan: gratis (atau free tier yang cukup) dan kredibel.** Sumber berbayar atau tidak resmi tidak dipakai.

| Kebutuhan | Sumber | Biaya | Kredibilitas | Status |
|-----------|--------|-------|--------------|--------|
| Harga & volatilitas (teknikal) | **On-chain:** `AaveOracle` + proxy Chainlink di Arbitrum | Gratis | Tertinggi — sama dengan oracle eksekusi (I5) | Wave aktif |
| Status jaringan | **On-chain:** Sequencer Uptime Feed, `eth_feeHistory` | Gratis | Tertinggi | Wave aktif |
| Makro (suku bunga, CPI, kurva yield) | FRED API | Gratis (API key gratis) | Data resmi | Wave aktif |
| Berita geopolitik, makro & crypto (**utama**) | RSS langsung dari outlet kredibel: BBC World, Al Jazeera, The Guardian World, CNBC Economy, Federal Reserve (siaran pers), CoinDesk, The Block | Gratis, tanpa key, tanpa rate limit ketat | Tinggi — hanya outlet terpilih | Wave aktif |
| Berita global (cadangan, **mati secara default**) | GDELT DOC 2.0, 1 request per run + cache, filter domain di kode | Gratis, tanpa key | Agregator; rate limit per IP sangat ketat (praktis tidak andal untuk dev/run berulang) | Opsional |
| Kalender makro terjadwal | Jadwal FOMC (federalreserve.gov), jadwal rilis CPI/NFP (BLS) — disimpan sebagai file data di repo, diperbarui tahunan | Gratis | Resmi | Berikutnya |
| Peg stablecoin & insiden protokol (T4, T9) | DefiLlama API (stablecoins, hacks) | Gratis, tanpa key | Rujukan utama industri DeFi | Berikutnya |
| Likuiditas & leverage on-chain | `Pool.getReserveData` Aave, perp DEX Arbitrum (mis. GMX) | Gratis | Tinggi; cara baca perp DEX *perlu verifikasi* | Nanti |
| Sentimen sosial | Reddit | Gratis dengan batas | Rendah — spec Social Sentiment terpisah | Nanti |
| ~~Berita Yahoo Finance~~ | — | — | Endpoint tidak resmi | **Tidak dipakai** |
| ~~Alpha Vantage News~~ | — | Free tier 25 request/hari | — | **Tidak dipakai** |
| ~~Polymarket / prediction market~~ | — | — | Platform taruhan — risiko reputasi & regulasi (perjudian di banyak yurisdiksi, termasuk Indonesia) | **Tidak dipakai** (keputusan tim, 8 Okt 2026) |

Setiap item yang masuk ke konteks membawa nama sumbernya, sehingga Risk Assessor dan fusion bisa menimbang kredibilitas: on-chain & resmi > agregator berita.

**Lisensi (wajib dicek sebelum keluar dari shadow mode).** TradingAgents adalah proyek riset. Sebagian sumbernya punya batasan untuk penggunaan **komersial**, terutama data Yahoo Finance yang diakses lewat endpoint tidak resmi, tier gratis Alpha Vantage, dan API Reddit. Karena Tahansoe adalah produk komersial (Pro dan B2B memakai output yang sama, ADR 0006), setiap sumber harus punya lisensi atau ketentuan yang mengizinkan penggunaan komersial sebelum keluar dari shadow mode. Sumber yang tidak lolos diganti, dan agent tetap berjalan dengan sumber yang tersisa.

### 3.11 Akses (Free vs Pro)

Mengikuti [ADR 0006](../decisions/0006-business-model-free-info-paid-automation.md): **informasi gratis, otomasi berbayar.** Biaya LLM tetap global (dihitung sekali per aset, bukan per user), sehingga membagikan hasil research ke semua user hampir tidak menambah biaya.

| Fitur | Free | Pro |
|-------|------|-----|
| Proteksi statis Guardian (`setPolicy` + `protect`) | ✅ | ✅ |
| Alert HF | ✅ | ✅ |
| Alert kritis deterministik (sequencer down, depeg stablecoin, CRISIS) | ✅ | ✅ |
| Regime + penjelasan research agents (dashboard & Telegram), termasuk argumen Hawk/Dove | ✅ | ✅ |
| Riwayat report & scorecard lengkap, laporan risiko berkala | Ringkas | ✅ |
| Rekomendasi trigger (dry-run), lalu dynamic trigger otomatis Guardian v2 | — | ✅ |
| Multi-posisi, multi-chain, band kustom per posisi | — | ✅ |

Implementasi: engine **tidak** tahu soal plan; ia selalu menghitung semuanya. Entitlement diperiksa di API/bot (spec billing terpisah). Pembayaran Pro tidak pernah diambil dari allowance Guardian (ADR 0006 §3).

## 4. Dampak keamanan

| Checklist [security.md §4](../security.md#4-checklist-review-keamanan) | Jawaban |
|---|---|
| Jalur baru perpindahan token? (I1) | Tidak. Modul ini tidak punya signer dan tidak memanggil kontrak |
| Role/admin/upgrade baru? (I2) | Tidak |
| Output AI memengaruhi selain trigger dalam band? (I3) | Tidak. Output hanya `Signal`; fusion → rule engine → (v2) trigger dalam band |
| Dampak terburuk jika dikompromi? (I4) | Regime naik palsu (dibatasi aturan konfirmasi) → buffer naik → repay lebih awal |
| Sumber harga untuk eksekusi? (I5) | Tidak relevan; settlement memakai harga AaveOracle tersimpan, bukan untuk eksekusi |
| Komponen mati / basi? (I6) | Fusion tetap jalan dengan sinyal lain; sinyal RESEARCH kedaluwarsa via `expiresAt` |
| User bisa menghentikan? (I7) | Ya, tidak berubah; plus kill switch `RESEARCH_ENABLED` untuk tim |
| Secret? (I8) | `ANTHROPIC_API_KEY` server-only |
| Input eksternal divalidasi? | Ya: tanpa tools, schema-only, cap confidence 0.6, lesson ≤ 600 karakter sebagai data, set eval injection wajib lulus |

## 5. Kriteria penerimaan

- [ ] `runResearch()` menghasilkan `ResearchReport` yang lolos schema dan satu `Signal` `RESEARCH` dengan `confidence ≤ 0.6`
- [ ] Jika < 3 analyst berhasil, budget habis, atau `RESEARCH_ENABLED=false`, tidak ada report dan tidak ada sinyal; fusion tetap berjalan
- [ ] Sinyal `RESEARCH` saja (tanpa konfirmasi pasar/on-chain) tidak pernah menaikkan regime ke `STRESSED`/`CRISIS` (test fusion)
- [ ] Set eval `injection`: 0 kasus di mana regime naik melebihi yang dibenarkan sinyal non-LLM
- [ ] Settlement melabeli semua assessment ≥ STRESSED dan semua MISSED dalam 24 jam setelah horizon
- [ ] Lesson hanya muncul di input Risk Assessor; tidak ada kode yang membaca lesson untuk mengubah konfigurasi
- [ ] Scorecard mingguan bisa dihasilkan dengan satu perintah
- [ ] Biaya harian tercatat per peran dan berhenti tepat di budget
- [ ] `npm run lint` bersih

## 6. Rencana test

- **Unit:** `toSignal` (cap confidence, expiresAt), `selectLessons` (≤ 5, hanya aktif, irisan jalur), `settle` (keempat label dan lead time dari fixture outcome), `budget`.
- **Integrasi:** `runResearch` dengan `LlmProvider` palsu (deterministik) untuk jalur sukses, analyst gagal, refusal, dan schema invalid.
- **Fusion:** property test bahwa sinyal `RESEARCH` saja ≤ `ELEVATED`.
- **Eval LLM:** tiga set di `engine/test/eval/`, dijalankan setiap perubahan prompt atau model. Hasil dilampirkan di PR.
- **Backtest:** `research-replay` pada skenario PRD §6.4, dilaporkan **terpisah** dari fusion deterministik karena bias lookahead (ADR 0005).
- **Shadow mode:** 2 minggu live sebelum notifikasi user.

## 7. Pertanyaan terbuka

- ~~Model per peran~~ → prinsip "termurah yang lolos eval" (§3.4); model final per peran ditetapkan dari hasil eval selama R&D.
- ~~Vendor data~~ → §3.10; tersisa verifikasi lisensi komersial dan cara baca data perp DEX on-chain.
- Nilai `LLM_DAILY_BUDGET_USD` awal (usulan R&D: $5/hari, cukup untuk tier Haiku dengan ruang eksperimen).
- ~~Alert kritis untuk user Free~~ → ya, untuk semua user (§3.11).
- ~~Research untuk plan berbayar?~~ → tidak; informasi gratis untuk semua, otomasi berbayar (ADR 0006).
- Apakah `hawkCase`/`doveCase` ditampilkan ke user di dashboard/Telegram, atau hanya alasan ringkas?
- Bahasa penjelasan ke user: Indonesia, Inggris, atau ikut setelan user? (belum ditentukan)

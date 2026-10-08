# 0004 — Lapis riset multi-agent (pola TradingAgents) di dalam Core Risk Engine

- **Status:** Accepted (disetujui tim, 2026-10-08)
- **Tanggal:** 2026-10-08
- **Pengusul:** Engineering (Claude Code, atas arahan tim)

## Konteks

PRD §6.2 memakai LLM untuk satu tugas sempit: mengklasifikasikan setiap berita menjadi event terstruktur. Ini cukup untuk *mendeteksi* berita, tetapi tidak untuk *menalar* kombinasi konteks. Contohnya: eskalasi konflik + FOMC 6 jam lagi + funding ETH ekstrem + utilization USDC 96%. Masing-masing sinyal mungkin moderat, tetapi kombinasinya berbahaya. Aturan fusion v1 juga sulit menjelaskan *kenapa* kombinasi tertentu berbahaya dengan bahasa yang bisa dibaca user (PRD G6).

[TradingAgents](https://github.com/TauricResearch/TradingAgents) (Apache-2.0, Python/LangGraph) menunjukkan pola yang cocok: tim analyst paralel per domain, debat dua sisi untuk menekan bias, satu agent yang menyimpulkan, lalu memory & reflection berbasis hasil. Pola ini dibuat untuk keputusan trading saham, sehingga tools dan peran "trader / portfolio manager"-nya tidak bisa dipakai langsung.

Batasan yang sudah ada: [ADR 0002](0002-ai-advises-rules-decide.md) (AI hanya memberi saran, fusion dan rule engine deterministik yang memutuskan) dan invariant I3–I6 di [security.md](../security.md).

## Keputusan

1. Core Risk Engine mendapat **lapis riset multi-agent** di `engine/src/agents/`, yang berjalan **di samping** modul sinyal, bukan menggantikannya:
   - **Analyst paralel:** Geopolitics/News, Macro, Market/Technical, On-chain/Protocol. Masing-masing membaca sinyal dan event yang sudah ada di DB.
   - **Debat Hawk ⇄ Dove** (default 1 ronde, maksimal 2): Hawk berargumen risiko naik, Dove berargumen ini noise atau sudah ter-price-in.
   - **Risk Assessor:** menyimpulkan laporan terstruktur `ResearchReport`.
2. Output lapis ini **masuk ke fusion sebagai `Signal` dengan `module: "RESEARCH"`**. Ia tidak menghasilkan `RiskAssessment` atau trigger secara langsung. Peran "risk team / portfolio manager" versi LLM dari TradingAgents **tidak** diadopsi; peran memutuskan tetap milik fusion dan rule engine deterministik.
3. Sinyal `RESEARCH` tunduk pada aturan yang sama dengan sinyal `NEWS` (PRD §6.2): confidence dibatasi, dan tidak bisa sendirian menaikkan regime ke `STRESSED`/`CRISIS` tanpa konfirmasi pasar atau on-chain.
4. **Stack:** TypeScript di dalam `engine/`, dengan orkestrasi ditulis sendiri (fungsi async biasa). Tidak memakai framework graph dan tidak menyalin kode TradingAgents.
5. **Provider LLM:** tetap di balik interface provider-agnostic (`engine/src/llm/`, architecture §2). Implementasi pertama memakai Anthropic SDK (`@anthropic-ai/sdk`) dengan structured output (zod). Model per peran mengikuti prinsip **model termurah yang lolos eval**: mulai dari tier termurah, naik tier per peran hanya jika eval gagal (lihat spec §3.4).
6. Semua agent **tanpa tools**: data diambil kode lebih dulu lalu disisipkan sebagai input. Agent tidak bisa fetch, menulis DB, atau menyentuh chain.
7. Jadwal: periodik (tiap 1–2 jam) dan saat fusion menaikkan regime (dengan cooldown). Lapis ini tidak berada di jalur kritis deteksi crash.

## Alternatif yang dipertimbangkan

| Opsi | Kelebihan | Kekurangan |
|------|-----------|------------|
| Hanya klasifikasi per berita (PRD §6.2 saat ini) | Murah, sederhana | Tidak menalar kombinasi sinyal; penjelasan ke user dangkal |
| Fork TradingAgents (Python sidecar) | Kode siap pakai | Stack kedua; tools & peran khusus saham; peran PM-nya bertentangan dengan ADR 0002 |
| LangGraph.js di TypeScript | Pola graph eksplisit | Dependensi besar untuk alur yang tetap dan linear |
| **Orkestrasi sendiri di `engine/` + output sebagai Signal** | Satu stack; mudah di-test & di-replay; tunduk pada fusion | Perlu menulis orkestrasi dan eval sendiri |

## Konsekuensi

- Positif: konteks lintas domain dan penjelasan ala debat ("kenapa berbahaya, kenapa mungkin tidak") untuk user; pola memory & reflection bisa diterapkan ([ADR 0005](0005-reflection-loop.md)).
- Negatif / biaya: biaya LLM berulang. Estimasi ~$17/bulan (semua peran di tier termurah) sampai ~$660/bulan (semua di tier tertinggi); biaya ini global, tidak naik per user. Ada latensi menit per run. Kualitas bergantung pada eval.
- Dampak ke invariant keamanan: tidak ada jalur baru ke dana. I3 tetap karena output hanya berupa Signal. I6 tetap karena kegagalan lapis ini tidak mengganggu fusion. Permukaan prompt injection bertambah, dan dimitigasi dengan tanpa-tools, schema-only, cap confidence, dan aturan konfirmasi.
- Dokumen yang perlu diperbarui: PRD §6 (6.6), §10 M3, §14; architecture §2, §3.3, §5, §8; security §2.3; glossary; spec [`m3-research-agents.md`](../specs/m3-research-agents.md).

# 0005 — Reflection loop: setiap penilaian risiko dievaluasi ulang, tetapi tidak mengubah aturan sendiri

- **Status:** Accepted (disetujui tim, 2026-10-08)
- **Tanggal:** 2026-10-08
- **Pengusul:** Engineering (Claude Code, atas arahan tim)

## Konteks

PRD §6.4 mewajibkan backtest pada skenario historis. Backtest saja tidak cukup:

1. Backtest pada event lama untuk komponen LLM cenderung **terlalu optimistis**, karena model mungkin sudah "tahu" akhir event tersebut dari data pelatihannya (lookahead).
2. Tanpa evaluasi hasil secara live, tidak ada cara untuk tahu apakah regime yang naik minggu ini benar-benar diikuti bahaya (false positive) atau ada crash yang terlewat (missed).
3. Pola memory & reflection di TradingAgents (keputusan dinilai setelah horizonnya, lalu diubah jadi pelajaran) terbukti berguna, tetapi loop yang mengubah dirinya sendiri berisiko melenceng diam-diam atau diracuni lewat berita yang dirancang khusus.

## Keputusan

1. **Settlement:** setiap `RiskAssessment` dan setiap `ResearchReport` (ADR 0004) dilabeli setelah horizonnya lewat: `TRUE_POSITIVE`, `FALSE_POSITIVE`, `MISSED`, atau `TRUE_NEGATIVE`, beserta lead time. Outcome mentah (drawdown maksimum, peg terendah, dsb.) disimpan agar label bisa dihitung ulang.
2. **Reflection:** untuk FP, MISSED, dan sampel TP, LLM menulis pelajaran singkat terstruktur (≤ 600 karakter). Prosesnya batch harian.
3. **Pemakaian pelajaran:** pelajaran hanya disisipkan sebagai **data konteks** ke Risk Assessor (maksimal 5 per run). Pelajaran **tidak pernah** mengubah ambang, bobot, mapping regime → buffer, atau prompt sistem.
4. **Perubahan aturan** (fusion, mapping regime, prompt, model) hanya lewat manusia: review mingguan berdasarkan scorecard → PR → backtest + eval → merge. Setiap aturan dan prompt diberi versi (`modelVersion` di `RiskAssessment`).
5. **Shadow mode bertahap** sebelum berdampak ke user: shadow (hanya tim) → notifikasi → dry-run rekomendasi → dynamic trigger on-chain (Guardian v2).

## Alternatif yang dipertimbangkan

| Opsi | Kelebihan | Kekurangan |
|------|-----------|------------|
| Hanya backtest | Sederhana | Bias lookahead untuk LLM; tidak ada umpan balik live |
| Reflection yang otomatis mengubah ambang/prompt | Belajar paling cepat | Bisa melenceng tanpa ketahuan; bisa diracuni; tidak bisa diaudit |
| **Reflection sebagai konteks + perubahan aturan lewat manusia** | Belajar cepat di konteks, aturan tetap terkendali & teraudit | Perbaikan aturan lebih lambat (siklus mingguan) |

## Konsekuensi

- Positif: metrik presisi/recall/lead time yang jujur dan live (bahan scorecard publik & B2B, BRD §6); kesalahan berulang tertangkap di review mingguan.
- Negatif / biaya: tabel dan job tambahan; biaya LLM batch (~$60/bulan estimasi); review mingguan butuh waktu tim.
- Dampak ke invariant keamanan: tidak ada jalur baru ke dana. Pelajaran adalah turunan dari konten eksternal, sehingga diperlakukan sebagai data tak tepercaya (invariant #5 di AGENTS.md): panjang dibatasi, tidak bisa mengubah skema output, dan output tetap melewati cap confidence.
- Dokumen yang perlu diperbarui: PRD §6.4, §12; architecture §2, §5; security §2.3; glossary; spec [`m3-research-agents.md`](../specs/m3-research-agents.md).

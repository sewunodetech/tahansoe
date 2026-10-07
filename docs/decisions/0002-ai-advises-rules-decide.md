# 0002 — AI advises, rules decide, contract enforces

- **Status:** Accepted
- **Tanggal:** 2026-10-07
- **Pengusul:** Owner

## Konteks

Branch `core-dev` membangun Core Risk Engine berbasis AI yang membaca oracle, teknikal, fundamental, makro, berita, dan geopolitik. AI yang lebih berperan meningkatkan kemampuan antisipasi, tetapi LLM rentan halusinasi, prompt injection, dan manipulasi berita. Produk juga berjanji non-custodial.

## Keputusan

1. Output AI hanya berupa `RiskAssessment` terstruktur (regime, estimasi drawdown, rekomendasi trigger, alasan).
2. Rule engine deterministik yang mengubah assessment + policy user menjadi Intent.
3. Satu-satunya efek on-chain dari AI adalah **menggeser trigger HF di dalam band yang disetujui user**, lewat risk agent yang dipilih dan bisa dicabut user (Guardian v2).
4. Assessment punya `validUntil`; jika kedaluwarsa atau engine mati, sistem kembali ke policy statis.
5. Sebelum Guardian v2, engine berjalan dalam mode **dry-run** (rekomendasi ditampilkan, tidak ditulis on-chain).

## Alternatif yang dipertimbangkan

| Opsi | Kelebihan | Kekurangan |
|------|-----------|------------|
| AI langsung memutuskan & mengeksekusi | Paling fleksibel | Melanggar non-custodial; satu halusinasi bisa merugikan user |
| AI hanya untuk NL config (PRD v0.1) | Paling aman | Tidak memanfaatkan intelijen pasar, nilai produk turun |
| AI menggeser trigger dalam band | Nilai AI tinggi, dampak terburuk terbatas | Butuh Guardian v2 dan kalibrasi band |

## Konsekuensi

- Positif: dampak terburuk kompromi AI = utang dibayar lebih awal.
- Negatif: proteksi preemptif terbatas pada band yang dipilih user.
- Invariant: menjadi dasar I3, I4, I6 di security.md.
- Dokumen diperbarui: PRD §5–§7, security.md.

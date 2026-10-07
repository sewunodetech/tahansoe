# Dokumentasi Tahansoe

Indeks semua dokumen proyek. Untuk agent: mulai dari [`../AGENTS.md`](../AGENTS.md).

## Bacaan berurutan (onboarding)

1. [`status.md`](status.md) — posisi proyek hari ini
2. [`brd.md`](brd.md) — kenapa produk ini ada dan untuk siapa
3. [`prd.md`](prd.md) — apa yang dibangun
4. [`architecture.md`](architecture.md) — bagaimana dibangun
5. [`security.md`](security.md) — apa yang tidak boleh terjadi
6. [`decisions/`](decisions/) — keputusan penting dan alasannya
7. [`glossary.md`](glossary.md) — istilah

## Jenis dokumen

| Jenis | Lokasi | Pemilik | Kapan diubah |
|-------|--------|---------|--------------|
| BRD (Business Requirements) | `brd.md` | Owner/product | Saat strategi bisnis, target pasar, atau model pendapatan berubah |
| PRD (Product Requirements) | `prd.md` | Owner/product | Saat scope, fitur, atau roadmap berubah |
| Architecture | `architecture.md` | Engineering | Saat komponen, struktur folder, data model, atau interface berubah |
| Security | `security.md` | Engineering | Saat ada komponen baru yang menyentuh dana, auth, atau input eksternal |
| ADR | `decisions/NNNN-*.md` | Siapa pun yang mengusulkan | Satu file per keputusan; tidak diedit setelah `Accepted` (buat ADR baru) |
| Spec fitur | `specs/*.md` | Pengerja fitur | Sebelum dan selama implementasi |
| Status | `status.md` | Setiap kontributor | Di akhir setiap pekerjaan |
| Design system | [`../DESIGN.md`](../DESIGN.md) | Design/frontend | Saat token atau pola UI berubah |
| Kontrak | [`../contracts/README.md`](../contracts/README.md) | Engineering | Saat kontrak, deploy, atau alamat berubah |

## Aturan menulis

- Bahasa: Indonesia, istilah teknis tetap dalam bahasa Inggris (Health Factor, keeper, Intent).
- Satu fakta, satu tempat. Dokumen lain cukup menautkan, jangan menyalin ulang.
- Tulis keputusan beserta alasannya. "Kenapa" lebih penting daripada "apa".
- Angka pasar atau klaim eksternal wajib diberi sumber atau ditandai *perlu validasi*.

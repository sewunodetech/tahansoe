# Architecture Decision Records

Satu file per keputusan penting. Format: `NNNN-judul-singkat.md`, salin dari [`0000-template.md`](0000-template.md).

Aturan:
- ADR yang sudah `Accepted` tidak diedit isinya. Untuk mengubah arah, buat ADR baru dan tandai yang lama `Superseded by NNNN`.
- Wajib ditulis untuk: perubahan chain/protokol, model keamanan, peran AI, struktur repo/modul, dependensi atau provider besar, model bisnis.

| No | Judul | Status |
|----|-------|--------|
| 0001 | [Arbitrum-first, arsitektur chain-agnostic](0001-arbitrum-first-chain-agnostic.md) | Accepted |
| 0002 | [AI advises, rules decide, contract enforces](0002-ai-advises-rules-decide.md) | Accepted |
| 0003 | [Guardian v1 memakai approve dari EOA, bukan Safe Module](0003-guardian-v1-eoa-approve.md) | Accepted |

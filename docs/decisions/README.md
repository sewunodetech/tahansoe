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
| 0004 | [Lapis riset multi-agent (pola TradingAgents) di Core Risk Engine](0004-multi-agent-research-layer.md) | Accepted |
| 0005 | [Reflection loop: evaluasi ulang tanpa mengubah aturan sendiri](0005-reflection-loop.md) | Accepted |
| 0006 | [Model bisnis: informasi gratis, otomasi berbayar, tanpa fee on-chain di v1](0006-business-model-free-info-paid-automation.md) | Accepted |

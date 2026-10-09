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
| 0007 | [Struktur monorepo, Next.js + worker terpisah, tanpa indexer dulu](0007-monorepo-structure-and-runtime.md) | Accepted |
| 0008 | [Multi-provider LLM: adapter OpenAI-compatible, model per peran, fallback](0008-multi-provider-llm.md) | Sebagian di-supersede oleh [0009](0009-single-openai-compatible-gateway.md) |
| 0009 | [Satu pintu LLM: gateway OpenAI-compatible tunggal (`LLM_API_URL` + `LLM_API_KEY`)](0009-single-openai-compatible-gateway.md) | Accepted |
| 0010 | [Pilihan database lokal: PGlite (embedded Postgres) di samping Neon](0010-local-pglite-database-option.md) | Accepted |


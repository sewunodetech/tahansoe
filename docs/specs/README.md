# Specs

Satu file per fitur non-trivial, dibuat dari [`_template.md`](_template.md) sebelum implementasi dimulai. Nama file: `m<milestone>-<nama-fitur>.md`, misalnya `m2-engine-skeleton.md`.

Spec boleh berubah selama implementasi; perbedaan dengan PRD/architecture harus dibawa balik ke dokumen tersebut.

| Milestone | File | Judul / Fitur | Status |
|-----------|------|---------------|--------|
| M1 | [m1-web-onchain-integration.md](m1-web-onchain-integration.md) | Integrasi Web dengan Guardian On-Chain (Arbitrum Sepolia) | In progress |
| M2 | [m2-engine-skeleton.md](m2-engine-skeleton.md) | Kerangka Core Risk Engine | Done |
| M2 | [m2-deterministic-signal-modules.md](m2-deterministic-signal-modules.md) | Modul sinyal deterministik (Oracle, Depeg, Makro) | Done |
| M2 | [m2-risk-fusion-v1.md](m2-risk-fusion-v1.md) | Risk Fusion v1 (deterministik) | Done |
| M3 | [m3-carry-interest-monitoring.md](m3-carry-interest-monitoring.md) | Carry & Interest-Rate Monitoring (jalur T11) | Done |
| M3 | [m3-channel-gateway-telegram.md](m3-channel-gateway-telegram.md) | Channel Gateway Telegram (inbound chat) | Sebagian di-supersede oleh [ADR 0012](../decisions/0012-unified-db-outbound-research-broadcast.md) |
| M3 | [m3-cli.md](m3-cli.md) | Tahansoe CLI (`tahansoe`) | Approved |
| M3 | [m3-research-agents.md](m3-research-agents.md) | Research agents (multi-agent) & reflection loop | Draft |
| M1/M2/M3 | [m3-research-broadcast.md](m3-research-broadcast.md) | Outbound Research Broadcast — Notifikasi & Digest Telegram Terjadwal | Approved |

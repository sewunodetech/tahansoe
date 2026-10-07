# 0001 — Arbitrum-first, arsitektur chain-agnostic

- **Status:** Accepted
- **Tanggal:** 2026-10-07
- **Pengusul:** Owner

## Konteks

PRD v0.1 mengunci Base sebagai chain. Dalam praktiknya, Guardian v1 dikembangkan, di-fork-test, dan di-deploy di Arbitrum Sepolia. Visi produk juga mencakup proteksi lintas chain di masa depan.

## Keputusan

1. Chain awal adalah **Arbitrum**: Arbitrum Sepolia untuk testnet, Arbitrum One untuk mainnet.
2. Semua kode (engine, adapter, keeper, web) ditulis **chain-agnostic** sejak awal: hal spesifik chain hanya boleh ada di chain registry.
3. Ekspansi bertahap: multi-chain independen → portfolio view lintas chain → cross-chain funding (lihat PRD §8.3).

## Alternatif yang dipertimbangkan

| Opsi | Kelebihan | Kekurangan |
|------|-----------|------------|
| Base dulu (PRD v0.1) | Ekosistem retail besar | Kontrak & test sudah di Arbitrum; pindah = kerja ulang |
| Multi-chain sekaligus | Jangkauan luas | Fokus pecah sebelum loop terbukti |
| Arbitrum-first + chain-agnostic | Memakai pekerjaan yang ada, siap ekspansi | Disiplin registry sejak awal |

## Konsekuensi

- Positif: tidak ada rewrite saat menambah chain; deploy Guardian per chain (idealnya CREATE2 alamat sama).
- Negatif: sedikit overhead abstraksi di awal.
- Invariant: L2 wajib cek sequencer uptime feed (security I5/I6).
- Dokumen diperbarui: PRD §7–§9, architecture §4.

# 0017 — Identitas dan reputasi Protection Agent lewat ERC-8004

- **Status:** Proposed
- **Tanggal:** 2026-10-25
- **Pengusul:** Owner

## Konteks

Dengan [ADR 0016](0016-bounded-protection-agent.md), user memberi mandat kepada agent untuk bertindak atas posisinya. Agar user bisa mempercayai agent, dan memverifikasinya sendiri, agent butuh identitas yang tetap dan rekam jejak yang publik dan tidak bisa dihapus.

[ERC-8004 (Trustless Agents)](https://eips.ethereum.org/EIPS/eip-8004) berstatus Draft dan mendefinisikan tiga registry:

- **Identity Registry** (ERC-721 + URIStorage): `agentId` = tokenId, `agentURI` menunjuk ke file registrasi (nama, layanan, `supportedTrust`).
- **Reputation Registry**: `giveFeedback(agentId, value, valueDecimals, tag1, tag2, endpoint, feedbackURI, feedbackHash)` oleh client mana pun, kecuali pemilik/operator agent.
- **Validation Registry**: validator independen memberi skor 0–100 atas permintaan agent.

Diverifikasi on-chain 25 Okt 2026: Identity `0x8004A818BFB912233c491871b3d84c89A494BD9e` dan Reputation `0x8004B663056A597Dffe9eCcC1965A193B7388713` ada di Arbitrum Sepolia; Identity `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` dan Reputation `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` ada di Arbitrum One. Validation Registry belum tersedia di mainnet.

## Keputusan

1. Setiap Protection Agent yang bisa menerima mandat didaftarkan di Identity Registry ERC-8004 pada chain yang sama dengan Guardian. Alamat registry masuk chain registry (`packages/domain/src/chains.ts`), tidak di-hardcode (invariant #6 AGENTS.md).
2. File registrasi (`agentURI`) memuat: nama, versi strategi, alamat kunci agent (`agentWallet` lewat `setAgentWallet` yang ditandatangani), Guardian yang didukung, link scorecard publik, dan `supportedTrust: ["reputation"]` (ditambah `"validation"` setelah registry itu tersedia).
3. **Mandat hanya bisa diberikan ke agent terdaftar.** UI menampilkan `agentId`, pemilik, dan ringkasan reputasi sebelum user menandatangani mandat. Guardian v5 menyimpan `agentId` di mandat agar jejak on-chain bisa ditelusuri.
4. **Reputasi dari hasil, bukan dari klaim.** Feedback ditulis oleh user yang dilindungi (opsional, dari UI setelah aksi agent) dan oleh settlement deterministik Tahansoe lewat alamat terpisah yang bukan pemilik/operator agent. Tag yang dipakai: `protection` / `preempt` / `false-positive` / `missed`. Agregasi dilakukan off-chain dan ditampilkan bersama sumbernya.
5. Validation Registry dipakai setelah tersedia di mainnet: replay deterministik dari `ProtectionPlan` + data saat itu bisa diverifikasi validator independen.
6. Kepemilikan NFT agent dipegang multisig tim, bukan kunci keeper. Kunci keeper hanya `agentWallet`.

## Alternatif yang dipertimbangkan

| Opsi | Kelebihan | Kekurangan |
|------|-----------|------------|
| Tanpa identitas on-chain (hanya alamat keeper) | Sederhana | Tidak ada rekam jejak portabel; trust hanya dari klaim tim |
| Registry identitas buatan sendiri | Kontrol penuh | Tidak interoperabel; user harus percaya registry kita |
| **ERC-8004 (dipilih)** | Standar terbuka, sudah ter-deploy di Arbitrum, reputasi publik | Masih Draft; rentan Sybil feedback; ABI bisa berubah |

## Konsekuensi

- Positif: user bisa memverifikasi agent dan rekam jejaknya sendiri; pembeda kepercayaan dibanding bot tertutup.
- Negatif / biaya: standar masih Draft, sehingga ABI dikunci per versi dan dipantau; feedback bisa di-spam (Sybil), jadi UI hanya menampilkan feedback dari alamat yang pernah benar-benar dilindungi Guardian.
- Dampak ke invariant keamanan ([security.md](../security.md)): tidak ada jalur dana baru. Kompromi kunci pemilik NFT bisa mengganti `agentURI`/`agentWallet`, jadi Guardian v5 mengikat mandat ke alamat agent saat mandat diberikan (bukan dibaca dinamis dari registry), dan perubahan `agentWallet` membatalkan mandat lama.
- Dokumen yang perlu diperbarui: security.md (threat model identitas agent), chain registry, architecture.md, `docs/knowledge/` (alamat terverifikasi).

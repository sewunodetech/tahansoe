# 0016 — Protection Agent memilih aksi proteksi dalam mandat yang disetujui user

- **Status:** Proposed
- **Tanggal:** 2026-10-25
- **Pengusul:** Owner (arahan 25 Okt 2026: agent memilih aksi dalam batas, belajar strategi proteksi, bukan copy trade)

## Konteks

[ADR 0002](0002-ai-advises-rules-decide.md) membatasi efek on-chain AI pada satu hal: menggeser trigger HF di dalam band yang disetujui user. Itu aman, tetapi proteksi tetap reaktif. Guardian selalu menjalankan urutan layer yang sama (L1 → L2 → L3) dengan jumlah "sampai target HF", dan baru bergerak saat HF menyentuh trigger.

Owner ingin pembeda dari kompetitor (DeFi Saver, Instadapp, dan bot threshold lain): sebuah **Protection Agent** yang memadukan riset off-chain (regime, berita, makro) dengan posisi on-chain user, lalu memilih **aksi proteksi** yang paling sesuai, yaitu layer mana, berapa, dan kapan. Agent juga harus terus belajar dan diuji lewat backtest.

Batas yang tidak berubah: non-custodial (I1), tanpa admin (I2), oracle eksekusi = oracle protokol (I5), fallback statis (I6), user bisa menghentikan semuanya (I7). Positioning "bertahan, bukan cepat kaya" juga tetap: agent tidak mencari yield, tidak membuka posisi, dan tidak memberi sinyal trading (PRD §11).

## Keputusan

1. **Mandat on-chain per posisi.** User memberi mandat kepada satu agent per posisi (`positionKey`). Mandat mencakup daftar aksi yang diizinkan (bitmask: `REPAY_WALLET` L1, `REPAY_VAULT` L2, `DELEVERAGE` L3, `SHIFT_TRIGGER`), batas jumlah per aksi dan per 24 jam, batas atas HF preemptif (`maxPreemptHF`: di atas HF ini agent tidak boleh bertindak), dan `validUntil`. Mandat bisa dicabut kapan saja oleh user dalam satu transaksi. `DELEVERAGE` mati secara default.
2. **Aksi agent tetap memakai jalur dana Guardian.** Agent tidak pernah memegang token. Fungsi baru `agentProtect(user, key, layer, amount)` hanya bisa memanggil layer yang ada di mandat, hanya membayar utang user sendiri, tunduk pada cap mandat, cap policy, saldo, dan allowance, serta wajib menaikkan HF. Agent bisa bertindak **sebelum** trigger statis (preemptif) selama HF ≤ `maxPreemptHF`.
3. **Agent memutuskan, rule engine memvalidasi, kontrak menegakkan.** Output Protection Agent berupa `ProtectionPlan` terstruktur. Rule engine deterministik memeriksa plan terhadap mandat, regime, umur data, dan batas risiko sebelum menjadi Intent. Kontrak menegakkan ulang semua batas. LLM tidak pernah memegang kunci yang bisa menandatangani; kunci agent dipegang keeper dan hanya bisa memanggil `agentProtect` / `setDynamicTrigger`.
4. **Strategi proteksi dipelajari, bukan disalin.** Agent belajar dari playbook proteksi, yaitu bagaimana wallet yang selamat dari crash historis menurunkan risiko (kapan, berapa buffer HF, layer apa), plus hasil settlement dan backtest Tahansoe sendiri. Ini **bukan** copy trade: agent tidak meniru posisi, arah pasar, atau leverage pihak lain. Metrik keberhasilan adalah likuidasi tercegah dan biaya proteksi, bukan winrate trading.
5. **Pembelajaran tidak mengubah aturan sendiri.** Playbook dan lesson adalah data ([ADR 0005](0005-reflection-loop.md)). Strategi baru hanya naik ke produksi setelah lolos backtest pada skenario PRD §6.4 (termasuk periode tenang) dan disetujui manusia. Setiap versi strategi punya `strategyVersion` yang tercatat di setiap Intent.
6. **Bertahap.** Fase A tanpa perubahan kontrak: plan berjalan dalam mode shadow, dan satu-satunya efek on-chain tetap `setDynamicTrigger` (ADR 0002). Fase B membutuhkan Guardian v5 (mandat + `agentProtect`) dan **audit** sebelum mainnet.
7. **Fee tetap netral.** Success fee ([ADR 0013](0013-success-fee-on-protection.md)) tetap hanya berlaku saat HF di bawah trigger statis user. Aksi preemptif agent di atas trigger tidak dikenai fee, jadi agent tidak punya insentif untuk bertindak berlebihan.

Keputusan ini men-*supersede* poin 3 [ADR 0002](0002-ai-advises-rules-decide.md) untuk user yang memberi mandat. User tanpa mandat tetap berada pada model ADR 0002.

## Alternatif yang dipertimbangkan

| Opsi | Kelebihan | Kekurangan |
|------|-----------|------------|
| Tetap ADR 0002 (AI hanya menggeser trigger) | Dampak terburuk paling kecil | Tidak bisa memilih layer/jumlah; nilai pembeda kecil |
| Agent memegang session key / smart account dengan izin luas | Fleksibel | Melanggar semangat non-custodial; dampak kompromi besar |
| Copy trade wallet dengan winrate tinggi | Menarik secara marketing | Keluar dari misi (PRD §11), menjadi sinyal trading, risiko regulasi |
| **Mandat per posisi + `agentProtect` di Guardian (dipilih)** | Agent pintar, dana tetap hanya ke utang user, user bisa cabut | Butuh kontrak baru + audit; kalibrasi mandat default |

## Konsekuensi

- Positif: proteksi preemptif yang memilih aksi berdasarkan konteks; pembeda jelas dari kompetitor; jejak keputusan bisa diaudit (`strategyVersion`, `ProtectionPlan`, Intent).
- Negatif / biaya: Guardian v5 dan audit; agent bisa membayar utang lebih awal dari perlu (biaya peluang) atau memicu deleverage (slippage) bila diizinkan; kunci agent menjadi target serangan.
- Dampak ke invariant keamanan ([security.md](../security.md)):
  - I1 tetap: dana hanya dari sumber user (wallet/vault/aToken/kolateral) ke utang user sendiri.
  - I3 diperluas: output AI kini bisa memilih aksi, tetapi hanya di dalam mandat on-chain. Dampak terburuk kompromi kunci agent = utang dibayar lebih awal sampai cap mandat; plus, bila user mengizinkan `DELEVERAGE`, penjualan kolateral sampai cap dan batas slippage.
  - I6 tetap: mandat kedaluwarsa atau agent mati → Guardian kembali ke policy statis.
  - I7 tetap: `revokeMandate` dan `disablePolicy` menghentikan agent seketika.
- Dokumen yang perlu diperbarui: security.md (I3, threat model agent), PRD §5–§7 dan §10, architecture.md, ADR 0002 (catatan "sebagian di-supersede oleh 0016" setelah Accepted).

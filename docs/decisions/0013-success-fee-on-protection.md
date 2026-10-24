# 0013 — Model bisnis: fee sukses 0,15% hanya saat posisi diselamatkan

- **Status:** Proposed (arah disetujui owner 2026-10-24; menunggu review isi sebelum Accepted)
- **Tanggal:** 2026-10-24
- **Pengusul:** Owner (setelah sesi mentor), ditulis oleh Claude Code
- **Menggantikan (saat Accepted):** [ADR 0006](0006-business-model-free-info-paid-automation.md) butir 2–4

## Konteks

Mentor meminta dua hal: *user proof* dan model bayar yang hanya berlaku saat user benar-benar merasakan manfaatnya. Pilihan sebelumnya, langganan Pro di [ADR 0006](0006-business-model-free-info-paid-automation.md), meminta user membayar di muka untuk proteksi yang mungkin tidak pernah terpakai. Untuk user baru yang belum percaya, ini hambatan besar.

Pembanding di pasar (diakses 24 Okt 2026):

- DeFi Saver Automation mengenakan fee otomasi 0,05% per eksekusi, ditambah fee swap 0,25% untuk pasangan tidak berkorelasi (misalnya ETH→USDC), dan gas yang dibebankan ke posisi. Minimum utang di Arbitrum adalah $500. Sumber: [Automation Fees](https://help.defisaver.com/features/automation/fees), [Requirements](https://help.defisaver.com/features/automation/requirements-for-using-automation).
- Kalau proteksi gagal, user kehilangan bonus likuidasi Aave, sekitar 5% dari collateral yang disita untuk WETH.

ADR 0006 menolak fee on-chain karena tiga alasan. ADR ini harus menjawab ketiganya:

1. **I1:** dana user hanya boleh mengalir ke posisi user sendiri. Fee berarti sebagian dana mengalir ke treasury.
2. **I4:** kalau Tahansoe dibobol, akibat terburuknya hanya "utang dibayar lebih awal". Fee membuka kemungkinan penyerang memicu aksi demi memungut fee.
3. **Konflik insentif:** AI bisa menaikkan trigger. Kalau aksi yang dipicu AI dikenai fee, Tahansoe diuntungkan setiap kali regime dinaikkan.

## Keputusan

1. **Fee sukses sebesar 0,15% (15 bps) dari total utang yang di-repay** dalam satu panggilan `protect()`. Mata uangnya aset utang (misalnya USDC). Angka ini adalah `constant` di kontrak dan tidak bisa diubah. Kalau mau mengubahnya, deploy kontrak versi baru, dan user harus pindah sendiri.
2. **Fee hanya dipungut pada "penyelamatan nyata"**, yaitu bila `hfBefore` memenuhi kedua syarat berikut:
   - di bawah **trigger statis** pilihan user (`policies[user].triggerHF`), **dan**
   - di bawah **`FEE_HF_CEILING = 1.50`**, yang juga `constant`.

   Aksi yang hanya terjadi karena AI menaikkan trigger (dynamic trigger di atas trigger statis) **gratis**. Aksi preemptif tidak pernah dikenai fee. Dengan begitu menaikkan regime tidak menghasilkan pendapatan, dan konflik insentif tertutup.
3. **Proteksi selalu didahulukan.** Fee dihitung setelah repay selesai dan hanya diambil dari dua sumber, berurutan:
   1. token aset utang yang sudah ada di Guardian pada transaksi itu, yang sebelumnya akan dikembalikan ke user;
   2. saldo wallet user di dalam sisa allowance aset utang untuk Guardian.

   Fee **tidak pernah** memicu penjualan collateral tambahan, redeem vault tambahan, atau revert. Kalau dana tidak cukup, sisa fee dihapus (*waived*) dan dicatat di event.
4. **Treasury adalah alamat `immutable`** yang ditetapkan di constructor, disarankan Safe multisig tim. Tidak ada setter, owner, atau upgrade. Guardian tetap tidak menyimpan saldo di antara transaksi (I2), karena fee langsung ditransfer ke treasury di transaksi yang sama.
5. **Transparansi.** Kontrak memancarkan event `FeeCharged(user, debtAsset, amount, waived)`. UI menampilkan perkiraan fee sebelum user mengaktifkan proteksi, dan receipt Telegram mencantumkan fee yang benar-benar terpotong.
6. **Yang tetap dari ADR 0006:**
   - Informasi risiko (alert, regime, penjelasan agent) gratis untuk semua user (butir 1).
   - B2B risk feed setelah scorecard live minimal 3 bulan (butir 5).
   - Grant (butir 6).

   Otomasi tidak lagi butuh langganan. Fitur lanjutan yang tidak terkait penyelamatan, misalnya laporan berkala, bisa dibahas di ADR terpisah bila perlu.
7. **Versi kontrak.** Fee diterapkan di Guardian versi baru (v3, tanpa proxy). User Guardian v2 yang sudah ada tidak terkena fee sampai mereka pindah sendiri lewat banner migrasi.

## Alternatif yang dipertimbangkan

| Opsi | Kelebihan | Kekurangan |
|------|-----------|------------|
| Tetap langganan Pro (ADR 0006) | Invariant utuh, pendapatan bisa diprediksi | User bayar di muka sebelum percaya; bertentangan dengan masukan mentor |
| Tagihan off-chain setelah penyelamatan terbukti | Kontrak dan invariant tidak berubah | Tidak ada jaminan bayar; perlu sistem penagihan dan identitas |
| Fee di setiap eksekusi, termasuk yang dipicu AI | Pendapatan lebih besar | Konflik insentif langsung dengan regime; melemahkan I4 |
| Fee hanya bila HF di bawah ambang tetap rendah (misalnya 1,10) | Definisi "darurat" paling ketat | Hampir tidak pernah terpicu bila trigger user bekerja normal; mendorong Tahansoe menyarankan trigger rendah |
| **Fee 0,15% bila HF < trigger statis dan < 1,50; proteksi didahulukan** | Bayar hanya saat diselamatkan; aksi AI gratis; murah dibanding biaya DeFi Saver (sekitar 0,30% per repay dengan swap) dan potongan likuidasi (sekitar 5%) | Invariant I1 dan I4 harus direvisi; scope audit bertambah |

## Konsekuensi

- **Positif:**
  - Pitch sederhana: "gratis sampai kami menyelamatkanmu, lalu 0,15%".
  - Tidak ada minimum posisi.
  - Pendapatan sejalan dengan hasil nyata.
  - Aksi preemptif AI tetap gratis, jadi narasi "AI advises, rules decide" ([ADR 0002](0002-ai-advises-rules-decide.md)) tetap bersih.
- **Negatif / biaya:**
  - Pendapatan tidak bisa diprediksi dan bergantung pada volatilitas pasar.
  - Kontrak bertambah satu jalur transfer, sehingga audit bertambah.
  - Gas keeper tetap ditanggung Tahansoe, didanai dari fee.
  - "Penyelamatan" didefinisikan lewat trigger statis user, bukan pembuktian kontrafaktual bahwa posisi pasti terlikuidasi tanpa Tahansoe. Ini harus dijelaskan jujur di FAQ.
- **Dampak ke invariant keamanan ([security.md](../security.md)), berlaku saat Accepted:**
  - **I1** direvisi: dana user hanya boleh berpindah ke protokol lending untuk posisi user sendiri, *kecuali* fee sukses tetap 15 bps dari jumlah repay ke treasury `immutable`, hanya saat HF di bawah trigger statis user dan di bawah 1,50.
  - **I4** direvisi: kompromi penuh atas Tahansoe hanya bisa berdampak "utang dibayar lebih awal". Fee tidak bisa dipicu oleh kompromi itu, karena syarat fee (HF di bawah trigger statis) ditentukan oleh oracle Aave dan pilihan user, bukan oleh keeper, agent, atau server.
  - I2, I3, I5, I6, I7, dan I8 tidak berubah.
- **Dokumen yang perlu diperbarui saat Accepted:**
  - ADR 0006: status `Superseded by 0013` untuk butir 2–4.
  - security.md: I1, I4, dan threat model kontrak.
  - BRD §6 (tabel model pendapatan dan baris 79).
  - PRD §9, §10 (M4), dan §14.
  - `docs/product/faq.md` bagian "Ada fee on-chain?", serta koreksi klaim smart wallet DeFi Saver (Aave v3 kini mendukung EOA).
  - [Spec Guardian fee](../specs/m4-guardian-success-fee.md).
  - status.md.

## Pertanyaan terbuka

- Alamat treasury: Safe multisig siapa saja, dengan threshold berapa?
- Apakah `FEE_HF_CEILING = 1.50` sudah tepat, atau perlu disamakan dengan batas atas band default user (1.60)?
- Apakah fee perlu batas atas absolut per aksi (misalnya maksimal $500) agar posisi sangat besar tidak terkena fee yang terasa berlebihan?

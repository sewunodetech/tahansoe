/**
 * Penulis .env minimal: set/ubah hanya kunci tertentu TANPA menyentuh baris lain
 * (komentar, urutan, nilai lain tetap). Dipakai CLI research interaktif agar bisa
 * menyimpan pilihan model ke apps/engine/.env.
 *
 * JANGAN pernah mencetak isi file / secret. Fungsi di sini murni transformasi teks
 * (tanpa I/O) agar mudah diuji; I/O dilakukan pemanggil.
 */

/**
 * Terapkan `updates` (key→value) ke isi file .env `content`.
 *  - Kunci yang sudah ada: nilainya diganti, posisi & sisa baris dipertahankan.
 *  - Kunci baru: ditambahkan di akhir (dengan newline pemisah bila perlu).
 *  - Baris lain (komentar `#`, kunci lain, baris kosong) tidak diubah.
 * Mengembalikan isi file baru.
 */
export function applyEnvUpdates(content: string, updates: Record<string, string>): string {
  const remaining = new Map(Object.entries(updates));
  // Pertahankan gaya akhir baris file (LF). Pecah dengan mempertahankan baris.
  const lines = content.length === 0 ? [] : content.split("\n");

  const out = lines.map((line) => {
    // Hanya cocokkan baris "KEY=..." (abaikan komentar & baris tanpa '=').
    const m = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*)=/.exec(line);
    if (!m) return line;
    const key = m[2]!;
    if (!remaining.has(key)) return line;
    const value = remaining.get(key)!;
    remaining.delete(key);
    return `${key}=${value}`;
  });

  // Kunci baru: tambahkan di akhir.
  if (remaining.size > 0) {
    // Pastikan ada pemisah: jika file tidak kosong dan baris terakhir bukan kosong.
    if (out.length > 0 && out[out.length - 1]!.trim() !== "") {
      // biarkan; kita hanya append baris baru di bawah
    }
    for (const [key, value] of remaining) out.push(`${key}=${value}`);
  }

  let result = out.join("\n");
  // Jaga trailing newline bila file asli punya (atau file baru).
  if (content.endsWith("\n") && !result.endsWith("\n")) result += "\n";
  if (content.length === 0 && result.length > 0 && !result.endsWith("\n")) result += "\n";
  return result;
}

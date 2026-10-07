---
version: "tahansoe-2026-10-07"
name: "Tahansoe — Mostar"
description: "Design system Tahansoe. Dark mode 'Mostar night' (permukaan hijau-sungai gelap, tinta krem) dan light mode 'Mostar day' (kertas krem, tinta gelap). Sumber kebenaran token: app/globals.css."
colors:
  background: "#0b1110"
  surface: "#15201d"
  border: "#26332f"
  text-primary: "#fdf1e1"
  text-secondary: "#c8bca9"
  brand: "#4ab5e0"
  accent2: "#fbbf24"
  safe: "#34d399"
  warning: "#fbbf24"
  danger: "#f87171"
typography:
  display: "Instrument Serif (var --font-display)"
  body: "Inter (var --font-sans)"
  mono: "JetBrains Mono (var --font-mono)"
---

# Tahansoe Design System

Sumber kebenaran token adalah **`app/globals.css`**. Dokumen ini menjelaskan cara memakainya. Jika keduanya berbeda, perbarui dokumen ini mengikuti CSS (atau sebaliknya lewat perubahan yang disengaja).

## 1. Karakter

- **Tenang dan tepercaya.** Produk ini menjaga uang orang. Hindari visual "degen" (neon berlebihan, hype, angka berkedip).
- **Data dulu.** HF, harga, dan status harus terbaca dalam satu lirikan.
- **Jujur soal risiko.** Status bahaya selalu jelas; disclosure tidak disembunyikan.
- **Nuansa Mostar.** Hijau sungai gelap, krem hangat, biru langit Neretva sebagai aksen utama.

## 2. Tema

Tema dikendalikan `next-themes` lewat atribut `data-theme` (`dark` / `light`) di `<html>`. Selalu pakai CSS variable, jangan hardcode hex di komponen baru.

### Permukaan & teks

| Token | Dark | Light | Pakai untuk |
|-------|------|-------|-------------|
| `--bg` | `#0b1110` | `#fdf1e1` | Latar halaman |
| `--bg-subtle` | `#101816` | `#f6e8d3` | Area sekunder |
| `--bg-elevated` | `#15201d` | `#fffaf2` | Card, panel |
| `--bg-overlay` | `#1a2623` | `#fffaf2` | Modal, popover |
| `--border` | `#26332f` | `#e6d5bb` | Garis default |
| `--border-strong` | `#34423d` | `#d6c1a2` | Garis penekanan |
| `--text-primary` | `#fdf1e1` | `#111411` | Teks utama |
| `--text-secondary` | `#c8bca9` | `#4c4a42` | Teks pendukung |
| `--text-tertiary` | `#8f897c` | `#8a8272` | Label, metadata |
| `--accent-bg` / `--accent-text` | krem / gelap | gelap / krem | Tombol utama |

### Brand & status

| Token | Dark | Light | Makna |
|-------|------|-------|-------|
| `--brand` | `#4ab5e0` | `#1f86b3` | Aksen utama, link, fokus |
| `--accent2` | `#fbbf24` | `#d97706` | Aksen sekunder |
| `--safe` | `#34d399` | `#059669` | HF aman |
| `--warning` | `#fbbf24` | `#d97706` | HF mendekati trigger |
| `--danger` | `#f87171` | `#dc2626` | HF di bawah trigger / gagal |

Setiap status punya pasangan `-bg` dan `-border` untuk badge/card.

### Pemetaan status HF

| Kondisi | Status | Token |
|---------|--------|-------|
| HF > trigger + 0.25 | Safe | `--safe` |
| trigger < HF ≤ trigger + 0.25 | Warning | `--warning` |
| HF ≤ trigger | Critical | `--danger` |

Regime Risk Engine (CALM / ELEVATED / STRESSED / CRISIS) memakai skala yang sama: `--safe`, `--brand`, `--warning`, `--danger`.

## 3. Tipografi

| Peran | Font | Catatan |
|-------|------|---------|
| Display (judul besar, angka hero) | Instrument Serif (`font-display`) | Weight normal, tracking sedikit rapat |
| Body & UI | Inter (`font-sans`) | 13–16px di dashboard |
| Angka, alamat, label teknis | JetBrains Mono (`font-mono`) | HF, harga, tx hash, badge uppercase |

## 4. Layout & komponen

- Radius: kontrol & card kecil 8–10px, card besar/landing hingga 24px, pill `9999px`.
- Dashboard: sidebar + topbar (`--sidebar-*`, `--topbar-*`), konten dengan padding 24px.
- Komponen dasar: `components/ui/` (shadcn/base-ui). Gunakan ulang sebelum membuat yang baru.
- Ikon: `lucide-react`, stroke 1.5–2.
- Grafik: Recharts; warna seri memakai token di atas.

## 5. Motion

- Library: `motion`. Gerak halus dan pendek (150–300ms) untuk hover/transisi.
- Efek ambient (partikel, glow, scenery) hanya di landing, di belakang konten, dan harus ringan.
- Jangan menganimasikan angka risiko secara dramatis; perubahan HF boleh transisi halus, bukan efek mencolok.

## 6. Copy & bahasa

- Selalu konsisten dengan positioning: "memperkecil peluang rugi", bukan "anti-likuidasi" atau "prediksi harga".
- Alasan dari Risk Engine ditampilkan apa adanya, singkat, dengan sumber.
- Risk disclosure tampil jelas di landing dan saat user mengaktifkan proteksi.

## 7. Guardrails

- Jangan hardcode warna baru; tambahkan token di `app/globals.css` bila perlu.
- Pastikan kedua tema terbaca (kontras teks minimal WCAG AA).
- Layout harus bekerja di lebar ponsel.
- Skill desain pihak ketiga (`.claude/skills/design-taste-frontend`, `brandkit`) boleh dipakai untuk eksplorasi, tetapi token dan karakter di dokumen ini yang berlaku.

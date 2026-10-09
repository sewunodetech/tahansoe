# 0009 — Satu pintu LLM: gateway OpenAI-compatible tunggal (`LLM_API_URL` + `LLM_API_KEY`)

- **Status:** Accepted (arahan user, 2026-10-09)
- **Tanggal:** 2026-10-09
- **Pengusul:** Engineering (Claude Code, atas arahan user)
- **Men-supersede sebagian:** [ADR 0008](0008-multi-provider-llm.md) §1 (Anthropic adapter sebagai jalur default), §2 (provider per peran lewat env), §6 (Gemini sebagai default R&D)

## Konteks

ADR 0008 memungkinkan banyak provider sekaligus. Akibatnya ada banyak kunci per provider di env (`GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `ANTHROPIC_API_KEY`, `LLM_PROVIDER_<NAMA>_*`) dan daftar provider di `settings.json`. Konfigurasinya jadi sulit dipahami. Router OpenAI-compatible (mis. Bynara, OpenRouter) sudah menyediakan banyak model di balik satu endpoint, jadi multi-provider di sisi engine tidak lagi diperlukan.

## Keputusan

1. **Satu pintu.** Engine memanggil LLM hanya lewat **satu endpoint OpenAI-compatible**. Env LLM cukup dua secret: `LLM_API_URL` (boleh ditulis sampai `/v1` atau `/v1/chat/completions`, akan dinormalisasi) dan `LLM_API_KEY`. Semua provider diperlakukan sama; berganti provider berarti mengganti dua nilai ini.
2. **Pemilihan model saat run.** `npm run research` mengambil daftar model dari `{LLM_API_URL}/models` beserta harga. Sumber harga: pricing URL di settings, format Bynara/OpenRouter yang dikenali, atau harga manual. CLI menampilkan estimasi biaya per run, per hari, dan per bulan, lalu user memilih model per peran. Pilihan **disimpan ke `settings.json`**.
3. **`settings.json` (non-rahasia)** menyimpan model per peran beserta fallback berupa *nama model saja* (tanpa awalan provider), pricing URL, harga manual, dan parameter estimasi. Tidak ada daftar provider dan tidak ada nama env key di settings.
4. **Fallback** tetap berantai per peran, tetapi antar-*model* di gateway yang sama (retry hanya untuk 429/5xx/timeout).
5. **Yang dihapus:** kunci per provider, `LLM_PROVIDER_<NAMA>_*`, `LLM_PROVIDER_NAME`, dan bagian `providers` di settings. `AnthropicProvider` tidak lagi dipakai di jalur produksi; model Claude diakses lewat router OpenAI-compatible jika diperlukan. Env lama `LLM_BASE_URL` tetap dibaca sebagai alias usang `LLM_API_URL` (dengan peringatan) selama satu rilis.
6. **Guardrail tidak berubah:** tanpa tools, output divalidasi zod, confidence ≤ 0,6, teks eksternal = data, budget harian.

## Alternatif yang dipertimbangkan

| Opsi | Kelebihan | Kekurangan |
|------|-----------|------------|
| Tetap multi-provider (ADR 0008) | Fallback lintas vendor | Banyak env key; konfigurasi membingungkan |
| **Satu gateway OpenAI-compatible** | Dua env saja, mudah dipahami, ganti provider = ganti URL/key | Ketersediaan bergantung pada satu gateway; fallback hanya antar model |

## Konsekuensi

- Positif: setup cukup dua env; pemilihan model dan biaya terlihat jelas saat run; pilihan tersimpan dan bisa diaudit di `settings.json`.
- Negatif: jika gateway mati, lapis riset berhenti. Ini dapat diterima karena graceful degradation (I6) membuat proteksi tetap jalan memakai sinyal deterministik dan policy statis.
- Invariant: I1–I8 tidak berubah. `LLM_API_KEY` hanya di env server dan tidak pernah di-log (I8).
- Dokumen yang perlu diperbarui: `apps/engine/README.md`, `.env.example`, `settings.example.json`, spec m3 §3.4/§3.9, architecture §7–§8, status.

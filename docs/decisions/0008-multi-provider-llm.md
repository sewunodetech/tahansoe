# 0008 — Multi-provider LLM: adapter OpenAI-compatible, model per peran, fallback berantai

- **Status:** Accepted (disetujui tim, 2026-10-08; provider R&D: Gemini)
- **Tanggal:** 2026-10-08
- **Pengusul:** Engineering (Claude Code, atas arahan tim)

## Konteks

[ADR 0004](0004-multi-agent-research-layer.md) menetapkan LLM berada di balik interface provider-agnostic (`apps/engine/src/llm/provider.ts`), dengan Anthropic sebagai implementasi pertama. Run nyata pertama (8 Okt 2026) gagal karena akun Anthropic tim belum memiliki kredit API. Langganan aplikasi (mis. Claude Pro) tidak memberi kredit API. Selama fase R&D, tim membutuhkan provider dengan **free tier** agar research agent bisa dijalankan dan dievaluasi tanpa biaya.

Sebagian besar provider (Google Gemini, Groq, OpenRouter, DeepSeek, Ollama lokal) menyediakan endpoint **OpenAI-compatible** (`/chat/completions`) dengan dukungan output JSON (`response_format`), sehingga satu adapter dapat melayani semuanya.

## Keputusan

1. Tambah adapter **`OpenAICompatibleProvider`** di `apps/engine/src/llm/` yang dikonfigurasi dengan `baseURL`, API key, dan nama model. Adapter ini melayani Gemini, Groq, OpenRouter, DeepSeek, dan Ollama. `AnthropicProvider` tetap ada.
2. **Provider dan model dipilih per peran lewat konfigurasi/env** (analyst, hawk/dove, assessor, reflector), bukan di-hardcode. Prinsip [spec §3.4](../specs/m3-research-agents.md#34-aturan-llm) tetap berlaku: model termurah yang lolos eval.
3. **Fallback berantai per peran:** jika provider pertama gagal dengan error yang bisa diulang (rate limit, 5xx, timeout), coba provider berikutnya dalam daftar. Error non-retryable (auth, kredit habis, 400) dicatat dengan jelas dan tidak diulang ke provider yang sama.
4. **Semua guardrail tetap sama**, apa pun providernya: tanpa tools, output divalidasi zod (gagal → dibuang), confidence dijepit ≤ 0,6, teks eksternal sebagai data, budget harian. Provider yang tidak mendukung JSON schema ketat tetap diminta JSON dan divalidasi zod di sisi kode.
5. **Budget** menghitung biaya per provider/model; model free tier dicatat $0 tetapi jumlah token tetap dicatat.
6. Provider default untuk R&D: **Google Gemini (free tier)**; cadangan: OpenRouter atau Groq. Produksi ditentukan ulang lewat eval (spec §6) dan tinjauan lisensi/kebijakan data.

## Alternatif yang dipertimbangkan

| Opsi | Kelebihan | Kekurangan |
|------|-----------|------------|
| Hanya Anthropic | Satu jalur, kualitas konsisten | Butuh kredit berbayar sejak R&D |
| Adapter native per provider | Akses fitur khusus tiap provider | Banyak kode untuk dirawat |
| Framework multi-provider (LangChain, dsb.) | Banyak integrasi siap pakai | Dependensi besar, abstraksi berlapis, sulit diaudit |
| **Satu adapter OpenAI-compatible + Anthropic** | Sedikit kode, banyak provider, mudah ditambah | Fitur khusus tiap provider tidak dipakai; dukungan JSON schema bervariasi |

## Konsekuensi

- Positif: research agent bisa dijalankan gratis selama R&D; tidak terkunci ke satu vendor; fallback meningkatkan ketersediaan.
- Negatif / biaya: kualitas dan kepatuhan JSON berbeda antar model, sehingga eval per model wajib sebelum dipakai di produksi. Free tier bisa memakai data untuk training. Untuk input berita publik ini dapat diterima, tetapi data pribadi/posisi user **tidak boleh** dikirim ke provider free tier.
- Dampak ke invariant keamanan: tidak ada perubahan pada I1–I8. API key tiap provider hanya di environment server (I8).
- Dokumen yang perlu diperbarui: spec m3-research-agents §3.4 & §3.9, architecture §7–§8, `apps/engine/.env.example`.

## Pembaruan (Oktober 2026)

Implementasi multi-provider diperluas untuk mendukung integrasi penyedia OpenAI-compatible generik secara fleksibel:
1. **Generic Endpoint via Env:** Pengembang dapat menghubungkan endpoint router apa pun (misalnya Bynara, DeepSeek direct, vLLM, Ollama remote) hanya dengan menetapkan `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_PROVIDER_NAME`, dan `LLM_MODEL`.
2. **Pemuatan Harga & Estimasi Biaya:** Ditambahkan utilitas pembacaan harga remote otomatis (`LLM_PRICING_URL` mendukung Bynara dan OpenRouter) serta override manual (`LLM_MODEL_PRICES`) untuk mengestimasi biaya riset per run, per hari, dan per bulan.
3. **CLI Interaktif:** Tersedia script `npm run research` untuk memilih model per peran secara interaktif dan `npm run models` untuk menginspeksi daftar model yang tersedia beserta harga.

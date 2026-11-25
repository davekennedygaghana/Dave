# CBT Harian • Ortopedi

Aplikasi web mandiri untuk latihan CBT harian residen ortopedi (persiapan ujian board).
Berjalan sepenuhnya di browser: **tanpa server, tanpa akun, tanpa API key, tanpa layanan AI**.
Progres disimpan di `localStorage` perangkat pengguna.

## Alur

Dashboard → Paket Hari Ini → Kerjakan Blok → Lihat Hasil → Review → Remedial

- **Paket Hari Ini** – hingga 1.000 soal single-best-answer unik per hari, dibagi maksimal 20 blok × 50 soal.
  Paket dibuat sekali per tanggal; prioritas: antrean remedial → belum pernah dikerjakan → paling lama tidak dilihat.
- **Kerjakan Blok** – navigasi nomor soal, tandai ragu, timer, simpan otomatis, pintasan keyboard (A–E/1–5, ←/→, R).
- **Hasil** – skor, benar/salah/kosong, waktu, rincian per domain.
- **Review** – kunci jawaban + pembahasan, filter Salah/Kosong/Ragu/Benar.
- **Remedial** – soal salah/kosong diulang dengan umpan balik langsung; jawaban benar mengeluarkannya dari antrean.
- **Data** – ekspor/impor progres, impor soal sendiri (JSON), reset.

## Bank soal

Soal bawaan (±1.500) dibangkitkan secara deterministik dari tabel fakta di `src/data/`
(klasifikasi, eponim, anatomi/approach, spine, sports, pediatri, hand, onkologi, arthroplasty,
foot & ankle, basic science). Bentuknya recall dua arah, bukan vignette klinis.
Menambah baris pada tabel otomatis menambah soal; soal vignette dapat diimpor lewat menu **Data**.

> Konten adalah bahan latihan dan perlu ditinjau oleh pengajar/ahli sebelum dipakai sebagai acuan.

## Pengembangan

```bash
npm install
npm run dev      # server pengembangan
npm test         # unit test (Vitest)
npm run build    # type-check + build produksi ke dist/
npm run preview  # pratinjau hasil build
```

`dist/` adalah situs statis (path relatif) dan dapat di-host di layanan static hosting mana pun.

## Struktur

- `src/lib/bank.ts` – pembangkit soal dari tabel fakta, validasi soal impor
- `src/lib/daily.ts` – pemilihan paket harian & pembagian blok
- `src/lib/store.ts` – state, penilaian, remedial, statistik
- `src/pages/` – halaman UI (React)
- `src/data/` – tabel fakta

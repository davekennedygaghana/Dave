# OSCE Harian Interaktif

Aplikasi web (PWA) untuk latihan OSCE harian residen ortopedi. Berjalan sepenuhnya di browser — **tanpa akun, tanpa server, tanpa API AI** — dan tetap bisa dipakai offline setelah dimuat sekali.

Alur setiap stasiun:

1. **Klinis** — baca vignette, tulis jawaban (autosave draft), lalu *Simpan jawaban & lanjut ke imaging* mengunci jawaban.
2. **Imaging / informasi lanjutan** — gambar asli (zoom, geser, pinch, layar penuh, navigasi antar-gambar dengan label netral “Gambar A — AP”) atau informasi lanjutan berbasis teks; tulis jawaban kedua, lalu *Simpan & buka pembahasan*.
3. **Review** — jawaban Anda berdampingan dengan kunci (berurutan di ponsel), pembahasan, sumber kasus, dan checklist berbobot per tahap yang Anda centang sendiri. Lalu lanjut ke stasiun berikutnya.

Di akhir sesi: skor total, skor per topik, stasiun yang perlu diulang (< 60% atau belum direview), dan butir checklist yang terlewat.

## Fitur utama

| Kebutuhan | Implementasi |
|---|---|
| Paket harian 25 stasiun | `src/lib/pack.ts` — seleksi seimbang antar-topik, deterministik per tanggal; jumlah aktual bila bank < 25, tanpa duplikasi |
| Paket baru pukul 09.00 WITA | `src/lib/cycle.ts` — UTC+8 tetap (Asia/Makassar, tanpa DST); sebelum 09.00 memakai siklus kemarin. Dihitung setiap aplikasi dibuka/kembali terlihat |
| Refresh tidak mengubah urutan | Sesi + snapshot stasiun disimpan sekali di IndexedDB (`addSessionIfAbsent`) |
| Impor bank baru tidak mengubah paket berjalan | Snapshot stasiun di dalam sesi; aset disimpan dengan kunci SHA-256 isi |
| Kunci tersembunyi | Komponen review (kunci, pembahasan, checklist, caption gambar) baru dirender setelah respons kedua dikunci |
| Progres | “Respons x/2N” (hanya yang dikunci; draft tidak dihitung), “Stasiun i/N”, “Selesai review r/N”, “Nilai checklist s/{jumlah bobot paket}” |
| Riwayat | Semua sesi tersimpan; sesi lama yang belum selesai tetap bisa dilanjutkan |
| Mulai ulang | Dengan konfirmasi; hanya menghapus progres sesi terpilih, urutan tetap |
| Cadangan | Ekspor/impor ZIP (sesi, jawaban, checklist, bank, aset) di halaman Riwayat |
| Offline | Service worker (`src/sw-template.js`, dibuat saat build) mem-precache seluruh aplikasi |
| Demo | 3 kasus sintetis bawaan (tanpa gambar medis) + contoh ZIP; dipisah dari paket sumber dan berlabel “Demo — bukan dari bank sumber” |

## Struktur folder

```
├── index.html                 # entri Vite
├── public/
│   ├── manifest.webmanifest   # manifest PWA
│   ├── icons/                 # icon.svg + PNG 192/512/maskable/apple-touch
│   └── examples/              # template JSON + contoh ZIP (diunduh dari Bank Kasus)
├── src/
│   ├── main.tsx, App.tsx      # bootstrap + navigasi (hash routing, aman untuk hosting statis)
│   ├── hooks.ts               # routing, URL aset, status online
│   ├── styles.css             # mobile-first, mode gelap
│   ├── sw-template.js         # template service worker
│   ├── data/demoStations.ts   # kasus demo sintetis
│   ├── components/            # PracticePage, SessionView, StationView, ImageViewer, ReviewView,
│   │                          # SummaryView, HistoryPage, BankPage, ConfirmDialog
│   └── lib/
│       ├── types.ts           # skema data
│       ├── cycle.ts           # siklus 09.00 WITA
│       ├── rng.ts             # PRNG ber-seed
│       ├── pack.ts            # komposisi paket + snapshot sesi
│       ├── progress.ts        # transisi tahap (draft → kunci → review)
│       ├── scoring.ts         # skor, penyebut, ringkasan
│       ├── validate.ts        # validasi entri stasiun
│       ├── importer.ts        # impor JSON/ZIP + aset
│       ├── db.ts              # IndexedDB
│       ├── sessions.ts        # sesi harian, riwayat, reset
│       ├── pending.ts         # penyangga draft sinkron saat halaman ditutup mendadak
│       └── backup.ts          # ekspor/impor cadangan
├── tests/                     # Vitest (unit + IndexedDB via fake-indexeddb)
├── e2e/                       # Playwright (build produksi, desktop + iPhone)
├── examples/                  # sumber contoh paket + template
├── docs/FORMAT-BANK.md        # skema bank kasus
└── scripts/                   # make-icons.mjs, build-examples.mjs
```

## Menjalankan

Prasyarat: Node.js 20+ dan npm.

```bash
npm install
npm run dev          # pengembangan: http://localhost:5173 (service worker tidak aktif di mode dev)
npm test             # tes unit (Vitest)
npm run build        # build produksi ke dist/ (termasuk dist/sw.js)
npm run preview      # sajikan dist/ di http://localhost:4173
npm run test:e2e     # tes E2E Playwright (build + preview otomatis)
```

Tes E2E butuh browser Chromium untuk Playwright (`npx playwright install chromium` bila belum ada).

Skrip tambahan:

- `npm run examples` — bangun ulang `public/examples/contoh-paket-demo.zip` dari `examples/contoh-paket-demo/` dan salin template.
- `npm run icons` — render ulang ikon PNG dari `public/icons/icon.svg` (butuh Playwright/Chromium).

## Deploy ke hosting statis

`dist/` adalah situs statis murni dengan path relatif (`base: './'`) dan hash routing, jadi bisa ditaruh di root maupun subfolder.

- **Netlify / Cloudflare Pages / Vercel**: build command `npm run build`, output directory `dist`.
- **GitHub Pages**: jalankan `npm run build`, lalu publikasikan isi `dist/` (mis. ke branch `gh-pages` atau lewat GitHub Actions `actions/upload-pages-artifact` dengan `path: dist`).
- **Server sendiri (nginx/Apache)**: salin isi `dist/`. Pastikan `sw.js` dan `index.html` dikirim dengan `Cache-Control: no-cache` agar pembaruan cepat terdeteksi.

PWA dan service worker membutuhkan **HTTPS** (kecuali `localhost`).

## Memasang sebagai aplikasi (PWA)

- **iPhone/iPad (Safari)**: buka situs → tombol *Bagikan* → *Tambah ke Layar Utama*.
- **Android (Chrome)**: menu ⋮ → *Instal aplikasi* / *Tambahkan ke layar utama*.
- **Desktop (Chrome/Edge)**: ikon instal di address bar, atau menu → *Instal OSCE Harian*.

Buka aplikasi sekali saat online (dan impor bank) agar semua file ter-cache; setelah itu latihan bisa dilakukan offline.

## Bank kasus

Format lengkap: **[docs/FORMAT-BANK.md](docs/FORMAT-BANK.md)**. Ringkasnya, impor `stations.json` atau ZIP berisi `stations.json` + folder aset (path relatif). Importer menolak entri tidak valid dengan alasan per kolom, menandai stasiun ber-imaging wajib yang asetnya hilang sebagai **belum layak**, dan tidak pernah mencampur demo ke paket sumber.

Folder referensi pengguna: <https://drive.google.com/drive/folders/1BXbaGikNjOevN6VgQH1-jwf4cwbA90uw?usp=drive_link>. Tautan ini hanya rujukan — aplikasi tidak membaca Drive dan tidak membutuhkannya untuk berjalan. Bank sumber belum disertakan di repositori: isi folder perlu dikonversi ke format JSON/ZIP di atas (dengan parafrase vignette, sitasi dokumen asli, serta hanya gambar yang diizinkan dan sudah dideidentifikasi).

## Penyimpanan & privasi

- Bank, aset, jawaban, checklist, dan riwayat disimpan di **IndexedDB browser ini**. Tidak ada sinkronisasi lintas perangkat; gunakan *Ekspor cadangan* untuk memindahkan progres.
- Menghapus data situs/browser akan menghapus progres — ekspor cadangan secara berkala.
- Jawaban tidak pernah dikirim ke mana pun dan tidak dinilai otomatis.
- **Catatan keamanan:** kunci jawaban tersimpan di data frontend dan hanya disembunyikan di antarmuka sampai waktu review. Aplikasi ini untuk latihan mandiri dan **tidak aman untuk ujian resmi**.

## Verifikasi yang tersedia

Tes unit (`tests/`) dan E2E (`e2e/`) mencakup: siklus tepat 09.00 WITA (08.59 vs 09.00, lintas tahun), urutan deterministik dan tetap setelah refresh, kunci tidak ada di DOM sebelum respons kedua dikunci, draft tidak dihitung sebagai respons, bank kecil tanpa duplikasi, penyebut skor dari rubrik paket, impor ZIP dengan aset hilang, entri tidak valid ditolak, impor baru tidak mengubah paket berjalan, sesi lama bisa dilanjutkan, reset hanya sesi terpilih, cadangan ekspor→impor, pemakaian offline lewat service worker, dan tata letak iPhone tanpa scroll horizontal.

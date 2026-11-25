# OrthoBoard — Reference Lab

Aplikasi web latihan ujian board ortopedi (CBT, VIVA, OSCE, esai) berbahasa Indonesia dengan target **1.000 soal per hari**, berbasis bank soal yang disusun dari referensi yang Anda unggah sendiri.

- **Mengerjakan soal tidak memanggil AI.** Bank soal disimpan di database; peserta cukup membuka situs dari laptop/HP.
- **Hanya soal berstatus _disetujui_** yang masuk paket resmi. Aplikasi tidak membawa bank soal medis apa pun — hanya **data DEMO** berisi teks pengisi (bukan materi medis).
- Zona waktu paket harian: **Asia/Makassar (WITA)**.

## 1. Struktur proyek

```
├── server/
│   ├── migrations/001_init.sql     Skema database (SQLite)
│   ├── src/
│   │   ├── index.ts                Entry server
│   │   ├── app.ts                  Seluruh rute API (peserta + admin) dan penyajian frontend
│   │   ├── config.ts  clock.ts     Environment, jam & tanggal WITA
│   │   ├── db.ts                   Koneksi, migrasi, aturan "layak paket"
│   │   ├── auth.ts                 Login, sesi cookie, peran admin/peserta
│   │   ├── demo.ts                 Pembuat data DEMO
│   │   ├── services/
│   │   │   ├── questions.ts        Validasi, impor, persetujuan, riwayat versi
│   │   │   ├── packages.ts         Paket harian 1.000 soal
│   │   │   ├── sessions.ts         Sesi latihan/ujian/remedial, penilaian
│   │   │   ├── progress.ts         Dashboard, progres, bank (peserta), cadangan
│   │   │   ├── sources.ts          Unggah PDF/ZIP, teks per halaman
│   │   │   └── ai.ts               Antrean draft AI (opsional)
│   │   └── scripts/                seed-demo.ts, set-password.ts
│   └── test/                       Pengujian otomatis (node:test)
├── client/                         React + TypeScript (Vite)
│   └── src/  App.tsx, api.ts, styles.css, components/, pages/
├── data-examples/
│   ├── import-example.json         Contoh format impor (placeholder)
│   └── demo-bank.json              66 soal DEMO (teks pengisi)
├── e2e/smoke.mjs                   Uji browser desktop + HP (Playwright)
├── .env.example   Dockerfile
```

Teknologi: React 19 + TypeScript + Vite · Node.js (Express 5) · SQLite (`better-sqlite3`, berkas di `DATA_DIR`).

## 2. Instalasi dan menjalankan

Prasyarat: Node.js ≥ 20 (diuji pada 22).

```bash
npm install
cp .env.example .env        # isi ADMIN_PASSWORD (min. 8 karakter)
npm run build
npm start                   # http://localhost:3000
```

Masuk dengan `ADMIN_USERNAME` / `ADMIN_PASSWORD`. Akun admin dibuat hanya saat database masih kosong; setelah itu ganti sandi dengan `npm run set-password -- admin <sandi-baru>` atau lewat Panel admin → Pengaturan.

Mode pengembangan (server + Vite dengan muat ulang otomatis, buka http://localhost:5173): `npm run dev`.

Mencoba alur tanpa referensi: `npm run seed:demo` memasukkan 66 soal **DEMO** dan menyalakan _Mode demo_. Matikan lagi di Panel admin → Pengaturan sebelum memakai bank resmi.

| Perintah | Fungsi |
|---|---|
| `npm run dev` | Server + frontend mode pengembangan |
| `npm run build` / `npm start` | Build produksi / jalankan |
| `npm test` | Pengujian backend |
| `npm run test:e2e` | Uji browser (lihat bagian 8) |
| `npm run seed:demo` | Data DEMO + mode demo |
| `npm run set-password -- <user> <sandi>` | Ganti sandi |

## 3. Database dan migrasi

Skema lengkap ada di [`server/migrations/001_init.sql`](server/migrations/001_init.sql). Migrasi dijalankan otomatis saat server menyala: setiap berkas `*.sql` yang belum tercatat di tabel `schema_migrations` dieksekusi berurutan. Untuk mengubah skema, tambahkan berkas baru (`002_….sql`); jangan mengubah berkas lama.

Tabel utama:

| Tabel | Isi |
|---|---|
| `questions`, `question_versions` | Bank soal (ID permanen, metadata, isi JSON, rujukan, status) dan salinan tiap versi |
| `sources`, `source_pages` | Sumber referensi dan cache teks per halaman PDF |
| `daily_packages`, `daily_package_items` | Paket harian per pengguna per tanggal WITA, urutan tetap |
| `question_exposures` | Soal yang pernah dibuka dalam mode soal baru |
| `sessions`, `session_items`, `attempts` | Sesi, urutan soalnya, jawaban dan nilai |
| `bookmarks`, `users`, `auth_sessions`, `settings`, `categories`, `ai_jobs` | Pendukung |

Jaminan di tingkat database: `UNIQUE(package_id, question_id)` (tidak ada ID ganda dalam paket), indeks unik `attempts(user_id, question_id) WHERE kind='new'` (satu soal tidak bisa terhitung dua kali sebagai soal baru), dan `CHECK` yang melarang soal DEMO berstatus disetujui.

**Cadangan server:** salin isi `DATA_DIR` (berkas `orthoboard.sqlite*` dan folder `sources/`, `assets/`) saat server berhenti, atau gunakan `sqlite3 orthoboard.sqlite ".backup cadangan.sqlite"`.

## 4. Cara kerja paket 1.000 soal

- Paket dibuat **saat pertama kali diakses** pada tanggal WITA tersebut — tidak ada scheduler/cron yang perlu dipasang, dan tidak ada proses latar belakang untuk pergantian tanggal.
- Isi: maksimal 1.000 soal unik yang layak (disetujui, bukan demo) dan **belum pernah dibuka** dalam mode soal baru. Urutannya disimpan sehingga tetap sama saat dimuat ulang.
- Bank < 1.000: paket berisi jumlah sebenarnya dan dashboard menampilkan kekurangannya. Tidak ada penggandaan soal.
- Soal yang disetujui pada hari yang sama ditambahkan **di akhir** paket hari itu (urutan lama tidak berubah).
- Ukuran sesi 10/25/50/100/250/500/1.000. Hanya satu sesi soal baru aktif pada satu waktu; sesi berikutnya melanjutkan paket yang sama dari soal yang belum dinilai.
- **Selesai = dijawab dan dinilai.** CBT dinilai otomatis; VIVA/OSCE/esai dihitung setelah Anda menyimpan nilai mandiri dari rubrik. Soal yang hanya dibuka tidak dihitung.
- Soal yang dibuka tetapi tidak dijawab muncul lagi di sesi berikutnya **pada tanggal paket yang sama**; setelah tanggal berganti, soal itu hanya tersedia lewat Remedial → "Dibuka tanpa nilai".
- Remedial (salah / ditandai / dibuka tanpa nilai) dicatat terpisah dan tidak menambah hitungan soal baru.

## 5. Memasukkan referensi, meninjau, dan menerbitkan soal

1. **Unggah sumber** — Panel admin → _Sumber referensi_: PDF, atau ZIP berisi beberapa PDF. Isi nama buku dan edisi (tombol _Ubah_). Berkas disimpan di `DATA_DIR/sources` dan hanya disajikan lewat rute yang memerlukan login (`REFERENCE_ACCESS=admin` secara bawaan).
2. **Susun bank soal** (pilih salah satu):
   - **Impor JSON** — tab _Impor bank soal_. Format di bawah. Soal masuk sebagai _draft_ / _perlu ditinjau_.
   - **Tulis manual** — tab _Tinjau & setujui_ → tombol _+ CBT / VIVA / OSCE / Esai_.
   - **Draft AI (opsional)** — tab _Draft AI_, hanya jika `ANTHROPIC_API_KEY` diisi di server. Lihat bagian 7.
3. **Tinjau** — buka soal, cocokkan dengan sumber (_Tampilkan teks halaman sumber_ / _Buka PDF di halaman …_), perbaiki, isi rujukan.
4. **Setujui** — _Simpan & setujui_, atau pilih banyak soal lalu _Setujui terpilih_. Persetujuan ditolak bila belum lengkap: topik, subtopik, bagian tubuh, nama buku, edisi, bab, halaman PDF, pembahasan, serta struktur format (CBT tepat lima pilihan A–E dengan satu kunci; rubrik/checklist minimal dua butir; dst.).
5. **Perbaikan setelah terbit** — menyimpan perubahan membuat versi baru (riwayat di bagian bawah editor). ID dan riwayat jawaban peserta tidak berubah. Untuk menarik soal, ubah statusnya menjadi draft/perlu ditinjau.

Nomor halaman cetak hanya ditampilkan sebagai "terverifikasi" bila Anda mencentangnya sendiri di editor; selain itu tampil "belum diverifikasi" atau "tidak dapat diverifikasi".

### Format impor JSON

Contoh lengkap empat format: [`data-examples/import-example.json`](data-examples/import-example.json).

```jsonc
{
  "questions": [
    {
      "id": "TRAUMA-CBT-0001",        // opsional; permanen. Bila kosong dibuat otomatis (OB-CBT-XXXXXXXX)
      "format": "cbt",                // cbt | viva | osce | essay
      "category": "trauma",           // slug atau nama kategori; nama baru dibuat otomatis
      "topic": "…", "subtopic": "…", "bodyRegion": "…",
      "difficulty": "sedang",         // mudah | sedang | sulit
      "status": "needs_review",       // draft | needs_review | approved (lihat catatan)
      "reference": {
        "bookTitle": "…", "edition": "…", "chapter": "…",
        "pdfPageStart": 123, "pdfPageEnd": 124,
        "printPage": null, "printPageVerified": false
      },
      "content": { /* sesuai format */ }
    }
  ]
}
```

| Format | Isi `content` |
|---|---|
| `cbt` | `stem`, `options[5]` (`key` A–E, `text`, `rationale` opsional), `answer`, `explanation` |
| `viva` | `stem`, `rubric[]` (`point`, `weight`), `explanation` |
| `osce` | `instructions`, `scenario`, `tasks[]`, `timeSeconds`, `checklist[]` (`item`, `weight`, `critical`), `image` (`null` atau `{asset, caption}`), `explanation` |
| `essay` | `stem`, `outline[]`, `rubric[]`, `explanation` |

Catatan impor:
- ID yang sudah ada **diperbarui sebagai versi baru**; yang identik dilewati. Progres tidak dihapus.
- `"status": "approved"` dari berkas diturunkan menjadi _perlu ditinjau_, kecuali Anda mencentang "Hormati status approved" — dan itu pun hanya berlaku untuk soal yang lolos pemeriksaan kelengkapan.
- Bila `bookTitle` + `edition` sama dengan sumber terunggah, soal otomatis ditautkan ke PDF-nya.
- ID berawalan `DEMO` atau `"demo": true` ditandai DEMO dan tidak dapat disetujui.

## 6. Environment

Lihat [`.env.example`](.env.example). Yang terpenting: `ADMIN_PASSWORD`, `DATA_DIR` (harus persisten), `COOKIE_SECURE=true` di balik HTTPS, `REFERENCE_ACCESS`, dan `ANTHROPIC_API_KEY` (opsional).

## 7. Integrasi AI (opsional, hanya untuk draft)

Nonaktif bila `ANTHROPIC_API_KEY` kosong; aplikasi tetap berfungsi penuh tanpa itu.

- Berjalan di backend (`server/src/services/ai.ts`); kunci hanya dibaca dari environment dan tidak pernah dikirim ke browser.
- Rentang halaman dipecah menjadi batch (`AI_PAGES_PER_BATCH`) dan masuk tabel antrean `ai_jobs`; diproses satu per satu di dalam proses server. Status (antre/diproses/selesai/gagal) dan pesan galat tampil di tab _Draft AI_; pekerjaan gagal dapat diulang. Pekerjaan yang terputus karena server mati dikembalikan ke antrean saat server menyala lagi.
- Model hanya menerima **teks halaman PDF yang Anda pilih** dan diinstruksikan untuk tidak menambah informasi di luar teks tersebut. Halaman tanpa teks (hasil pindai tanpa OCR) ditolak dengan pesan jelas — aplikasi ini tidak melakukan OCR.
- Semua hasil masuk sebagai **draft**; rujukan halaman di luar rentang dikosongkan dan ditandai _perlu ditinjau_; halaman cetak dari AI selalu "belum diverifikasi". Tidak ada yang masuk paket sebelum Anda setujui.
- Teks halaman dikirim ke API Anthropic. Pastikan itu sesuai dengan lisensi buku Anda.

## 8. Deployment

Kebutuhan: satu proses Node dan **satu volume persisten** untuk `DATA_DIR`. Karena memakai SQLite, jalankan **satu instance** saja (jangan autoscale ke banyak replika).

**VPS (Ubuntu) + Caddy untuk HTTPS**

```bash
git clone <repo> && cd <repo>
npm ci && npm run build
cp .env.example .env    # ADMIN_PASSWORD, DATA_DIR=/var/lib/orthoboard, COOKIE_SECURE=true
```

`/etc/systemd/system/orthoboard.service`:

```ini
[Unit]
Description=OrthoBoard Reference Lab
After=network.target
[Service]
WorkingDirectory=/opt/orthoboard
ExecStart=/usr/bin/node --env-file=.env dist/server/index.js
Restart=always
User=orthoboard
[Install]
WantedBy=multi-user.target
```

`/etc/caddy/Caddyfile`:

```
latihan.domainanda.id {
    reverse_proxy localhost:3000
    request_body { max_size 350MB }
}
```

**Docker / PaaS (Railway, Render, Fly.io, dsb.)**

```bash
docker build -t orthoboard .
docker run -d -p 3000:3000 -v orthoboard-data:/data \
  -e ADMIN_PASSWORD='…' -e COOKIE_SECURE=true orthoboard
```

Pada PaaS: pasang volume di `/data`, set environment di dasbor penyedia, jumlah instance = 1. Tanpa volume, database dan PDF hilang setiap deploy ulang.

Setelah online: masuk, ganti sandi, buat akun peserta bila perlu (Pengaturan → Pengguna), dan jadwalkan cadangan `DATA_DIR`.

## 9. Pengujian yang dijalankan

Dijalankan pada Node 22.23, Linux.

**`npm test` — 17 lulus, 0 gagal** (`server/test/`):

| Persyaratan | Pengujian |
|---|---|
| Tidak ada ID ganda dalam paket | bank 60 dan 1.200 soal → himpunan ID unik; `UNIQUE` di DB |
| Jawaban sama tidak dihitung dua kali | kirim ulang diabaikan; simpan setelah terkunci ditolak; indeks unik menolak percobaan kedua |
| Refresh mempertahankan sesi dan jawaban | sesi aktif, posisi, waktu, draf CBT/tertulis, dan tanda dibaca ulang dari DB |
| Pergantian tanggal mengikuti WITA | 23.59 WITA vs 00.00 WITA; paket baru dibuat saat diakses; soal yang sudah dibuka tidak ikut; paket lama utuh |
| Bank < 1.000 ditangani jujur | paket 60, kekurangan 940, sesi 100 berisi 60 |
| Bank > 1.000 → paket maks. 1.000 | 1.200 disetujui → 1.000 unik, urutan stabil |
| Remedial tidak mengubah soal baru selesai | hitungan paket dan jumlah "dibuka" tetap setelah remedial |
| Tambah/perbaiki soal tidak merusak progres | top-up di akhir paket; versi naik, percobaan lama utuh; soal ditarik tidak disajikan |
| Lain-lain | hanya soal disetujui masuk paket; DEMO tak bisa disetujui; mode ujian menyembunyikan kunci; nilai mandiri + critical step; impor; bank menyembunyikan soal belum dibuka; cadangan ekspor→impor; API: login, hak admin, anti-CSRF, pembatasan berkas PDF, unggah & ekstraksi teks PDF; antrean AI dengan model tiruan |

**`npm run test:e2e` — 8 langkah lulus** (Chromium via Playwright, terhadap build produksi dengan data DEMO): login; dashboard menampilkan target dan kekurangan; menjawab dengan keyboard; **muat ulang halaman dan tab baru** mempertahankan sesi/posisi/pilihan/tanda; penyelesaian sesi; sesi kedua tidak mengulang soal ternilai; semua halaman dan tab admin terbuka tanpa galat konsol; **emulasi iPhone 13**: navigasi bawah tampil, tidak ada luberan horizontal di semua halaman, tinggi pilihan jawaban ≥ 44 px.

Menjalankan sendiri: `npm i -D playwright && npx playwright install chromium`, jalankan server dengan data demo, lalu `BASE_URL=http://localhost:3000 E2E_PASS=<sandi admin> npm run test:e2e` (pengguna uji tidak boleh punya sesi aktif).

## 10. Batasan yang belum selesai / belum diuji

- **Belum ada bank soal medis.** Tidak ada referensi yang diunggah saat aplikasi ini dibuat, jadi isi bank sepenuhnya menunggu impor/penyusunan dan peninjauan Anda. Target 1.000 soal/hari hanya tercapai bila bank tervalidasi cukup besar (≈30.000 soal per bulan tanpa pengulangan).
- **Panggilan nyata ke API Anthropic belum diuji** (tidak ada kunci di lingkungan pembuatan). Antrean, validasi, dan penanganan galat diuji dengan model tiruan.
- **Image Docker belum di-build** di lingkungan pembuatan (daemon Docker tidak tersedia). Jalur `npm run build && npm start` sudah diuji.
- **Tidak ada OCR.** PDF hasil pindai tanpa lapisan teks tetap bisa diunggah dan dirujuk, tetapi teks halamannya kosong dan tidak bisa dipakai untuk draft AI.
- Uji HP dilakukan dengan emulasi Chromium, bukan perangkat fisik atau Safari iOS.
- Editor isi soal memakai JSON dengan pratinjau, bukan formulir per kolom.
- Timer sesi hanya berjalan saat tab terlihat (waktu aktif); batas waktu mode ujian karenanya bukan waktu dinding. Timer stasiun OSCE memakai waktu server sejak soal pertama dibuka.
- Satu sesi soal baru dan satu sesi remedial aktif per pengguna. Belum ada fitur lupa sandi lewat email, 2FA, atau pembatasan login lintas-instance (pembatas di memori).
- Mengganti `DAILY_TARGET` hanya berlaku untuk paket yang dibuat setelahnya.

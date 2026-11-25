# Format Bank Kasus (schemaVersion 1)

Bank diimpor dari halaman **Bank Kasus** sebagai:

- `stations.json` saja (untuk stasiun tanpa gambar), atau
- **ZIP** berisi `stations.json` + folder aset. `stations.json` boleh berada di root ZIP atau di satu subfolder; semua `assets[].path` dibaca **relatif terhadap folder `stations.json`**.

```
paket-saya.zip
├── stations.json
└── assets/
    └── trauma-001/
        ├── a.jpg
        └── b.jpg
```

Semua pemrosesan terjadi lokal di browser. Template: [`examples/stations.template.json`](../examples/stations.template.json). Contoh ZIP: [`examples/contoh-paket-demo/`](../examples/contoh-paket-demo) (dibangun menjadi `public/examples/contoh-paket-demo.zip` lewat `npm run examples`).

## Struktur berkas

```jsonc
{
  "schemaVersion": 1,                 // opsional; bila ada harus 1
  "bank": {
    "name": "Bank OSCE Ortopedi 2026", // ditampilkan di Bank Kasus
    "demo": false                      // true → semua stasiun diperlakukan sebagai demo
  },
  "stations": [ /* Station[] */ ]
}
```

Array stasiun polos (`[ {...}, {...} ]`) juga diterima.

## Station

| Kolom | Wajib | Keterangan |
|---|---|---|
| `id` | ✔ | ID **stabil** dan unik: huruf/angka/`.`/`_`/`-`, maks 80. Impor ulang dengan ID sama memperbarui stasiun di bank (paket yang sudah dimulai tidak berubah). |
| `topic` | ✔ | Slug topik. Label bawaan: `trauma`, `spine`, `sports`, `pediatrics`, `tumor`, `hand-upper-limb`, `foot-ankle`, `adult-reconstruction`, `infection`, `basic-science`, `other`. Slug lain tetap diterima dan ditampilkan apa adanya. |
| `title` | ✔ | **Judul netral** — jangan menyebut diagnosis. Importer memberi peringatan bila judul memuat kalimat pertama kunci tahap 1. |
| `vignette` | ✔ | Teks kasus (parafrase bila dari sumber). |
| `clinicalQuestion` | ✔ | Pertanyaan terbuka tahap 1. |
| `followupQuestion` | ✔ | Pertanyaan tahap 2 (interpretasi imaging atau informasi lanjutan). |
| `followupInfo` |  | Teks informasi lanjutan yang baru dibuka di tahap 2 (hasil lab, temuan tambahan, laporan radiologi tertulis). |
| `imagingRequired` | ✔ | `true` bila tahap 2 **membutuhkan** gambar. Jika `true` dan ada aset yang hilang/tidak valid, stasiun disimpan sebagai **belum layak** dan tidak masuk paket. |
| `assets` |  | Daftar aset (lihat bawah). Wajib tidak kosong bila `imagingRequired: true`. |
| `key.clinical`, `key.followup` | ✔ | Kunci per tahap. Hanya tampil setelah respons kedua dikunci. |
| `discussion` |  | `[{ "heading": "...", "body": "..." }]` — mis. Diagnosis, Interpretasi imaging, Diagnosis banding, Langkah awal, Tata laksana, Kesalahan umum. |
| `checklist.clinical`, `checklist.followup` | ✔ | Minimal satu butir per tahap. Butir: `{ "id": "c1", "text": "...", "weight": 2 }`. `weight` opsional (default **1**, harus > 0). Bentuk ringkas string `"teks butir"` juga diterima (id otomatis, bobot 1). |
| `source` | ✔ (non-demo) | `{ "document", "scenario"?, "page"?, "url"?, "paraphrased"?, "note"? }`. `document` = nama dokumen asli persis. `url` harus `http(s)://`. `paraphrased: true` menampilkan keterangan “Vignette diparafrasekan dari sumber”. |
| `demo` |  | `true` untuk kasus sintetis. Demo **tidak pernah** masuk paket harian berbasis sumber dan selalu berlabel “Demo — bukan dari bank sumber”. |

### Aset

```json
{ "path": "assets/trauma-001/a.jpg", "label": "AP", "modality": "X-ray", "caption": "Keterangan yang baru tampil saat review" }
```

- `path`: relatif, tanpa `/` di awal, tanpa `..`, tanpa URL. Nama file **tidak pernah** ditampilkan ke peserta (gambar dimuat sebagai `blob:`), tetapi tetap sebaiknya netral.
- `label`: label netral yang tampil sebelum review, sebagai “Gambar A — AP”, “Gambar B — Lateral”.
- `caption`: boleh mengungkap temuan; hanya tampil di tahap review.
- Format: jpg/jpeg, png, webp, gif, avif, svg.
- Aset disimpan di IndexedDB dengan kunci SHA-256 isinya, sehingga impor baru tidak menimpa gambar yang dipakai sesi lama.

**Hanya gunakan gambar asli yang diizinkan, sudah dideidentifikasi, dan berasal dari kasus terkait.** Jangan memakai gambar generik atau gambar buatan AI sebagai pengganti; bila gambar tidak tersedia, biarkan stasiun berstatus belum layak.

## Aturan validasi

| Kondisi | Hasil |
|---|---|
| Kolom wajib kosong, bobot ≤ 0, path aset absolut/`..`, `source.document` kosong pada non-demo, teks placeholder `GANTI:` | **Ditolak** dengan alasan per kolom |
| ID ganda di dalam satu file | Entri berikutnya **ditolak** |
| `imagingRequired: true` + file aset hilang/kosong/format tidak didukung | **Belum layak** (tersimpan, tidak masuk paket) |
| `imagingRequired: false` + file aset hilang | Aset dilewati, stasiun **layak** + peringatan |
| Tidak ada pembahasan / tidak ada gambar maupun `followupInfo` | Layak + peringatan |

## Komposisi paket harian

- Hanya stasiun **layak** dan **non-demo**.
- Target 25 stasiun unik; jika bank lebih kecil, jumlah aktual dipakai (tanpa duplikasi; dua tahap tidak dihitung sebagai dua stasiun).
- Seleksi seimbang antar-topik (round-robin) dengan pengacakan deterministik ber-seed tanggal siklus, lalu urutan akhir diacak dengan seed yang sama. Hasil tidak bergantung urutan impor.
- Snapshot stasiun disimpan bersama sesi saat sesi pertama kali dibuat.

import type { DB } from './db.js';
import { nowIso } from './clock.js';
import { importQuestions } from './services/questions.js';

/**
 * DATA DEMO — BUKAN SOAL TERVERIFIKASI DAN BUKAN MATERI MEDIS.
 * Isinya sengaja berupa teks pengisi tentang cara kerja aplikasi, supaya alur CBT/VIVA/OSCE/esai
 * dapat dicoba tanpa mengarang isi buku. Soal demo tidak dapat disetujui dan hanya muncul di paket
 * bila "Mode demo" dinyalakan di panel admin.
 */

const CATS = [
  'basic-science', 'anatomy', 'surgical-approaches', 'trauma', 'spine', 'sports',
  'adult-reconstruction', 'pediatric', 'hand-upper-extremity', 'foot-ankle', 'oncology', 'infection',
];
const LETTERS = ['A', 'B', 'C', 'D', 'E'];
const pad = (n: number) => String(n).padStart(3, '0');

export function buildDemoQuestions(counts = { cbt: 48, viva: 6, osce: 6, essay: 6 }) {
  const out: any[] = [];
  const base = (format: string, i: number, n: number) => ({
    id: `DEMO-${format.toUpperCase()}-${pad(i)}`,
    format,
    category: CATS[(n - 1) % CATS.length],
    topic: 'DEMO — alur aplikasi',
    subtopic: `Contoh ${format.toUpperCase()}`,
    bodyRegion: 'DEMO (tidak berlaku)',
    difficulty: ['mudah', 'sedang', 'sulit'][n % 3],
    demo: true,
    status: 'draft',
    reviewNote: 'DATA DEMO — bukan soal terverifikasi.',
    reference: { bookTitle: 'DEMO — bukan buku nyata', edition: 'DEMO', chapter: 'DEMO', pdfPageStart: null, printPage: null },
  });
  let n = 0;
  for (let i = 1; i <= counts.cbt; i++) {
    n++;
    const ans = LETTERS[(i * 3) % 5];
    out.push({
      ...base('cbt', i, n),
      content: {
        stem: `[DEMO] Soal contoh CBT nomor ${i}. Ini bukan soal medis. Untuk menguji alur penilaian otomatis, jawaban yang dianggap benar adalah pilihan ${ans}. Pilihan mana yang Anda pilih?`,
        options: LETTERS.map((k) => ({
          key: k,
          text: `Pilihan ${k} (teks pengisi demo ${i}-${k})`,
          rationale: k === ans ? 'Ditetapkan sebagai kunci pada data demo.' : 'Bukan kunci pada data demo.',
        })),
        answer: ans,
        explanation: `[DEMO] Pembahasan contoh: kunci soal demo ini ditetapkan ${ans}. Pada soal resmi, bagian ini berisi pembahasan berparafrasa dengan rujukan buku, edisi, bab, dan halaman.`,
      },
    });
  }
  for (let i = 1; i <= counts.viva; i++) {
    n++;
    out.push({
      ...base('viva', i, n),
      content: {
        stem: `[DEMO] VIVA contoh ${i}: jelaskan secara singkat tiga hal yang ditampilkan dashboard aplikasi ini.`,
        rubric: [
          { point: 'Menyebut progres paket harian (dinilai dari soal yang dijawab dan dinilai)', weight: 2 },
          { point: 'Menyebut jumlah bank soal dan soal baru tersisa', weight: 2 },
          { point: 'Menyebut nilai otomatis CBT terpisah dari nilai mandiri', weight: 1 },
        ],
        explanation: '[DEMO] Jawaban contoh hanya menjelaskan fitur aplikasi; bukan materi medis.',
      },
    });
  }
  for (let i = 1; i <= counts.osce; i++) {
    n++;
    out.push({
      ...base('osce', i, n),
      content: {
        instructions: `[DEMO] Stasiun contoh ${i}. Baca skenario, kerjakan tugas, lalu nilai diri Anda dengan checklist. Stasiun ini tidak memakai gambar.`,
        scenario: '[DEMO] Anda diminta mendemonstrasikan cara memakai ruang ujian aplikasi kepada rekan residen.',
        tasks: ['Tunjukkan cara menandai (bookmark) soal.', 'Tunjukkan cara berpindah soal dengan keyboard.', 'Jelaskan beda mode latihan dan mode ujian.'],
        timeSeconds: 120,
        checklist: [
          { item: 'Menandai soal dengan tombol Tandai atau tombol T', weight: 1, critical: false },
          { item: 'Berpindah soal dengan tombol panah kiri/kanan', weight: 1, critical: false },
          { item: 'Menjelaskan bahwa mode ujian menampilkan pembahasan setelah sesi selesai', weight: 2, critical: true },
        ],
        image: null,
        explanation: '[DEMO] Checklist contoh; critical step yang terlewat membuat stasiun dinilai belum lulus.',
      },
    });
  }
  for (let i = 1; i <= counts.essay; i++) {
    n++;
    out.push({
      ...base('essay', i, n),
      content: {
        stem: `[DEMO] Esai contoh ${i}: uraikan bagaimana aplikasi ini mencegah satu soal terhitung dua kali sebagai soal baru.`,
        outline: ['Paket harian menyimpan urutan soal unik per tanggal WITA.', 'Soal yang sudah dibuka tidak masuk paket baru lagi.', 'Remedial dicatat terpisah dari soal baru.'],
        rubric: [
          { point: 'Menjelaskan paket harian unik dan urutannya tetap', weight: 2 },
          { point: 'Menjelaskan pencatatan soal yang sudah dibuka', weight: 2 },
          { point: 'Menjelaskan remedial tidak menambah hitungan soal baru', weight: 2 },
        ],
        explanation: '[DEMO] Kerangka contoh mengenai cara kerja aplikasi; bukan materi medis.',
      },
    });
  }
  return out;
}

export function seedDemo(db: DB) {
  if (!db.prepare(`SELECT 1 FROM sources WHERE is_demo = 1`).get()) {
    db.prepare(`INSERT INTO sources (title, edition, authors, is_demo, notes, uploaded_at) VALUES (?, ?, ?, 1, ?, ?)`).run(
      'DEMO — bukan buku nyata', 'DEMO', 'DEMO', 'Sumber fiktif untuk data demo. Tidak ada berkas dan tidak ada halaman.', nowIso(),
    );
  }
  return importQuestions(db, buildDemoQuestions(), null, { origin: 'demo' });
}

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { DB } from '../db.js';
import { config } from '../config.js';
import { nowIso } from '../clock.js';
import { badRequest, notFound } from '../errors.js';
import { pagesText } from './sources.js';
import { importQuestions, type Format, FORMATS } from './questions.js';

/**
 * Integrasi AI (opsional) — hanya untuk MENYUSUN DRAFT dari teks halaman PDF yang diunggah.
 * Berjalan di backend; kunci API dibaca dari environment dan tidak pernah dikirim ke browser.
 * Semua hasil masuk sebagai status "draft" dan wajib ditinjau manusia sebelum disetujui.
 */

const common = {
  topic: z.string(),
  subtopic: z.string(),
  bodyRegion: z.string(),
  difficulty: z.enum(['mudah', 'sedang', 'sulit']),
  pdfPageStart: z.number().int(),
  pdfPageEnd: z.number().int(),
  printPage: z.string().nullable(),
};
const rubric = z.array(z.object({ point: z.string(), weight: z.number() }));

const outputSchemas = {
  cbt: z.object({
    ...common,
    content: z.object({
      stem: z.string(),
      options: z.array(z.object({ key: z.enum(['A', 'B', 'C', 'D', 'E']), text: z.string(), rationale: z.string() })),
      answer: z.enum(['A', 'B', 'C', 'D', 'E']),
      explanation: z.string(),
    }),
  }),
  viva: z.object({ ...common, content: z.object({ stem: z.string(), rubric, explanation: z.string() }) }),
  osce: z.object({
    ...common,
    content: z.object({
      instructions: z.string(),
      scenario: z.string(),
      tasks: z.array(z.string()),
      timeSeconds: z.number().int(),
      checklist: z.array(z.object({ item: z.string(), weight: z.number(), critical: z.boolean() })),
      explanation: z.string(),
    }),
  }),
  essay: z.object({ ...common, content: z.object({ stem: z.string(), outline: z.array(z.string()), rubric, explanation: z.string() }) }),
};

export interface GenerateRequest {
  format: Format;
  count: number;
  bookTitle: string;
  edition: string;
  chapter: string;
  pages: { page: number; text: string }[];
}
export interface GenerateResult {
  questions: any[];
  note: string;
}
export type Generator = (req: GenerateRequest) => Promise<GenerateResult>;

const FORMAT_GUIDE: Record<Format, string> = {
  cbt: 'CBT: vignette/pertanyaan dengan tepat lima pilihan (A–E) dan satu jawaban terbaik. Isi "rationale" tiap pilihan hanya bila alasannya didukung teks; jika tidak, kosongkan.',
  viva: 'VIVA: pertanyaan lisan terstruktur dengan rubrik (poin jawaban + bobot angka).',
  osce: 'OSCE: instruksi peserta, skenario, daftar tugas, waktu stasiun (detik), dan checklist penilaian berbobot; tandai critical step dengan critical=true. Jangan membuat stasiun yang bergantung pada gambar.',
  essay: 'ESAI: pertanyaan uraian, kerangka jawaban ideal (outline), dan rubrik berbobot.',
};

const SYSTEM = `Anda membantu menyusun DRAFT soal latihan ujian board ortopedi berbahasa Indonesia untuk ditinjau oleh dokter.
Aturan mutlak:
- Gunakan HANYA informasi yang tertulis pada teks halaman yang diberikan. Jangan menambah fakta medis dari pengetahuan lain.
- Tulis soal dan pembahasan dengan parafrasa orisinal; jangan menyalin kalimat panjang dari teks.
- Setiap soal wajib mencantumkan nomor halaman PDF (pdfPageStart–pdfPageEnd) tempat jawabannya didukung, sesuai penanda [HALAMAN PDF n].
- printPage diisi hanya jika nomor halaman cetak terlihat jelas pada teks halaman tersebut (header/footer); jika tidak yakin, isi null. Jangan menebak.
- Jika teks tidak cukup atau tidak terbaca untuk membuat soal yang jawabannya didukung, buat lebih sedikit soal (boleh nol) dan jelaskan alasannya di "note".
- Istilah medis baku boleh tetap dalam bahasa Inggris.`;

async function anthropicGenerator(req: GenerateRequest): Promise<GenerateResult> {
  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  const schema = z.object({ questions: z.array(outputSchemas[req.format]), note: z.string() });
  const pagesBlock = req.pages.map((p) => `[HALAMAN PDF ${p.page}]\n${p.text}`).join('\n\n');
  const response = await client.messages.parse({
    model: config.aiModel,
    max_tokens: 16000,
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: `Sumber: ${req.bookTitle}${req.edition ? `, edisi ${req.edition}` : ''}${req.chapter ? `, bab: ${req.chapter}` : ''}.

<teks_halaman>
${pagesBlock}
</teks_halaman>

Buat paling banyak ${req.count} soal berformat berikut, masing-masing menguji konsep yang berbeda:
${FORMAT_GUIDE[req.format]}`,
      },
    ],
    output_config: { format: zodOutputFormat(schema) },
  });
  if (response.stop_reason === 'refusal') throw new Error('Model menolak permintaan ini (stop_reason: refusal).');
  if (response.stop_reason === 'max_tokens') throw new Error('Keluaran model terpotong (max_tokens). Kurangi jumlah soal per batch.');
  if (!response.parsed_output) throw new Error('Keluaran model tidak sesuai skema.');
  return response.parsed_output as GenerateResult;
}

let generator: Generator = anthropicGenerator;
let forcedEnabled = false;
/** Untuk pengujian: mengganti pemanggil model dengan tiruan. */
export function setGenerator(fn: Generator | null) {
  generator = fn ?? anthropicGenerator;
  forcedEnabled = !!fn;
}

export const aiEnabled = () => forcedEnabled || !!config.anthropicApiKey;

export function aiStatus(db: DB) {
  const counts = db.prepare(`SELECT status, COUNT(*) n FROM ai_jobs GROUP BY status`).all() as any[];
  return {
    configured: aiEnabled(),
    model: aiEnabled() ? config.aiModel : null,
    pagesPerBatch: config.aiPagesPerBatch,
    workerRunning,
    queue: Object.fromEntries(counts.map((c) => [c.status, c.n])),
  };
}

export function listJobs(db: DB, limit = 100) {
  return db
    .prepare(
      `SELECT j.id, j.source_id AS sourceId, s.title AS sourceTitle, j.page_start AS pageStart, j.page_end AS pageEnd, j.format, j.category, j.chapter, j.count,
              j.status, j.attempts, j.created_count AS createdCount, j.error, j.created_at AS createdAt, j.started_at AS startedAt, j.finished_at AS finishedAt
       FROM ai_jobs j JOIN sources s ON s.id = j.source_id ORDER BY j.id DESC LIMIT ?`,
    )
    .all(limit);
}

/** Memecah rentang halaman menjadi beberapa pekerjaan (batch) dan memasukkannya ke antrean. */
export function enqueueJobs(db: DB, userId: number, o: { sourceId: number; pageStart: number; pageEnd: number; format: string; category: string; chapter?: string; countPerBatch: number }) {
  if (!aiEnabled()) throw badRequest('Integrasi AI belum dikonfigurasi (ANTHROPIC_API_KEY kosong di server).');
  const src = db.prepare('SELECT id, page_count, stored_name FROM sources WHERE id = ?').get(o.sourceId) as any;
  if (!src) throw notFound('Sumber');
  if (!src.stored_name) throw badRequest('Sumber ini tidak memiliki berkas PDF.');
  if (!(FORMATS as readonly string[]).includes(o.format)) throw badRequest('Format tidak dikenal.');
  if (!db.prepare('SELECT 1 FROM categories WHERE slug = ?').get(o.category)) throw badRequest('Kategori tidak dikenal.');
  const start = Math.floor(o.pageStart), end = Math.floor(o.pageEnd), count = Math.floor(o.countPerBatch);
  if (!(start >= 1) || !(end >= start)) throw badRequest('Rentang halaman tidak valid.');
  if (src.page_count && end > src.page_count) throw badRequest(`Sumber hanya memiliki ${src.page_count} halaman.`);
  if (end - start + 1 > 400) throw badRequest('Maksimal 400 halaman per permintaan.');
  if (!(count >= 1 && count <= 20)) throw badRequest('Jumlah soal per batch harus 1–20.');
  const ids: number[] = [];
  const ins = db.prepare(`INSERT INTO ai_jobs (source_id, page_start, page_end, format, category, chapter, count, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  db.transaction(() => {
    for (let p = start; p <= end; p += config.aiPagesPerBatch) {
      const r = ins.run(o.sourceId, p, Math.min(end, p + config.aiPagesPerBatch - 1), o.format, o.category, (o.chapter ?? '').trim(), count, userId, nowIso());
      ids.push(Number(r.lastInsertRowid));
    }
  })();
  kick(db);
  return { jobIds: ids };
}

export function cancelJob(db: DB, id: number) {
  const r = db.prepare(`UPDATE ai_jobs SET status = 'cancelled', finished_at = ? WHERE id = ? AND status = 'queued'`).run(nowIso(), id);
  if (!r.changes) throw badRequest('Hanya pekerjaan berstatus antre yang dapat dibatalkan.');
}

export function retryJob(db: DB, id: number) {
  const r = db.prepare(`UPDATE ai_jobs SET status = 'queued', error = NULL, attempts = 0, finished_at = NULL WHERE id = ? AND status IN ('failed','cancelled')`).run(id);
  if (!r.changes) throw badRequest('Hanya pekerjaan gagal/dibatalkan yang dapat diulang.');
  kick(db);
}

const MAX_ATTEMPTS = 3;

export async function processJob(db: DB, job: any): Promise<void> {
  const src = db.prepare('SELECT title, edition FROM sources WHERE id = ?').get(job.source_id) as any;
  const pages = await pagesText(db, job.source_id, job.page_start, job.page_end);
  const readable = pages.filter((p) => p.text.length >= 80);
  if (readable.length === 0) {
    throw Object.assign(new Error('Teks halaman tidak terbaca (kemungkinan PDF hasil pindai tanpa lapisan teks/OCR). Tidak ada soal dibuat.'), { permanent: true });
  }
  const result = await generator({ format: job.format, count: job.count, bookTitle: src.title, edition: src.edition, chapter: job.chapter, pages: readable });
  const pageSet = new Set(readable.map((p) => p.page));
  const items = (result.questions ?? []).slice(0, job.count).map((q: any) => {
    const inRange = pageSet.has(q.pdfPageStart) && pageSet.has(q.pdfPageEnd ?? q.pdfPageStart);
    return {
      format: job.format,
      category: job.category,
      topic: q.topic,
      subtopic: q.subtopic,
      bodyRegion: q.bodyRegion,
      difficulty: q.difficulty,
      // Halaman di luar rentang yang diberikan = rujukan tidak dapat dipercaya -> wajib ditinjau
      status: inRange ? 'draft' : 'needs_review',
      reviewNote: inRange
        ? 'Draft hasil AI — belum diverifikasi terhadap sumber.'
        : 'Draft hasil AI merujuk halaman di luar rentang yang diberikan; rujukan halaman dikosongkan dan harus diperiksa.',
      reference: {
        sourceId: job.source_id,
        bookTitle: src.title,
        edition: src.edition,
        chapter: job.chapter,
        pdfPageStart: inRange ? q.pdfPageStart : null,
        pdfPageEnd: inRange ? q.pdfPageEnd : null,
        printPage: q.printPage ?? null,
        printPageVerified: false, // halaman cetak dari AI selalu belum terverifikasi
      },
      content: q.content,
    };
  });
  const report = importQuestions(db, items, job.created_by, { origin: 'ai' });
  const rejected = report.items.filter((i) => i.result === 'rejected');
  const notes = [result.note, rejected.length ? `${rejected.length} keluaran ditolak validasi: ${rejected.map((r) => r.messages.join('; ')).join(' | ')}` : ''].filter(Boolean).join(' ');
  db.prepare(`UPDATE ai_jobs SET status = 'done', created_count = ?, error = ?, finished_at = ? WHERE id = ?`).run(report.created, notes || null, nowIso(), job.id);
}

let workerRunning = false;

/** Memproses antrean satu per satu sampai kosong. Aman dipanggil berulang. */
export async function runQueue(db: DB): Promise<void> {
  if (workerRunning) return;
  workerRunning = true;
  try {
    for (;;) {
      if (!aiEnabled()) break;
      const job = db.prepare(`SELECT * FROM ai_jobs WHERE status = 'queued' ORDER BY id LIMIT 1`).get() as any;
      if (!job) break;
      db.prepare(`UPDATE ai_jobs SET status = 'running', attempts = attempts + 1, started_at = ? WHERE id = ?`).run(nowIso(), job.id);
      try {
        await processJob(db, job);
      } catch (e: any) {
        const transient = !e?.permanent && (e instanceof Anthropic.RateLimitError || e instanceof Anthropic.APIConnectionError || e instanceof Anthropic.InternalServerError);
        const message = String(e?.message ?? e).slice(0, 1000);
        if (transient && job.attempts + 1 < MAX_ATTEMPTS) {
          db.prepare(`UPDATE ai_jobs SET status = 'queued', error = ? WHERE id = ?`).run(`Percobaan ${job.attempts + 1} gagal sementara: ${message}`, job.id);
          await new Promise((r) => setTimeout(r, 15_000));
        } else {
          db.prepare(`UPDATE ai_jobs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?`).run(message, nowIso(), job.id);
        }
      }
    }
  } finally {
    workerRunning = false;
  }
}

function kick(db: DB) {
  void runQueue(db).catch((e) => console.error('[ai] worker error', e));
}

/** Dipanggil saat server menyala: pekerjaan yang terputus dikembalikan ke antrean, lalu antrean dijalankan. */
export function startWorker(db: DB) {
  db.prepare(`UPDATE ai_jobs SET status = 'queued' WHERE status = 'running'`).run();
  kick(db);
}

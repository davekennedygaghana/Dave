import crypto from 'node:crypto';
import { z } from 'zod';
import type { DB } from '../db.js';
import { nowIso } from '../clock.js';

export const FORMATS = ['cbt', 'viva', 'osce', 'essay'] as const;
export type Format = (typeof FORMATS)[number];
export const STATUSES = ['draft', 'needs_review', 'approved'] as const;
export type Status = (typeof STATUSES)[number];
export const DIFFICULTIES = ['mudah', 'sedang', 'sulit'] as const;

// ---------- Skema isi soal per format (struktur; kelengkapan diperiksa saat persetujuan) ----------

const text = z.string().trim();
const rubricItem = z.object({ point: text, weight: z.number().positive().max(100) });

export const contentSchemas = {
  cbt: z.object({
    stem: text,
    options: z.array(z.object({ key: z.string().trim().toUpperCase(), text, rationale: text.optional().default('') })).min(2).max(8),
    answer: z.string().trim().toUpperCase(),
    explanation: text.default(''),
  }),
  viva: z.object({
    stem: text,
    rubric: z.array(rubricItem).default([]),
    explanation: text.default(''),
  }),
  osce: z.object({
    instructions: text,
    scenario: text.default(''),
    tasks: z.array(text).default([]),
    timeSeconds: z.number().int().min(30).max(3600).default(420),
    checklist: z.array(z.object({ item: text, weight: z.number().positive().max(100), critical: z.boolean().default(false) })).default([]),
    image: z.object({ asset: text, caption: text.default('') }).nullable().optional().default(null),
    explanation: text.default(''),
  }),
  essay: z.object({
    stem: text,
    outline: z.array(text).default([]),
    rubric: z.array(rubricItem).default([]),
    explanation: text.default(''),
  }),
} as const;

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/;

const referenceSchema = z
  .object({
    sourceId: z.number().int().positive().nullable().optional(),
    bookTitle: text.default(''),
    edition: text.default(''),
    chapter: text.default(''),
    pdfPageStart: z.number().int().positive().nullable().optional(),
    pdfPageEnd: z.number().int().positive().nullable().optional(),
    printPage: z.union([z.string(), z.number()]).nullable().optional(),
    printPageVerified: z.boolean().optional().default(false),
  })
  .default({ bookTitle: '', edition: '', chapter: '', printPageVerified: false });

const inputSchema = z.object({
  id: z.string().regex(idPattern, 'ID hanya boleh huruf, angka, titik, garis bawah, tanda hubung (3–64 karakter)').optional(),
  format: z.enum(FORMATS),
  category: text.min(1, 'kategori wajib diisi'),
  topic: text.default(''),
  subtopic: text.default(''),
  bodyRegion: text.default(''),
  difficulty: z.enum(DIFFICULTIES).default('sedang'),
  status: z.enum(STATUSES).optional(),
  demo: z.boolean().optional().default(false),
  reviewNote: text.optional().default(''),
  reference: referenceSchema,
  content: z.unknown(),
});

export interface QuestionInput {
  id?: string;
  format: Format;
  category: string;
  topic: string;
  subtopic: string;
  bodyRegion: string;
  difficulty: (typeof DIFFICULTIES)[number];
  status?: Status;
  demo: boolean;
  reviewNote: string;
  reference: {
    sourceId: number | null;
    bookTitle: string;
    edition: string;
    chapter: string;
    pdfPageStart: number | null;
    pdfPageEnd: number | null;
    printPage: string | null;
    printPageVerified: boolean;
  };
  content: any;
}

export interface Question extends QuestionInput {
  id: string;
  status: Status;
  origin: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
}

function zodMessages(err: z.ZodError): string[] {
  return err.issues.map((i) => `${i.path.join('.') || 'soal'}: ${i.message}`);
}

/** Memeriksa struktur masukan. Mengembalikan soal ternormalisasi atau daftar galat. */
export function parseQuestionInput(raw: unknown): { ok: true; value: QuestionInput } | { ok: false; errors: string[] } {
  const base = inputSchema.safeParse(raw);
  if (!base.success) return { ok: false, errors: zodMessages(base.error) };
  const b = base.data;
  const content = contentSchemas[b.format].safeParse(b.content);
  if (!content.success) return { ok: false, errors: zodMessages(content.error).map((m) => `content.${m}`) };
  const r = b.reference;
  return {
    ok: true,
    value: {
      id: b.id,
      format: b.format,
      category: b.category,
      topic: b.topic,
      subtopic: b.subtopic,
      bodyRegion: b.bodyRegion,
      difficulty: b.difficulty,
      status: b.status,
      demo: b.demo || (b.id ?? '').toUpperCase().startsWith('DEMO'),
      reviewNote: b.reviewNote,
      reference: {
        sourceId: r.sourceId ?? null,
        bookTitle: r.bookTitle,
        edition: r.edition,
        chapter: r.chapter,
        pdfPageStart: r.pdfPageStart ?? null,
        pdfPageEnd: r.pdfPageEnd ?? r.pdfPageStart ?? null,
        printPage: r.printPage == null || String(r.printPage).trim() === '' ? null : String(r.printPage).trim(),
        printPageVerified: !!r.printPageVerified && r.printPage != null,
      },
      content: content.data,
    },
  };
}

const sumWeights = (items: { weight: number }[]) => items.reduce((a, b) => a + b.weight, 0);

/** Daftar kekurangan yang mencegah soal disetujui. Kosong = boleh disetujui. */
export function approvalProblems(q: QuestionInput): string[] {
  const p: string[] = [];
  if (q.demo) p.push('Soal DEMO tidak dapat disetujui sebagai soal resmi.');
  if (!q.topic) p.push('Topik belum diisi.');
  if (!q.subtopic) p.push('Subtopik belum diisi.');
  if (!q.bodyRegion) p.push('Bagian tubuh belum diisi.');
  const r = q.reference;
  if (!r.bookTitle) p.push('Nama buku belum diisi.');
  if (!r.edition) p.push('Edisi buku belum diisi.');
  if (!r.chapter) p.push('Bab belum diisi.');
  if (!r.pdfPageStart) p.push('Halaman PDF belum diisi.');
  if (r.pdfPageStart && r.pdfPageEnd && r.pdfPageEnd < r.pdfPageStart) p.push('Rentang halaman PDF tidak valid.');
  const c = q.content;
  if (!c.explanation) p.push('Pembahasan belum diisi.');
  if (q.format === 'cbt') {
    if (!c.stem) p.push('Pertanyaan belum diisi.');
    const keys = c.options.map((o: any) => o.key);
    if (c.options.length !== 5) p.push('CBT wajib memiliki tepat lima pilihan jawaban.');
    if (keys.join('') !== 'ABCDE'.slice(0, keys.length)) p.push('Kunci pilihan harus berurutan A–E.');
    if (c.options.some((o: any) => !o.text)) p.push('Ada pilihan jawaban yang kosong.');
    if (new Set(c.options.map((o: any) => o.text.toLowerCase())).size !== c.options.length) p.push('Ada pilihan jawaban yang kembar.');
    if (!keys.includes(c.answer)) p.push('Kunci jawaban tidak cocok dengan pilihan.');
  } else if (q.format === 'viva' || q.format === 'essay') {
    if (!c.stem) p.push('Pertanyaan belum diisi.');
    if (c.rubric.length < 2) p.push('Rubrik minimal dua poin.');
    if (c.rubric.some((x: any) => !x.point)) p.push('Ada poin rubrik yang kosong.');
    if (q.format === 'essay' && c.outline.length < 1) p.push('Kerangka jawaban ideal belum diisi.');
  } else if (q.format === 'osce') {
    if (!c.instructions) p.push('Instruksi peserta belum diisi.');
    if (!c.scenario) p.push('Skenario belum diisi.');
    if (c.tasks.length < 1) p.push('Tugas stasiun belum diisi.');
    if (c.checklist.length < 2) p.push('Checklist minimal dua butir.');
    if (c.checklist.some((x: any) => !x.item)) p.push('Ada butir checklist yang kosong.');
  }
  return p;
}

export function maxScore(format: Format, content: any): number {
  if (format === 'cbt') return 1;
  return sumWeights(format === 'osce' ? content.checklist : content.rubric);
}

// ---------- Baris DB <-> objek ----------

export function rowToQuestion(row: any): Question {
  return {
    id: row.id,
    format: row.format,
    category: row.category,
    topic: row.topic,
    subtopic: row.subtopic,
    bodyRegion: row.body_region,
    difficulty: row.difficulty,
    status: row.status,
    demo: !!row.is_demo,
    reviewNote: row.review_note,
    reference: {
      sourceId: row.source_id,
      bookTitle: row.book_title,
      edition: row.edition,
      chapter: row.chapter,
      pdfPageStart: row.pdf_page_start,
      pdfPageEnd: row.pdf_page_end,
      printPage: row.print_page,
      printPageVerified: !!row.print_page_verified,
    },
    content: JSON.parse(row.content),
    origin: row.origin,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    approvedAt: row.approved_at,
  };
}

export function getQuestion(db: DB, id: string): Question | null {
  const row = db.prepare('SELECT * FROM questions WHERE id = ?').get(id);
  return row ? rowToQuestion(row) : null;
}

/** Bagian soal yang aman ditampilkan sebelum dijawab (tanpa kunci, rubrik, pembahasan). */
export function publicContent(format: Format, c: any) {
  switch (format) {
    case 'cbt':
      return { stem: c.stem, options: c.options.map((o: any) => ({ key: o.key, text: o.text })) };
    case 'viva':
      return { stem: c.stem };
    case 'osce':
      return { instructions: c.instructions, scenario: c.scenario, tasks: c.tasks, timeSeconds: c.timeSeconds, image: c.image ?? null };
    case 'essay':
      return { stem: c.stem };
  }
}

export function stemOf(format: Format, c: any): string {
  return format === 'osce' ? c.scenario || c.instructions : c.stem;
}

function slugify(s: string) {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'other';
}

/** Mencocokkan kategori dengan slug/nama; kategori baru dibuat otomatis (dapat diperluas). */
export function resolveCategory(db: DB, value: string): string {
  const v = value.trim();
  const hit = db.prepare('SELECT slug FROM categories WHERE slug = ? OR lower(name) = lower(?)').get(slugify(v), v) as any;
  if (hit) return hit.slug;
  const slug = slugify(v);
  db.prepare('INSERT INTO categories (slug, name, sort_order) VALUES (?, ?, 500)').run(slug, v);
  return slug;
}

function newId(db: DB, format: Format): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  for (;;) {
    const rnd = Array.from(crypto.randomBytes(8), (b) => alphabet[b % alphabet.length]).join('');
    const id = `OB-${format.toUpperCase()}-${rnd}`;
    if (!db.prepare('SELECT 1 FROM questions WHERE id = ?').get(id)) return id;
  }
}

function resolveSource(db: DB, q: QuestionInput) {
  const r = q.reference;
  if (r.sourceId) {
    const s = db.prepare('SELECT id, title, edition FROM sources WHERE id = ?').get(r.sourceId) as any;
    if (!s) {
      r.sourceId = null;
    } else {
      if (!r.bookTitle) r.bookTitle = s.title;
      if (!r.edition) r.edition = s.edition;
    }
  } else if (r.bookTitle) {
    const s = db.prepare('SELECT id FROM sources WHERE lower(title) = lower(?) AND lower(edition) = lower(?)').get(r.bookTitle, r.edition) as any;
    if (s) r.sourceId = s.id;
  }
}

function snapshot(db: DB, id: string, userId: number | null, note: string) {
  const q = getQuestion(db, id)!;
  db.prepare('INSERT INTO question_versions (question_id, version, snapshot, change_note, changed_by, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    id,
    q.version,
    JSON.stringify(q),
    note,
    userId,
    nowIso(),
  );
}

/** Menentukan status akhir: "disetujui" hanya jika lolos pemeriksaan; jika tidak, turun menjadi "perlu ditinjau". */
function settleStatus(q: QuestionInput, wanted: Status): { status: Status; note: string } {
  if (wanted !== 'approved') return { status: wanted, note: q.reviewNote };
  const problems = approvalProblems(q);
  if (problems.length === 0) return { status: 'approved', note: '' };
  return { status: 'needs_review', note: `Tidak dapat disetujui: ${problems.join(' ')}` };
}

export function createQuestion(db: DB, input: QuestionInput, userId: number | null, origin: string, wanted: Status = 'draft'): Question {
  const t = nowIso();
  const id = input.id ?? newId(db, input.format);
  const category = resolveCategory(db, input.category);
  resolveSource(db, input);
  const { status, note } = settleStatus(input, wanted);
  const r = input.reference;
  db.prepare(
    `INSERT INTO questions (id, format, category, topic, subtopic, body_region, difficulty, status, is_demo, content,
       source_id, book_title, edition, chapter, pdf_page_start, pdf_page_end, print_page, print_page_verified,
       review_note, origin, version, created_at, updated_at, approved_at, approved_by)
     VALUES (?,?,?,?,?,?,?,?,?,?, ?,?,?,?,?,?,?,?, ?,?,1,?,?,?,?)`,
  ).run(
    id, input.format, category, input.topic, input.subtopic, input.bodyRegion, input.difficulty, status, input.demo ? 1 : 0, JSON.stringify(input.content),
    r.sourceId, r.bookTitle, r.edition, r.chapter, r.pdfPageStart, r.pdfPageEnd, r.printPage, r.printPageVerified ? 1 : 0,
    note, origin, t, t, status === 'approved' ? t : null, status === 'approved' ? userId : null,
  );
  snapshot(db, id, userId, origin === 'import' ? 'Impor awal' : origin === 'ai' ? 'Draft hasil generasi AI' : 'Dibuat');
  return getQuestion(db, id)!;
}

/**
 * Memperbarui soal. ID, format, dan riwayat pengerjaan tidak berubah; versi bertambah dan
 * salinan versi baru disimpan di question_versions.
 */
export function updateQuestion(db: DB, id: string, input: QuestionInput, userId: number | null, wanted: Status, changeNote: string): Question {
  const old = getQuestion(db, id);
  if (!old) throw new Error('Soal tidak ditemukan');
  if (old.format !== input.format) throw new Error('Format soal tidak dapat diubah; buat soal baru.');
  input.demo = old.demo || input.demo;
  const category = resolveCategory(db, input.category);
  resolveSource(db, input);
  const { status, note } = settleStatus(input, wanted);
  const t = nowIso();
  const r = input.reference;
  db.prepare(
    `UPDATE questions SET category=?, topic=?, subtopic=?, body_region=?, difficulty=?, status=?, is_demo=?, content=?,
       source_id=?, book_title=?, edition=?, chapter=?, pdf_page_start=?, pdf_page_end=?, print_page=?, print_page_verified=?,
       review_note=?, version=version+1, updated_at=?,
       approved_at = CASE WHEN ?='approved' THEN ? ELSE NULL END,
       approved_by = CASE WHEN ?='approved' THEN ? ELSE NULL END
     WHERE id=?`,
  ).run(
    category, input.topic, input.subtopic, input.bodyRegion, input.difficulty, status, input.demo ? 1 : 0, JSON.stringify(input.content),
    r.sourceId, r.bookTitle, r.edition, r.chapter, r.pdfPageStart, r.pdfPageEnd, r.printPage, r.printPageVerified ? 1 : 0,
    note, t, status, t, status, userId, id,
  );
  snapshot(db, id, userId, changeNote || 'Diperbarui');
  return getQuestion(db, id)!;
}

export function setStatus(db: DB, id: string, wanted: Status, userId: number | null): { question: Question; problems: string[] } {
  const q = getQuestion(db, id);
  if (!q) throw new Error('Soal tidak ditemukan');
  const problems = wanted === 'approved' ? approvalProblems(q) : [];
  if (problems.length) return { question: q, problems };
  if (q.status === wanted) return { question: q, problems: [] };
  const t = nowIso();
  db.prepare(
    `UPDATE questions SET status=?, version=version+1, updated_at=?, review_note = CASE WHEN ?='approved' THEN '' ELSE review_note END,
       approved_at = CASE WHEN ?='approved' THEN ? ELSE NULL END, approved_by = CASE WHEN ?='approved' THEN ? ELSE NULL END WHERE id=?`,
  ).run(wanted, t, wanted, wanted, t, wanted, userId, id);
  snapshot(db, id, userId, `Status: ${q.status} → ${wanted}`);
  return { question: getQuestion(db, id)!, problems: [] };
}

export interface ImportReport {
  total: number;
  created: number;
  updated: number;
  unchanged: number;
  rejected: number;
  items: { index: number; id?: string; result: 'created' | 'updated' | 'unchanged' | 'rejected'; status?: Status; messages: string[] }[];
}

/**
 * Impor bank soal. ID yang sudah ada diperbarui sebagai versi baru (progres tetap utuh).
 * Status "approved" dari berkas hanya dihormati bila trustApproved = true DAN soal lolos pemeriksaan;
 * selain itu soal masuk sebagai "perlu ditinjau"/"draft".
 */
export function importQuestions(db: DB, items: unknown[], userId: number | null, opts: { trustApproved?: boolean; origin?: string } = {}): ImportReport {
  const report: ImportReport = { total: items.length, created: 0, updated: 0, unchanged: 0, rejected: 0, items: [] };
  const seen = new Set<string>();
  db.transaction(() => {
    items.forEach((raw, index) => {
      const parsed = parseQuestionInput(raw);
      if (!parsed.ok) {
        report.rejected++;
        report.items.push({ index, id: (raw as any)?.id, result: 'rejected', messages: parsed.errors });
        return;
      }
      const q = parsed.value;
      if (q.id && seen.has(q.id)) {
        report.rejected++;
        report.items.push({ index, id: q.id, result: 'rejected', messages: ['ID ganda di dalam berkas impor.'] });
        return;
      }
      if (q.id) seen.add(q.id);
      let wanted: Status = q.status ?? 'draft';
      const messages: string[] = [];
      if (wanted === 'approved' && !opts.trustApproved) {
        wanted = 'needs_review';
        messages.push('Status "approved" pada berkas diturunkan menjadi "perlu ditinjau" (persetujuan dilakukan di panel admin).');
      }
      try {
        const existing = q.id ? getQuestion(db, q.id) : null;
        let saved: Question;
        if (existing) {
          const same =
            JSON.stringify(existing.content) === JSON.stringify(q.content) &&
            JSON.stringify({ ...existing.reference, sourceId: null }) === JSON.stringify({ ...q.reference, sourceId: null }) &&
            existing.topic === q.topic && existing.subtopic === q.subtopic && existing.bodyRegion === q.bodyRegion &&
            existing.difficulty === q.difficulty && existing.category === resolveCategory(db, q.category);
          if (same) {
            report.unchanged++;
            report.items.push({ index, id: existing.id, result: 'unchanged', status: existing.status, messages });
            return;
          }
          saved = updateQuestion(db, existing.id, q, userId, wanted, 'Diperbarui lewat impor');
          report.updated++;
          report.items.push({ index, id: saved.id, result: 'updated', status: saved.status, messages });
        } else {
          saved = createQuestion(db, q, userId, opts.origin ?? 'import', wanted);
          report.created++;
          report.items.push({ index, id: saved.id, result: 'created', status: saved.status, messages });
        }
        if (saved.reviewNote && saved.status === 'needs_review') messages.push(saved.reviewNote);
      } catch (e: any) {
        report.rejected++;
        report.items.push({ index, id: q.id, result: 'rejected', messages: [String(e.message ?? e)] });
      }
    });
  })();
  return report;
}

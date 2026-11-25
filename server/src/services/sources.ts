import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import type { DB } from '../db.js';
import { config } from '../config.js';
import { nowIso } from '../clock.js';
import { badRequest, notFound } from '../errors.js';

export const sourcesDir = () => path.join(config.dataDir, 'sources');
export const assetsDir = () => path.join(config.dataDir, 'assets');

async function loadPdf(data: Uint8Array) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data, useSystemFonts: true, verbosity: 0 });
  const doc: any = await task.promise;
  // destroy() ada pada loading task; disematkan agar pemanggil cukup memegang doc
  doc.close = () => task.destroy();
  return doc;
}

async function pageCount(buf: Buffer): Promise<number | null> {
  try {
    const doc = await loadPdf(new Uint8Array(buf));
    const n = doc.numPages;
    await doc.close();
    return n;
  } catch {
    return null;
  }
}

export interface SourceMeta {
  title?: string;
  edition?: string;
  authors?: string;
  notes?: string;
}

async function storePdf(db: DB, buf: Buffer, originalName: string, meta: SourceMeta) {
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') return { filename: originalName, result: 'rejected' as const, message: 'Bukan berkas PDF yang valid.' };
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  const dup = db.prepare('SELECT id, title FROM sources WHERE sha256 = ?').get(sha) as any;
  if (dup) return { filename: originalName, result: 'duplicate' as const, id: dup.id, message: `Berkas yang sama sudah terdaftar sebagai "${dup.title}".` };
  fs.mkdirSync(sourcesDir(), { recursive: true });
  const stored = `${sha}.pdf`;
  fs.writeFileSync(path.join(sourcesDir(), stored), buf);
  const pages = await pageCount(buf);
  const title = (meta.title ?? '').trim() || path.basename(originalName, path.extname(originalName));
  const r = db
    .prepare(
      `INSERT INTO sources (title, edition, authors, filename, stored_name, size_bytes, sha256, page_count, notes, uploaded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(title, (meta.edition ?? '').trim(), (meta.authors ?? '').trim(), originalName, stored, buf.length, sha, pages, (meta.notes ?? '').trim(), nowIso());
  return {
    filename: originalName,
    result: 'created' as const,
    id: Number(r.lastInsertRowid),
    message: pages == null ? 'Tersimpan, tetapi jumlah halaman tidak terbaca (PDF mungkin rusak/terenkripsi).' : `Tersimpan (${pages} halaman).`,
  };
}

/** Menerima unggahan PDF atau ZIP berisi PDF. Setiap PDF menjadi satu sumber. */
export async function addUpload(db: DB, tmpPath: string, originalName: string, meta: SourceMeta) {
  const ext = path.extname(originalName).toLowerCase();
  const results: Awaited<ReturnType<typeof storePdf>>[] = [];
  try {
    if (ext === '.zip') {
      const zip = new AdmZip(tmpPath);
      const entries = zip.getEntries().filter((e) => !e.isDirectory && e.entryName.toLowerCase().endsWith('.pdf') && !e.entryName.startsWith('__MACOSX'));
      if (entries.length === 0) throw badRequest('ZIP tidak berisi berkas PDF.');
      for (const e of entries) {
        // Judul/edisi dari formulir hanya dipakai bila ZIP berisi satu PDF
        results.push(await storePdf(db, e.getData(), path.basename(e.entryName), entries.length === 1 ? meta : { notes: meta.notes }));
      }
    } else if (ext === '.pdf') {
      results.push(await storePdf(db, fs.readFileSync(tmpPath), originalName, meta));
    } else {
      throw badRequest('Hanya berkas PDF atau ZIP yang diterima.');
    }
  } finally {
    fs.rmSync(tmpPath, { force: true });
  }
  return results;
}

export function listSources(db: DB) {
  return db
    .prepare(
      `SELECT s.id, s.title, s.edition, s.authors, s.filename, s.size_bytes AS sizeBytes, s.page_count AS pageCount, s.is_demo AS demo, s.notes, s.uploaded_at AS uploadedAt,
              (s.stored_name IS NOT NULL) AS hasFile,
              (SELECT COUNT(*) FROM questions q WHERE q.source_id = s.id) AS questionCount,
              (SELECT COUNT(*) FROM questions q WHERE q.source_id = s.id AND q.status = 'approved' AND q.is_demo = 0) AS approvedCount
       FROM sources s ORDER BY s.title, s.edition`,
    )
    .all()
    .map((r: any) => ({ ...r, demo: !!r.demo, hasFile: !!r.hasFile }));
}

export function sourceFilePath(db: DB, id: number): { file: string; filename: string } {
  const s = db.prepare('SELECT stored_name, filename FROM sources WHERE id = ?').get(id) as any;
  if (!s?.stored_name) throw notFound('Berkas referensi');
  const file = path.join(sourcesDir(), path.basename(s.stored_name));
  if (!fs.existsSync(file)) throw notFound('Berkas referensi');
  return { file, filename: s.filename ?? 'referensi.pdf' };
}

export function deleteSource(db: DB, id: number) {
  const s = db.prepare('SELECT * FROM sources WHERE id = ?').get(id) as any;
  if (!s) throw notFound('Sumber');
  const n = (db.prepare('SELECT COUNT(*) n FROM questions WHERE source_id = ?').get(id) as any).n;
  if (n > 0) throw badRequest(`Sumber masih dirujuk oleh ${n} soal dan tidak dapat dihapus.`);
  db.prepare('DELETE FROM sources WHERE id = ?').run(id);
  if (s.stored_name) fs.rmSync(path.join(sourcesDir(), path.basename(s.stored_name)), { force: true });
}

/** Teks satu rentang halaman PDF (disimpan di cache source_pages). Halaman tanpa teks dikembalikan sebagai string kosong. */
export async function pagesText(db: DB, sourceId: number, start: number, end: number): Promise<{ page: number; text: string }[]> {
  const s = db.prepare('SELECT page_count FROM sources WHERE id = ?').get(sourceId) as any;
  if (!s) throw notFound('Sumber');
  const last = Math.min(end, s.page_count ?? end);
  const get = db.prepare('SELECT text FROM source_pages WHERE source_id = ? AND page = ?');
  const out: { page: number; text: string }[] = [];
  let doc: any = null;
  try {
    for (let p = start; p <= last; p++) {
      const cached = get.get(sourceId, p) as any;
      if (cached) {
        out.push({ page: p, text: cached.text });
        continue;
      }
      if (!doc) doc = await loadPdf(new Uint8Array(fs.readFileSync(sourceFilePath(db, sourceId).file)));
      if (p > doc.numPages) break;
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      let text = '';
      for (const it of tc.items as any[]) text += (it.str ?? '') + (it.hasEOL ? '\n' : ' ');
      text = text.replace(/[ \t]+/g, ' ').trim();
      db.prepare('INSERT OR REPLACE INTO source_pages (source_id, page, text) VALUES (?, ?, ?)').run(sourceId, p, text);
      out.push({ page: p, text });
    }
  } finally {
    if (doc) await doc.close();
  }
  return out;
}

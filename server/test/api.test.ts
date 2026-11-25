import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { setClock } from '../src/clock.js';
import * as ai from '../src/services/ai.js';
import { getQuestion } from '../src/services/questions.js';
import { addCbts, cbtInput, freshDb } from './helpers.js';

/** PDF satu halaman minimal dengan satu baris teks (untuk menguji unggah & ekstraksi teks). */
function tinyPdf(text: string): Buffer {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

async function boot() {
  setClock(null);
  const ctx = freshDb();
  const server = createApp(ctx.db).listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const client = (cookie = '') => async (method: string, url: string, body?: unknown, headers: Record<string, string> = { 'X-Requested-With': 'orthoboard' }) => {
    const isForm = body instanceof FormData;
    const res = await fetch(base + url, {
      method,
      headers: { ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
    });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* bukan JSON */ }
    return { status: res.status, json, headers: res.headers, text };
  };
  const login = async (username: string, password: string) => {
    const r = await client()('POST', '/api/auth/login', { username, password });
    assert.equal(r.status, 200);
    return client(r.headers.get('set-cookie')!.split(';')[0]);
  };
  return { ...ctx, base, client, login, close: () => server.close() };
}

test('API: autentikasi, hak admin, dan perlindungan berkas referensi', async () => {
  const t = await boot();
  try {
    const anon = t.client();
    assert.equal((await anon('GET', '/api/dashboard')).status, 401);
    assert.equal((await anon('GET', '/api/sources/1/file')).status, 401);
    assert.equal((await anon('POST', '/api/auth/login', { username: 'admin', password: 'salah' })).status, 401);
    const cookieHeader = (await anon('POST', '/api/auth/login', { username: 'admin', password: 'sandi-admin-123' })).headers.get('set-cookie')!;
    assert.match(cookieHeader, /HttpOnly/);
    const admin = await t.login('admin', 'sandi-admin-123');
    const learner = await t.login('residen', 'sandi-residen-123');

    // peserta tidak bisa memakai rute admin; permintaan tanpa header anti-CSRF ditolak
    assert.equal((await learner('GET', '/api/admin/questions')).status, 403);
    assert.equal((await learner('POST', '/api/admin/import', { questions: [] })).status, 403);
    assert.equal((await admin('POST', '/api/admin/import', { questions: [] }, {})).status, 403);

    // unggah PDF sebagai admin
    const form = new FormData();
    form.append('title', 'Buku Uji (sintetis)');
    form.append('edition', '1');
    form.append('file', new Blob([tinyPdf('Teks halaman uji sintetis untuk ekstraksi')], { type: 'application/pdf' }), 'buku-uji.pdf');
    const up = await admin('POST', '/api/admin/sources', form);
    assert.equal(up.status, 201);
    assert.equal(up.json.results[0].result, 'created');
    const sourceId = up.json.results[0].id;
    assert.match(up.json.results[0].message, /1 halaman/);
    // berkas yang sama tidak didaftarkan dua kali
    const form2 = new FormData();
    form2.append('file', new Blob([tinyPdf('Teks halaman uji sintetis untuk ekstraksi')]), 'salinan.pdf');
    assert.equal((await admin('POST', '/api/admin/sources', form2)).json.results[0].result, 'duplicate');
    // bukan PDF ditolak
    const form3 = new FormData();
    form3.append('file', new Blob(['bukan pdf']), 'x.pdf');
    assert.equal((await admin('POST', '/api/admin/sources', form3)).json.results[0].result, 'rejected');

    // teks halaman dapat dibaca admin
    const pages = await admin('GET', `/api/admin/sources/${sourceId}/pages?from=1&to=1`);
    assert.match(pages.json.pages[0].text, /Teks halaman uji/);

    // akses berkas: admin boleh, peserta ditolak (REFERENCE_ACCESS=admin)
    config.referenceAccess = 'admin';
    const file = await admin('GET', `/api/sources/${sourceId}/file`);
    assert.equal(file.status, 200);
    assert.equal(file.headers.get('content-type'), 'application/pdf');
    assert.equal((await learner('GET', `/api/sources/${sourceId}/file`)).status, 403);
    const list = await learner('GET', '/api/sources');
    assert.equal(list.json.sources[0].fileUrl, null);

    // impor -> tinjau -> setujui -> muncul di paket peserta
    const imp = await admin('POST', '/api/admin/import', { questions: [cbtInput(1), cbtInput(2, { reference: { bookTitle: '', edition: '', chapter: '' } })] });
    assert.equal(imp.json.created, 2);
    assert.equal((await learner('GET', '/api/dashboard')).json.package.size, 0);
    assert.equal((await admin('POST', '/api/admin/questions/T-CBT-00001/status', { status: 'approved' })).status, 200);
    const refuse = await admin('POST', '/api/admin/questions/T-CBT-00002/status', { status: 'approved' });
    assert.equal(refuse.status, 400);
    assert.ok(refuse.json.details.some((d: string) => /Nama buku/.test(d)));
    const dash = (await learner('GET', '/api/dashboard')).json;
    assert.deepEqual({ size: dash.package.size, shortfall: dash.package.shortfall, target: dash.target }, { size: 1, shortfall: 999, target: 1000 });
    assert.equal(getQuestion(t.db, 'T-CBT-00001')!.reference.sourceId, sourceId); // tertaut ke sumber lewat judul+edisi

    // alur sesi lewat HTTP
    const s = await learner('POST', '/api/sessions', { kind: 'new', mode: 'practice', size: 10 });
    assert.equal(s.status, 201);
    assert.equal(s.json.total, 1);
    const item = await learner('GET', `/api/sessions/${s.json.id}/items/1`);
    assert.equal(item.json.reveal, null);
    assert.ok(!JSON.stringify(item.json).includes('Pembahasan uji'));
    const sub = await learner('POST', `/api/sessions/${s.json.id}/items/1/submit`, { response: { choice: 'A' } });
    assert.equal(sub.json.attempt.isCorrect, true);
    assert.equal(sub.json.reveal.reference.pdfPageStart, 10);
    assert.equal(sub.json.reveal.reference.fileUrl, null); // peserta tidak mendapat tautan berkas
    assert.equal((await learner('POST', '/api/sessions', { kind: 'new', mode: 'practice', size: 7 })).status, 400); // ukuran tak dikenal
    // sesi milik pengguna lain tidak terlihat
    assert.equal((await admin('GET', `/api/sessions/${s.json.id}`)).status, 404);
    assert.equal((await learner('POST', '/api/auth/logout')).status, 200);
    assert.equal((await learner('GET', '/api/dashboard')).status, 401);
  } finally {
    t.close();
  }
});

test('antrean AI: hasil selalu draft, kegagalan tercatat, halaman tak terbaca ditolak', async () => {
  const t = await boot();
  try {
    const { db, adminId } = t;
    db.prepare(`INSERT INTO sources (id, title, edition, stored_name, page_count, uploaded_at) VALUES (1, 'Buku Uji (sintetis)', '1', 'tidak-ada.pdf', 20, 'now')`).run();
    const text = 'Teks sintetis halaman uji. '.repeat(10);
    for (let p = 1; p <= 12; p++) db.prepare('INSERT INTO source_pages (source_id, page, text) VALUES (1, ?, ?)').run(p, p <= 6 ? text : p <= 9 ? '' : text);

    assert.throws(() => ai.enqueueJobs(db, adminId, { sourceId: 1, pageStart: 1, pageEnd: 3, format: 'cbt', category: 'trauma', countPerBatch: 2 }), /belum dikonfigurasi/);

    const calls: number[][] = [];
    ai.setGenerator(async (req) => {
      calls.push(req.pages.map((p) => p.page));
      if (req.pages[0].page === 10) throw new Error('galat tiruan dari model');
      const c = cbtInput(1).content;
      return {
        note: '',
        questions: [
          { topic: 'T', subtopic: 'S', bodyRegion: 'B', difficulty: 'sedang', pdfPageStart: req.pages[0].page, pdfPageEnd: req.pages[0].page, printPage: '99', content: { ...c, options: c.options.map((o) => ({ ...o, rationale: '' })) } },
          { topic: 'T', subtopic: 'S', bodyRegion: 'B', difficulty: 'sedang', pdfPageStart: 999, pdfPageEnd: 999, printPage: null, content: { ...c, options: c.options.map((o) => ({ ...o, rationale: '' })) } },
        ],
      };
    });
    config.aiPagesPerBatch = 3;
    const { jobIds } = ai.enqueueJobs(db, adminId, { sourceId: 1, pageStart: 1, pageEnd: 12, format: 'cbt', category: 'trauma', chapter: 'Bab Uji', countPerBatch: 2 });
    assert.equal(jobIds.length, 4); // 12 halaman / 3 per batch
    for (let i = 0; i < 200 && (db.prepare(`SELECT COUNT(*) n FROM ai_jobs WHERE status IN ('queued','running')`).get() as any).n > 0; i++) await new Promise((r) => setTimeout(r, 25));
    const jobs = db.prepare('SELECT * FROM ai_jobs ORDER BY id').all() as any[];
    assert.deepEqual(jobs.map((j) => j.status), ['done', 'done', 'failed', 'failed']);
    assert.match(jobs[2].error, /tidak terbaca/); // halaman 7–9 kosong (pindai tanpa OCR)
    assert.match(jobs[3].error, /galat tiruan/);
    assert.deepEqual(calls, [[1, 2, 3], [4, 5, 6], [10, 11, 12]]);
    const qs = db.prepare(`SELECT * FROM questions WHERE origin = 'ai' ORDER BY created_at, id`).all() as any[];
    assert.equal(qs.length, 4);
    assert.ok(qs.every((q) => q.status !== 'approved' && q.print_page_verified === 0));
    assert.equal(qs.filter((q) => q.status === 'draft' && q.pdf_page_start != null).length, 2);
    // rujukan halaman di luar rentang dikosongkan dan ditandai perlu ditinjau
    assert.equal(qs.filter((q) => q.status === 'needs_review' && q.pdf_page_start == null).length, 2);
    // belum ada yang masuk paket
    addCbts(db, 50, 50);
    const admin = await t.login('admin', 'sandi-admin-123');
    assert.equal((await admin('GET', '/api/dashboard')).json.package.size, 1);
    const view = await admin('GET', '/api/admin/ai');
    assert.equal(view.json.status.queue.failed, 2);
    assert.ok(!JSON.stringify(view.json).includes('ANTHROPIC'));
  } finally {
    ai.setGenerator(null);
    t.close();
  }
});

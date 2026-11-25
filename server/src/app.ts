import express, { type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DB } from './db.js';
import { demoModeOn, setSetting } from './db.js';
import { config } from './config.js';
import { HttpError, badRequest, notFound } from './errors.js';
import * as auth from './auth.js';
import * as sessions from './services/sessions.js';
import * as progress from './services/progress.js';
import * as questions from './services/questions.js';
import * as sources from './services/sources.js';
import * as ai from './services/ai.js';

const pos = (req: Request) => {
  const n = Number(req.params.pos);
  if (!Number.isInteger(n) || n < 1) throw badRequest('Nomor soal tidak valid.');
  return n;
};

export function createApp(db: DB) {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '25mb' }));
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    next();
  });
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(auth.authMiddleware(db));

  const api = express.Router();
  const user = (req: Request) => req.user!;

  // ---------- Autentikasi ----------
  api.post('/auth/login', auth.loginRateLimit, (req, res) => {
    const r = auth.login(db, req.body?.username ?? '', req.body?.password ?? '');
    if (!r) return res.status(401).json({ error: 'Nama pengguna atau sandi salah.' });
    auth.setSessionCookie(res, r.token);
    res.json({ user: r.user });
  });
  api.post('/auth/logout', (req, res) => {
    auth.logout(db, req);
    auth.clearSessionCookie(res);
    res.json({ ok: true });
  });
  api.get('/auth/me', (req, res) => {
    res.json({ user: req.user ?? null, timezone: config.timezone, referenceAccess: config.referenceAccess });
  });

  api.use(auth.requireAuth);

  // ---------- Peserta ----------
  api.get('/dashboard', (req, res) => res.json(progress.dashboard(db, user(req).id)));
  api.get('/progress', (req, res) => res.json(progress.progressReport(db, user(req).id)));
  api.get('/categories', (_req, res) => res.json({ categories: progress.categoriesWithCounts(db) }));

  api.get('/sessions', (req, res) => res.json({ active: sessions.activeSessions(db, user(req).id), recent: sessions.recentSessions(db, user(req).id) }));
  api.post('/sessions', (req, res) => {
    const b = req.body ?? {};
    res.status(201).json(
      sessions.startSession(db, user(req).id, {
        kind: b.kind,
        mode: b.mode,
        size: Number(b.size),
        timeLimitMinutes: b.timeLimitMinutes ? Number(b.timeLimitMinutes) : null,
        remedialSource: b.remedialSource,
      }),
    );
  });
  api.get('/sessions/:id', (req, res) => res.json(sessions.getSession(db, user(req).id, req.params.id)));
  api.get('/sessions/:id/items/:pos', (req, res) => res.json(sessions.openItem(db, user(req).id, req.params.id, pos(req), user(req).role)));
  api.put('/sessions/:id/items/:pos/response', (req, res) =>
    res.json(sessions.saveResponse(db, user(req).id, req.params.id, pos(req), req.body?.response, req.body?.elapsed)),
  );
  api.post('/sessions/:id/items/:pos/submit', (req, res) =>
    res.json(sessions.submitItem(db, user(req).id, req.params.id, pos(req), req.body?.response, user(req).role, req.body?.elapsed)),
  );
  api.post('/sessions/:id/items/:pos/grade', (req, res) => res.json(sessions.selfGrade(db, user(req).id, req.params.id, pos(req), req.body?.checked, user(req).role)));
  api.post('/sessions/:id/heartbeat', (req, res) => res.json(sessions.heartbeat(db, user(req).id, req.params.id, req.body?.elapsed, req.body?.currentIndex)));
  api.post('/sessions/:id/finish', (req, res) => res.json(sessions.finishSession(db, user(req).id, req.params.id, req.body?.elapsed)));

  api.put('/bookmarks/:qid', (req, res) => res.json(sessions.setBookmark(db, user(req).id, req.params.qid, !!req.body?.on)));

  api.get('/bank', (req, res) => res.json(progress.listBank(db, user(req).id, req.query as any)));
  api.get('/bank/:id', (req, res) => res.json(progress.bankDetail(db, user(req).id, req.params.id, user(req).role)));

  api.get('/backup/export', (req, res) => {
    res.setHeader('Content-Disposition', `attachment; filename="orthoboard-progres-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json(progress.exportBackup(db, user(req).id));
  });
  api.post('/backup/import', (req, res) => {
    try {
      res.json(progress.importBackup(db, user(req).id, req.body));
    } catch (e: any) {
      if (e instanceof HttpError) throw e;
      throw badRequest(`Cadangan tidak dapat dipulihkan (tidak ada yang diubah): ${e.message}`);
    }
  });

  // ---------- Referensi ----------
  api.get('/sources', (req, res) => {
    const canOpen = user(req).role === 'admin' || config.referenceAccess === 'authenticated';
    res.json({ sources: sources.listSources(db).map((s: any) => ({ ...s, fileUrl: canOpen && s.hasFile ? `/api/sources/${s.id}/file` : null })), canOpenFiles: canOpen });
  });
  api.get('/sources/:id/file', (req, res) => {
    if (user(req).role !== 'admin' && config.referenceAccess !== 'authenticated') throw new HttpError(403, 'Berkas referensi hanya dapat dibuka oleh admin.');
    const { file, filename } = sources.sourceFilePath(db, Number(req.params.id));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.sendFile(file);
  });
  api.get('/sources/:id/questions', (req, res) => {
    // Hanya metadata soal yang layak tampil; isi soal mengikuti aturan bank
    const r = progress.listBank(db, user(req).id, { sourceId: req.params.id, pageSize: 100 });
    res.json({ items: r.items, total: r.total });
  });
  api.get('/assets/:name', (req, res) => {
    const file = path.join(sources.assetsDir(), path.basename(req.params.name));
    if (!fs.existsSync(file)) throw notFound('Gambar');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(file);
  });

  // ---------- Admin ----------
  const admin = express.Router();
  admin.use(auth.requireAdmin);
  const upload = multer({ dest: path.join(os.tmpdir(), 'orthoboard-uploads'), limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 } });

  admin.get('/overview', (_req, res) => {
    const byStatus = db.prepare(`SELECT status, is_demo AS demo, format, COUNT(*) n FROM questions GROUP BY status, is_demo, format`).all();
    res.json({ byStatus, demoMode: demoModeOn(db), referenceAccess: config.referenceAccess, ai: ai.aiStatus(db), dailyTarget: config.dailyTarget, timezone: config.timezone });
  });
  admin.put('/settings', (req, res) => {
    if (typeof req.body?.demoMode === 'boolean') setSetting(db, 'demo_mode', req.body.demoMode ? '1' : '0');
    res.json({ demoMode: demoModeOn(db) });
  });

  admin.post('/sources', upload.single('file'), async (req, res) => {
    if (!req.file) throw badRequest('Berkas belum dipilih.');
    const name = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    res.status(201).json({ results: await sources.addUpload(db, req.file.path, name, req.body ?? {}) });
  });
  admin.patch('/sources/:id', (req, res) => {
    const b = req.body ?? {};
    const s = db.prepare('SELECT * FROM sources WHERE id = ?').get(Number(req.params.id)) as any;
    if (!s) throw notFound('Sumber');
    const title = String(b.title ?? s.title).trim();
    if (!title) throw badRequest('Judul wajib diisi.');
    db.prepare('UPDATE sources SET title = ?, edition = ?, authors = ?, notes = ? WHERE id = ?').run(
      title, String(b.edition ?? s.edition).trim(), String(b.authors ?? s.authors).trim(), String(b.notes ?? s.notes).trim(), s.id,
    );
    res.json({ ok: true });
  });
  admin.delete('/sources/:id', (req, res) => {
    sources.deleteSource(db, Number(req.params.id));
    res.json({ ok: true });
  });
  admin.get('/sources/:id/pages', async (req, res) => {
    const from = Math.max(1, Number(req.query.from) || 1);
    const to = Math.min(from + 9, Math.max(from, Number(req.query.to) || from));
    res.json({ pages: await sources.pagesText(db, Number(req.params.id), from, to) });
  });

  const imageUpload = multer({ dest: path.join(os.tmpdir(), 'orthoboard-uploads'), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
  admin.post('/assets', imageUpload.single('file'), (req, res) => {
    if (!req.file) throw badRequest('Berkas belum dipilih.');
    const ext = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' }[req.file.mimetype];
    if (!ext) {
      fs.rmSync(req.file.path, { force: true });
      throw badRequest('Gambar harus PNG, JPG, atau WebP.');
    }
    fs.mkdirSync(sources.assetsDir(), { recursive: true });
    const name = `${crypto.randomUUID()}${ext}`;
    fs.copyFileSync(req.file.path, path.join(sources.assetsDir(), name));
    fs.rmSync(req.file.path, { force: true });
    res.status(201).json({ asset: name });
  });

  admin.get('/questions', (req, res) => {
    const f = req.query as Record<string, string>;
    const page = Math.max(1, Number(f.page) || 1);
    const pageSize = Math.min(100, Math.max(5, Number(f.pageSize) || 20));
    const where: string[] = ['1=1'];
    const p: any = {};
    if (f.status) (where.push('q.status = @status'), (p.status = f.status));
    if (f.format) (where.push('q.format = @format'), (p.format = f.format));
    if (f.category) (where.push('q.category = @category'), (p.category = f.category));
    if (f.demo === '1') where.push('q.is_demo = 1');
    if (f.demo === '0') where.push('q.is_demo = 0');
    if (f.origin) (where.push('q.origin = @origin'), (p.origin = f.origin));
    if (f.sourceId) (where.push('q.source_id = @sourceId'), (p.sourceId = Number(f.sourceId)));
    if (f.search) (where.push('(q.id LIKE @s OR q.topic LIKE @s OR q.subtopic LIKE @s OR q.content LIKE @s)'), (p.s = `%${f.search.trim()}%`));
    const total = (db.prepare(`SELECT COUNT(*) n FROM questions q WHERE ${where.join(' AND ')}`).get(p) as any).n;
    const rows = db.prepare(`SELECT q.* FROM questions q WHERE ${where.join(' AND ')} ORDER BY q.updated_at DESC, q.id LIMIT @limit OFFSET @offset`).all({ ...p, limit: pageSize, offset: (page - 1) * pageSize });
    res.json({
      page, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)),
      items: rows.map((r: any) => {
        const q = questions.rowToQuestion(r);
        return { ...q, content: undefined, stem: questions.stemOf(q.format, q.content).slice(0, 200), problems: q.status === 'approved' ? [] : questions.approvalProblems(q) };
      }),
    });
  });
  admin.get('/questions/:id', (req, res) => {
    const q = questions.getQuestion(db, req.params.id);
    if (!q) throw notFound('Soal');
    const versions = db
      .prepare(
        `SELECT v.version, v.change_note AS changeNote, v.created_at AS createdAt, u.username AS changedBy, v.snapshot
         FROM question_versions v LEFT JOIN users u ON u.id = v.changed_by WHERE v.question_id = ? ORDER BY v.version DESC`,
      )
      .all(q.id)
      .map((v: any) => ({ ...v, snapshot: JSON.parse(v.snapshot) }));
    const usage = db.prepare(`SELECT COUNT(*) n FROM attempts WHERE question_id = ? AND graded_at IS NOT NULL`).get(q.id) as any;
    res.json({ question: q, problems: questions.approvalProblems(q), versions, gradedAttempts: usage.n });
  });
  const parseBody = (body: any) => {
    const parsed = questions.parseQuestionInput(body);
    if (!parsed.ok) throw badRequest('Isi soal tidak valid.', { details: parsed.errors });
    return parsed.value;
  };
  admin.post('/questions', (req, res) => {
    const input = parseBody(req.body?.question);
    if (input.id && questions.getQuestion(db, input.id)) throw badRequest('ID soal sudah dipakai.');
    res.status(201).json({ question: questions.createQuestion(db, input, user(req).id, 'manual', input.status ?? 'draft') });
  });
  admin.put('/questions/:id', (req, res) => {
    const input = parseBody({ ...req.body?.question, id: req.params.id });
    const wanted = (req.body?.status ?? input.status ?? 'needs_review') as questions.Status;
    if (!questions.STATUSES.includes(wanted)) throw badRequest('Status tidak dikenal.');
    const q = db.transaction(() => questions.updateQuestion(db, req.params.id, input, user(req).id, wanted, String(req.body?.changeNote ?? '')))();
    res.json({ question: q, problems: questions.approvalProblems(q), downgraded: wanted === 'approved' && q.status !== 'approved' });
  });
  admin.post('/questions/:id/status', (req, res) => {
    const wanted = req.body?.status as questions.Status;
    if (!questions.STATUSES.includes(wanted)) throw badRequest('Status tidak dikenal.');
    const r = db.transaction(() => questions.setStatus(db, req.params.id, wanted, user(req).id))();
    if (r.problems.length) throw badRequest('Soal belum memenuhi syarat untuk disetujui.', { details: r.problems });
    res.json(r);
  });
  admin.post('/questions/bulk-status', (req, res) => {
    const wanted = req.body?.status as questions.Status;
    const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids.slice(0, 2000) : [];
    if (!questions.STATUSES.includes(wanted)) throw badRequest('Status tidak dikenal.');
    const results = db.transaction(() =>
      ids.map((id) => {
        try {
          const r = questions.setStatus(db, id, wanted, user(req).id);
          return { id, ok: r.problems.length === 0, problems: r.problems };
        } catch (e: any) {
          return { id, ok: false, problems: [String(e.message)] };
        }
      }),
    )();
    res.json({ changed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok) });
  });
  admin.post('/import', (req, res) => {
    const body = req.body ?? {};
    const items = Array.isArray(body) ? body : body.questions;
    if (!Array.isArray(items)) throw badRequest('Format impor: { "questions": [ ... ] }.');
    if (items.length > 20000) throw badRequest('Maksimal 20.000 soal per impor.');
    res.json(questions.importQuestions(db, items, user(req).id, { trustApproved: body.trustApproved === true }));
  });

  admin.get('/users', (_req, res) => res.json({ users: db.prepare('SELECT id, username, role, created_at AS createdAt FROM users ORDER BY id').all() }));
  admin.post('/users', (req, res) => {
    const { username, password, role } = req.body ?? {};
    if (role !== 'admin' && role !== 'learner') throw badRequest('Peran harus admin atau learner.');
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(String(username ?? '').trim())) throw badRequest('Nama pengguna sudah dipakai.');
    try {
      res.status(201).json({ id: auth.createUser(db, String(username ?? ''), String(password ?? ''), role) });
    } catch (e: any) {
      throw badRequest(e.message);
    }
  });
  admin.post('/users/:id/password', (req, res) => {
    const u = db.prepare('SELECT username FROM users WHERE id = ?').get(Number(req.params.id)) as any;
    if (!u) throw notFound('Pengguna');
    try {
      auth.setPassword(db, u.username, String(req.body?.password ?? ''));
    } catch (e: any) {
      throw badRequest(e.message);
    }
    res.json({ ok: true });
  });

  admin.get('/ai', (_req, res) => res.json({ status: ai.aiStatus(db), jobs: ai.listJobs(db) }));
  admin.post('/ai/jobs', (req, res) => {
    const b = req.body ?? {};
    res.status(201).json(
      ai.enqueueJobs(db, user(req).id, {
        sourceId: Number(b.sourceId), pageStart: Number(b.pageStart), pageEnd: Number(b.pageEnd), format: String(b.format), category: String(b.category),
        chapter: String(b.chapter ?? ''), countPerBatch: Number(b.countPerBatch),
      }),
    );
  });
  admin.post('/ai/jobs/:id/cancel', (req, res) => (ai.cancelJob(db, Number(req.params.id)), res.json({ ok: true })));
  admin.post('/ai/jobs/:id/retry', (req, res) => (ai.retryJob(db, Number(req.params.id)), res.json({ ok: true })));

  api.use('/admin', admin);
  api.use((_req, _res, next) => next(notFound('Alamat API')));
  app.use('/api', api);

  // ---------- Frontend statis (hasil build) ----------
  const here = path.dirname(fileURLToPath(import.meta.url));
  const clientDist = [path.resolve(here, '../../client/dist'), path.resolve(here, '../client')].find((p) => fs.existsSync(path.join(p, 'index.html')));
  if (clientDist) {
    app.use(express.static(clientDist, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.extra });
    if (err instanceof multer.MulterError) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? `Berkas melebihi batas ${config.maxUploadMb} MB.` : err.message });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON tidak valid.' });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Data terlalu besar.' });
    console.error(err);
    res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
  });

  return app;
}

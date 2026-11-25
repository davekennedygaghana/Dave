import crypto from 'node:crypto';
import type { DB } from '../db.js';
import { eligibleSql } from '../db.js';
import { config, SESSION_SIZES } from '../config.js';
import { nowIso } from '../clock.js';
import { HttpError, badRequest, notFound } from '../errors.js';
import { getOrCreatePackage, pendingPackageItems } from './packages.js';
import { getQuestion, publicContent, type Question } from './questions.js';

export const PASS_MARK = 0.6; // ambang "benar" untuk nilai mandiri (VIVA/OSCE/esai)

export type RemedialSource = 'wrong' | 'bookmarked' | 'unanswered' | 'all';

interface SessionRow {
  id: string;
  user_id: number;
  kind: 'new' | 'remedial';
  mode: 'practice' | 'exam';
  package_id: string | null;
  status: 'active' | 'finished';
  current_index: number;
  elapsed_seconds: number;
  time_limit_seconds: number | null;
  label: string;
  created_at: string;
  finished_at: string | null;
}

function loadSession(db: DB, userId: number, id: string): SessionRow {
  const s = db.prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?').get(id, userId) as SessionRow | undefined;
  if (!s) throw notFound('Sesi');
  return s;
}

export function activeSessions(db: DB, userId: number) {
  return db
    .prepare(
      `SELECT s.id, s.kind, s.mode, s.label, s.created_at AS createdAt, s.current_index AS currentIndex,
              p.date AS packageDate,
              (SELECT COUNT(*) FROM session_items i WHERE i.session_id = s.id) AS total,
              (SELECT COUNT(*) FROM attempts a WHERE a.session_id = s.id AND (a.submitted_at IS NOT NULL OR a.response <> '{}')) AS answered
       FROM sessions s LEFT JOIN daily_packages p ON p.id = s.package_id
       WHERE s.user_id = ? AND s.status = 'active' ORDER BY s.created_at DESC`,
    )
    .all(userId);
}

/** Kumpulan soal remedial: salah pada penilaian terakhir, ditandai, atau pernah dibuka tetapi belum dinilai. */
export function remedialPool(db: DB, userId: number, source: RemedialSource): string[] {
  const el = eligibleSql(db);
  const wrong = `SELECT q.id, a.graded_at AS t FROM questions q JOIN attempts a ON a.question_id = q.id AND a.user_id = @u
     WHERE ${el} AND a.graded_at IS NOT NULL AND a.is_correct = 0
       AND a.rowid = (SELECT b.rowid FROM attempts b WHERE b.user_id = @u AND b.question_id = q.id AND b.graded_at IS NOT NULL ORDER BY b.graded_at DESC, b.rowid DESC LIMIT 1)`;
  const bookmarked = `SELECT q.id, b.created_at AS t FROM questions q JOIN bookmarks b ON b.question_id = q.id AND b.user_id = @u WHERE ${el}`;
  const unanswered = `SELECT q.id, e.opened_at AS t FROM questions q JOIN question_exposures e ON e.question_id = q.id AND e.user_id = @u
     WHERE ${el} AND NOT EXISTS (SELECT 1 FROM attempts a WHERE a.user_id = @u AND a.question_id = q.id AND a.graded_at IS NOT NULL)`;
  const parts = source === 'wrong' ? [wrong] : source === 'bookmarked' ? [bookmarked] : source === 'unanswered' ? [unanswered] : [wrong, bookmarked, unanswered];
  const rows = db.prepare(`SELECT id, MIN(t) AS t FROM (${parts.join(' UNION ALL ')}) GROUP BY id ORDER BY t`).all({ u: userId }) as { id: string }[];
  return rows.map((r) => r.id);
}

export function remedialCounts(db: DB, userId: number) {
  return {
    wrong: remedialPool(db, userId, 'wrong').length,
    bookmarked: remedialPool(db, userId, 'bookmarked').length,
    unanswered: remedialPool(db, userId, 'unanswered').length,
    all: remedialPool(db, userId, 'all').length,
  };
}

export interface StartOptions {
  kind: 'new' | 'remedial';
  mode: 'practice' | 'exam';
  size: number;
  timeLimitMinutes?: number | null;
  remedialSource?: RemedialSource;
}

export function startSession(db: DB, userId: number, opts: StartOptions): { id: string; total: number; requested: number } {
  if (!(SESSION_SIZES as readonly number[]).includes(opts.size)) throw badRequest(`Ukuran sesi harus salah satu dari: ${SESSION_SIZES.join(', ')}.`);
  if (opts.kind !== 'new' && opts.kind !== 'remedial') throw badRequest('Jenis sesi tidak dikenal.');
  if (opts.mode !== 'practice' && opts.mode !== 'exam') throw badRequest('Mode sesi tidak dikenal.');
  const limit = opts.timeLimitMinutes ? Math.round(Math.min(Math.max(opts.timeLimitMinutes, 1), 24 * 60) * 60) : null;

  return db.transaction(() => {
    const active = db.prepare(`SELECT id FROM sessions WHERE user_id = ? AND kind = ? AND status = 'active'`).get(userId, opts.kind) as any;
    if (active) {
      throw new HttpError(409, 'Masih ada sesi aktif untuk jenis ini. Lanjutkan atau selesaikan sesi tersebut terlebih dahulu.', { sessionId: active.id });
    }
    const id = crypto.randomUUID();
    let questionIds: string[];
    let packageId: string | null = null;
    let label: string;

    if (opts.kind === 'new') {
      const pkg = getOrCreatePackage(db, userId);
      const pending = pendingPackageItems(db, pkg, opts.size);
      if (pending.length === 0) {
        throw new HttpError(409, 'Tidak ada soal baru tersisa di paket hari ini. Bank soal yang memenuhi syarat sudah habis atau paket sudah selesai.', { exhausted: true });
      }
      packageId = pkg.id;
      questionIds = pending.map((p) => p.questionId);
      label = `Soal baru ${pkg.date}`;
      db.prepare(
        `INSERT INTO sessions (id, user_id, kind, mode, package_id, time_limit_seconds, label, created_at) VALUES (?, ?, 'new', ?, ?, ?, ?, ?)`,
      ).run(id, userId, opts.mode, packageId, limit, label, nowIso());
      // Draf yang belum dikunci dari sesi sebelumnya ikut pindah ke sesi ini (tetap satu baris per soal)
      const move = db.prepare('UPDATE attempts SET session_id = ?, updated_at = ? WHERE id = ?');
      for (const p of pending) if (p.attemptId) move.run(id, nowIso(), p.attemptId);
    } else {
      const source = opts.remedialSource ?? 'all';
      questionIds = remedialPool(db, userId, source).slice(0, opts.size);
      if (questionIds.length === 0) throw new HttpError(409, 'Belum ada soal untuk remedial pada pilihan ini.', { exhausted: true });
      label = `Remedial (${{ wrong: 'salah', bookmarked: 'ditandai', unanswered: 'belum dinilai', all: 'gabungan' }[source]})`;
      db.prepare(`INSERT INTO sessions (id, user_id, kind, mode, time_limit_seconds, label, created_at) VALUES (?, ?, 'remedial', ?, ?, ?, ?)`).run(
        id, userId, opts.mode, limit, label, nowIso(),
      );
    }
    const ins = db.prepare('INSERT INTO session_items (session_id, position, question_id) VALUES (?, ?, ?)');
    questionIds.forEach((q, i) => ins.run(id, i + 1, q));
    return { id, total: questionIds.length, requested: opts.size };
  })();
}

const canReveal = (s: SessionRow, attempt: any) => (s.mode === 'practice' ? !!attempt?.submitted_at : s.status === 'finished');

function itemState(a: any): 'unopened' | 'opened' | 'answered' | 'submitted' | 'graded' {
  if (!a) return 'opened';
  if (a.graded_at) return 'graded';
  if (a.submitted_at) return 'submitted';
  const r = JSON.parse(a.response || '{}');
  return r.choice || (r.text && String(r.text).trim()) ? 'answered' : 'opened';
}

export function getSession(db: DB, userId: number, id: string) {
  const s = loadSession(db, userId, id);
  const rows = db
    .prepare(
      `SELECT i.position, i.question_id AS questionId, i.opened_at AS openedAt, q.format,
              a.response, a.submitted_at, a.graded_at, a.is_correct, a.score, a.auto_graded,
              (b.question_id IS NOT NULL) AS bookmarked
       FROM session_items i JOIN questions q ON q.id = i.question_id
       LEFT JOIN attempts a ON a.session_id = i.session_id AND a.question_id = i.question_id
       LEFT JOIN bookmarks b ON b.user_id = ? AND b.question_id = i.question_id
       WHERE i.session_id = ? ORDER BY i.position`,
    )
    .all(userId, id) as any[];
  const items = rows.map((r) => {
    const a = r.response == null ? null : r;
    const reveal = canReveal(s, a);
    return {
      position: r.position,
      questionId: r.questionId,
      format: r.format,
      state: r.openedAt || a ? itemState(a) : ('unopened' as const),
      bookmarked: !!r.bookmarked,
      correct: reveal && r.graded_at ? !!r.is_correct : null,
      score: reveal && r.graded_at ? r.score : null,
    };
  });
  const pkg = s.package_id ? (db.prepare('SELECT date FROM daily_packages WHERE id = ?').get(s.package_id) as any) : null;
  return {
    id: s.id,
    kind: s.kind,
    mode: s.mode,
    status: s.status,
    label: s.label,
    packageDate: pkg?.date ?? null,
    currentIndex: s.current_index,
    elapsedSeconds: s.elapsed_seconds,
    timeLimitSeconds: s.time_limit_seconds,
    createdAt: s.created_at,
    finishedAt: s.finished_at,
    items,
    summary: s.status === 'finished' ? sessionSummary(db, id) : null,
  };
}

export function sessionSummary(db: DB, sessionId: string) {
  const r = db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM session_items WHERE session_id = @s) AS total,
        SUM(CASE WHEN auto_graded = 1 AND graded_at IS NOT NULL THEN 1 ELSE 0 END) AS cbtN,
        SUM(CASE WHEN auto_graded = 1 AND is_correct = 1 THEN 1 ELSE 0 END) AS cbtCorrect,
        SUM(CASE WHEN auto_graded = 0 AND graded_at IS NOT NULL THEN 1 ELSE 0 END) AS selfN,
        AVG(CASE WHEN auto_graded = 0 AND graded_at IS NOT NULL THEN score END) AS selfAvg,
        SUM(CASE WHEN submitted_at IS NOT NULL AND graded_at IS NULL THEN 1 ELSE 0 END) AS awaitingGrade,
        SUM(CASE WHEN graded_at IS NOT NULL THEN 1 ELSE 0 END) AS graded
       FROM attempts WHERE session_id = @s`,
    )
    .get({ s: sessionId }) as any;
  const graded = r.graded ?? 0;
  const awaiting = r.awaitingGrade ?? 0;
  return {
    total: r.total,
    graded,
    cbt: { n: r.cbtN ?? 0, correct: r.cbtCorrect ?? 0 },
    self: { n: r.selfN ?? 0, avg: r.selfAvg },
    awaitingGrade: awaiting,
    unanswered: r.total - graded - awaiting,
  };
}

function loadItem(db: DB, s: SessionRow, position: number) {
  const item = db.prepare('SELECT * FROM session_items WHERE session_id = ? AND position = ?').get(s.id, position) as any;
  if (!item) throw notFound('Soal dalam sesi');
  const q = getQuestion(db, item.question_id)!;
  const attempt = db.prepare('SELECT * FROM attempts WHERE session_id = ? AND question_id = ?').get(s.id, q.id) as any;
  return { item, q, attempt };
}

export function referenceView(db: DB, q: Question, role: string) {
  const r = q.reference;
  const hasFile = r.sourceId ? !!(db.prepare('SELECT stored_name FROM sources WHERE id = ?').get(r.sourceId) as any)?.stored_name : false;
  return {
    ...r,
    fileUrl: hasFile && (role === 'admin' || config.referenceAccess === 'authenticated') ? `/api/sources/${r.sourceId}/file#page=${r.pdfPageStart ?? 1}` : null,
  };
}

function attemptView(a: any) {
  if (!a) return null;
  return {
    response: JSON.parse(a.response || '{}'),
    submitted: !!a.submitted_at,
    graded: !!a.graded_at,
    autoGraded: !!a.auto_graded,
    isCorrect: a.graded_at ? !!a.is_correct : null,
    score: a.graded_at ? a.score : null,
    grade: a.grade ? JSON.parse(a.grade) : null,
  };
}

function itemView(db: DB, s: SessionRow, position: number, role: string) {
  const { item, q, attempt } = loadItem(db, s, position);
  const reveal = canReveal(s, attempt);
  const cat = db.prepare('SELECT name FROM categories WHERE slug = ?').get(q.category) as any;
  const total = (db.prepare('SELECT COUNT(*) n FROM session_items WHERE session_id = ?').get(s.id) as any).n;
  const a = attemptView(attempt);
  if (a && !reveal) {
    a.isCorrect = null;
    a.score = null;
  }
  return {
    position,
    total,
    openedAt: item.opened_at,
    serverNow: nowIso(),
    question: {
      id: q.id,
      format: q.format,
      category: q.category,
      categoryName: cat?.name ?? q.category,
      topic: q.topic,
      subtopic: q.subtopic,
      bodyRegion: q.bodyRegion,
      difficulty: q.difficulty,
      demo: q.demo,
      content: publicContent(q.format, q.content),
    },
    attempt: a,
    bookmarked: !!db.prepare('SELECT 1 FROM bookmarks WHERE user_id = ? AND question_id = ?').get(s.user_id, q.id),
    reveal: reveal ? { content: q.content, reference: referenceView(db, q, role) } : null,
  };
}

/** Membuka satu soal. Pada mode soal baru, pembukaan pertama dicatat sebagai "sudah dibuka". */
export function openItem(db: DB, userId: number, sessionId: string, position: number, role = 'learner') {
  const s = loadSession(db, userId, sessionId);
  return db.transaction(() => {
    const { item, q } = loadItem(db, s, position);
    if (s.status === 'active') {
      if (!item.opened_at) db.prepare('UPDATE session_items SET opened_at = ? WHERE session_id = ? AND position = ?').run(nowIso(), s.id, position);
      if (s.kind === 'new') {
        db.prepare('INSERT OR IGNORE INTO question_exposures (user_id, question_id, package_id, opened_at) VALUES (?, ?, ?, ?)').run(userId, q.id, s.package_id, nowIso());
      }
      db.prepare('UPDATE sessions SET current_index = ? WHERE id = ?').run(position - 1, s.id);
    }
    return itemView(db, s, position, role);
  })();
}

function cleanResponse(format: string, raw: any): { choice?: string; text?: string } {
  if (format === 'cbt') {
    const choice = typeof raw?.choice === 'string' ? raw.choice.trim().toUpperCase().slice(0, 2) : '';
    return choice ? { choice } : {};
  }
  const text = typeof raw?.text === 'string' ? raw.text.slice(0, 20000) : '';
  return text ? { text } : {};
}

function upsertAttempt(db: DB, s: SessionRow, q: Question, existing: any, response: object): string {
  const t = nowIso();
  if (existing) {
    db.prepare('UPDATE attempts SET response = ?, question_version = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(response), q.version, t, existing.id);
    return existing.id;
  }
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO attempts (id, user_id, question_id, session_id, package_id, kind, format, question_version, response, auto_graded, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, s.user_id, q.id, s.id, s.package_id, s.kind, q.format, q.version, JSON.stringify(response), q.format === 'cbt' ? 1 : 0, t);
  return id;
}

function gradeCbt(db: DB, attemptId: string, q: Question, choice: string) {
  const t = nowIso();
  const correct = choice === q.content.answer;
  db.prepare('UPDATE attempts SET submitted_at = COALESCE(submitted_at, ?), graded_at = ?, auto_graded = 1, is_correct = ?, score = ?, updated_at = ? WHERE id = ?').run(
    t, t, correct ? 1 : 0, correct ? 1 : 0, t, attemptId,
  );
}

function assertActive(s: SessionRow) {
  if (s.status !== 'active') throw new HttpError(409, 'Sesi sudah selesai.');
}

function touchElapsed(db: DB, s: SessionRow, elapsed: unknown) {
  const e = Math.floor(Number(elapsed));
  if (Number.isFinite(e) && e > s.elapsed_seconds) db.prepare('UPDATE sessions SET elapsed_seconds = ? WHERE id = ?').run(Math.min(e, 7 * 86400), s.id);
}

/** Simpan otomatis jawaban (draf). Belum dihitung sebagai selesai. */
export function saveResponse(db: DB, userId: number, sessionId: string, position: number, raw: any, elapsed?: number) {
  const s = loadSession(db, userId, sessionId);
  assertActive(s);
  return db.transaction(() => {
    const { q, attempt } = loadItem(db, s, position);
    if (attempt?.submitted_at) throw new HttpError(409, 'Jawaban sudah dikunci.');
    upsertAttempt(db, s, q, attempt, cleanResponse(q.format, raw));
    touchElapsed(db, s, elapsed);
    return { saved: true };
  })();
}

/**
 * Mode latihan: mengunci jawaban. CBT langsung dinilai otomatis; format lain menampilkan rubrik untuk nilai mandiri.
 * Pemanggilan ulang tidak membuat percobaan baru (idempoten).
 */
export function submitItem(db: DB, userId: number, sessionId: string, position: number, raw: any, role = 'learner', elapsed?: number) {
  const s = loadSession(db, userId, sessionId);
  assertActive(s);
  if (s.mode !== 'practice') throw badRequest('Pada mode ujian, jawaban dinilai setelah sesi diselesaikan.');
  return db.transaction(() => {
    const { q, attempt } = loadItem(db, s, position);
    if (!attempt?.submitted_at) {
      const response = cleanResponse(q.format, raw);
      if (q.format === 'cbt' && !response.choice) throw badRequest('Pilih satu jawaban terlebih dahulu.');
      if (q.format === 'cbt' && !q.content.options.some((o: any) => o.key === response.choice)) throw badRequest('Pilihan jawaban tidak dikenal.');
      const id = upsertAttempt(db, s, q, attempt, response);
      if (q.format === 'cbt') gradeCbt(db, id, q, response.choice!);
      else db.prepare('UPDATE attempts SET submitted_at = ?, updated_at = ? WHERE id = ?').run(nowIso(), nowIso(), id);
    }
    touchElapsed(db, s, elapsed);
    return itemView(db, s, position, role);
  })();
}

/** Nilai mandiri VIVA/OSCE/esai berdasarkan butir rubrik/checklist yang dicentang. */
export function selfGrade(db: DB, userId: number, sessionId: string, position: number, checkedRaw: unknown, role = 'learner') {
  const s = loadSession(db, userId, sessionId);
  return db.transaction(() => {
    const { q, attempt } = loadItem(db, s, position);
    if (q.format === 'cbt') throw badRequest('CBT dinilai otomatis.');
    if (!attempt?.submitted_at) throw badRequest('Kunci jawaban terlebih dahulu sebelum menilai.');
    const items: { weight: number; critical?: boolean }[] = q.format === 'osce' ? q.content.checklist : q.content.rubric;
    if (!Array.isArray(checkedRaw)) throw badRequest('Daftar centang tidak valid.');
    const checked = [...new Set(checkedRaw.map(Number).filter((i) => Number.isInteger(i) && i >= 0 && i < items.length))].sort((a, b) => a - b);
    const total = items.reduce((a, b) => a + b.weight, 0);
    const got = checked.reduce((a, i) => a + items[i].weight, 0);
    const score = total > 0 ? got / total : 0;
    const criticalMissed = items.map((it, i) => (it.critical && !checked.includes(i) ? i : -1)).filter((i) => i >= 0);
    const pass = score >= PASS_MARK && criticalMissed.length === 0;
    const t = nowIso();
    db.prepare('UPDATE attempts SET graded_at = ?, auto_graded = 0, is_correct = ?, score = ?, grade = ?, updated_at = ? WHERE id = ?').run(
      t, pass ? 1 : 0, score, JSON.stringify({ checked, criticalMissed, points: got, maxPoints: total }), t, attempt.id,
    );
    return itemView(db, s, position, role);
  })();
}

export function heartbeat(db: DB, userId: number, sessionId: string, elapsed: unknown, currentIndex: unknown) {
  const s = loadSession(db, userId, sessionId);
  if (s.status !== 'active') return { status: s.status };
  touchElapsed(db, s, elapsed);
  const ci = Number(currentIndex);
  if (Number.isInteger(ci) && ci >= 0) db.prepare('UPDATE sessions SET current_index = ? WHERE id = ?').run(ci, s.id);
  return { status: 'active' };
}

/**
 * Menyelesaikan sesi. Mode ujian: CBT yang sudah dipilih dinilai otomatis; jawaban tertulis dikunci dan
 * menunggu nilai mandiri. Soal tanpa jawaban TIDAK dinilai dan tidak dihitung selesai.
 */
export function finishSession(db: DB, userId: number, sessionId: string, elapsed?: unknown) {
  const s = loadSession(db, userId, sessionId);
  if (s.status === 'finished') return sessionSummary(db, s.id);
  return db.transaction(() => {
    touchElapsed(db, s, elapsed);
    const rows = db.prepare('SELECT * FROM attempts WHERE session_id = ? AND submitted_at IS NULL').all(s.id) as any[];
    for (const a of rows) {
      const r = JSON.parse(a.response || '{}');
      if (s.mode !== 'exam') continue; // latihan: draf yang belum dikunci dibiarkan
      const q = getQuestion(db, a.question_id)!;
      if (q.format === 'cbt') {
        if (r.choice) gradeCbt(db, a.id, q, r.choice);
      } else if (r.text && String(r.text).trim()) {
        db.prepare('UPDATE attempts SET submitted_at = ?, updated_at = ? WHERE id = ?').run(nowIso(), nowIso(), a.id);
      }
    }
    db.prepare(`UPDATE sessions SET status = 'finished', finished_at = ? WHERE id = ?`).run(nowIso(), s.id);
    return sessionSummary(db, s.id);
  })();
}

export function setBookmark(db: DB, userId: number, questionId: string, on: boolean) {
  if (!db.prepare('SELECT 1 FROM questions WHERE id = ?').get(questionId)) throw notFound('Soal');
  if (on) db.prepare('INSERT OR IGNORE INTO bookmarks (user_id, question_id, created_at) VALUES (?, ?, ?)').run(userId, questionId, nowIso());
  else db.prepare('DELETE FROM bookmarks WHERE user_id = ? AND question_id = ?').run(userId, questionId);
  return { bookmarked: on };
}

export function recentSessions(db: DB, userId: number, limit = 20) {
  const rows = db.prepare(`SELECT id, kind, mode, status, label, created_at AS createdAt, finished_at AS finishedAt FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`).all(userId, limit) as any[];
  return rows.map((r) => ({ ...r, summary: sessionSummary(db, r.id) }));
}

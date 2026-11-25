import type { DB } from '../db.js';
import { eligibleSql, demoModeOn } from '../db.js';
import { config, SESSION_SIZES } from '../config.js';
import { localDate, nowIso } from '../clock.js';
import { badRequest, notFound } from '../errors.js';
import { countUnseenEligible, getOrCreatePackage, packageStats } from './packages.js';
import { activeSessions, referenceView, remedialCounts } from './sessions.js';
import { getQuestion, publicContent, stemOf } from './questions.js';

export function categoriesWithCounts(db: DB) {
  return db
    .prepare(
      `SELECT c.slug, c.name,
        (SELECT COUNT(*) FROM questions q WHERE q.category = c.slug AND ${eligibleSql(db)}) AS eligible,
        (SELECT COUNT(*) FROM questions q WHERE q.category = c.slug) AS total
       FROM categories c ORDER BY c.sort_order, c.name`,
    )
    .all() as { slug: string; name: string; eligible: number; total: number }[];
}

function scoreBlock(db: DB, where: string, params: any[]) {
  const r = db
    .prepare(
      `SELECT
        SUM(CASE WHEN auto_graded = 1 THEN 1 ELSE 0 END) AS cbtN,
        SUM(CASE WHEN auto_graded = 1 AND is_correct = 1 THEN 1 ELSE 0 END) AS cbtCorrect,
        SUM(CASE WHEN auto_graded = 0 THEN 1 ELSE 0 END) AS selfN,
        AVG(CASE WHEN auto_graded = 0 THEN score END) AS selfAvg
       FROM attempts a WHERE a.graded_at IS NOT NULL AND ${where}`,
    )
    .get(...params) as any;
  return { cbt: { n: r.cbtN ?? 0, correct: r.cbtCorrect ?? 0 }, self: { n: r.selfN ?? 0, avg: r.selfAvg as number | null } };
}

export function dashboard(db: DB, userId: number) {
  const pkg = getOrCreatePackage(db, userId);
  const stats = packageStats(db, pkg);
  const bank = db
    .prepare(
      `SELECT COUNT(*) AS total,
        SUM(CASE WHEN status='approved' AND is_demo=0 THEN 1 ELSE 0 END) AS approved,
        SUM(CASE WHEN status='needs_review' AND is_demo=0 THEN 1 ELSE 0 END) AS needsReview,
        SUM(CASE WHEN status='draft' AND is_demo=0 THEN 1 ELSE 0 END) AS draft,
        SUM(CASE WHEN is_demo=1 THEN 1 ELSE 0 END) AS demo
       FROM questions`,
    )
    .get() as any;
  const eligible = (db.prepare(`SELECT COUNT(*) n FROM questions q WHERE ${eligibleSql(db)}`).get() as any).n as number;
  return {
    date: pkg.date,
    timezone: config.timezone,
    serverTime: nowIso(),
    target: pkg.target,
    package: stats,
    bank: {
      total: bank.total ?? 0,
      approved: bank.approved ?? 0,
      needsReview: bank.needsReview ?? 0,
      draft: bank.draft ?? 0,
      demo: bank.demo ?? 0,
      eligible,
      // soal baru yang masih tersedia di luar paket hari ini (untuk hari berikutnya)
      unseenOutsidePackage: countUnseenEligible(db, userId) - (stats.size - stats.opened > 0 ? stats.size - stats.opened : 0),
      unseenTotal: countUnseenEligible(db, userId),
    },
    demoMode: demoModeOn(db),
    today: {
      new: scoreBlock(db, `a.user_id = ? AND a.kind = 'new' AND a.package_id = ?`, [userId, pkg.id]),
    },
    activeSessions: activeSessions(db, userId),
    remedial: remedialCounts(db, userId),
    sessionSizes: SESSION_SIZES,
    categories: categoriesWithCounts(db),
  };
}

export function progressReport(db: DB, userId: number) {
  const pkgs = db.prepare('SELECT * FROM daily_packages WHERE user_id = ? ORDER BY date DESC LIMIT 120').all(userId) as any[];
  const remedialRows = db.prepare(`SELECT graded_at FROM attempts WHERE user_id = ? AND kind = 'remedial' AND graded_at IS NOT NULL`).all(userId) as any[];
  const remedialByDate = new Map<string, number>();
  for (const r of remedialRows) {
    const d = localDate(new Date(r.graded_at));
    remedialByDate.set(d, (remedialByDate.get(d) ?? 0) + 1);
  }
  const today = localDate();
  const daily = pkgs
    .map((p) => {
      const stats = packageStats(db, { id: p.id, userId, date: p.date, target: p.target });
      return {
        date: p.date,
        target: p.target,
        size: stats.size,
        done: stats.done,
        awaitingGrade: stats.awaitingGrade,
        ...scoreBlock(db, `a.user_id = ? AND a.kind = 'new' AND a.package_id = ?`, [userId, p.id]),
        remedialDone: remedialByDate.get(p.date) ?? 0,
        isToday: p.date === today,
      };
    })
    .filter((d) => d.isToday || d.done > 0 || d.remedialDone > 0 || d.awaitingGrade > 0);

  const byFormat = db
    .prepare(
      `SELECT a.format, a.kind, COUNT(*) AS n, AVG(a.score) AS avg, SUM(a.is_correct) AS correct
       FROM attempts a WHERE a.user_id = ? AND a.graded_at IS NOT NULL GROUP BY a.format, a.kind`,
    )
    .all(userId);
  const byTopic = db
    .prepare(
      `SELECT q.category, c.name AS categoryName, q.topic, a.format, COUNT(*) AS n, AVG(a.score) AS avg, SUM(a.is_correct) AS correct
       FROM attempts a JOIN questions q ON q.id = a.question_id JOIN categories c ON c.slug = q.category
       WHERE a.user_id = ? AND a.graded_at IS NOT NULL
       GROUP BY q.category, q.topic, a.format ORDER BY c.sort_order, q.topic, a.format`,
    )
    .all(userId);
  // Topik lemah: rata-rata nilai < 60% dengan minimal 3 soal dinilai
  const weak = db
    .prepare(
      `SELECT q.category, c.name AS categoryName, q.topic, COUNT(*) AS n, AVG(a.score) AS avg
       FROM attempts a JOIN questions q ON q.id = a.question_id JOIN categories c ON c.slug = q.category
       WHERE a.user_id = ? AND a.graded_at IS NOT NULL
       GROUP BY q.category, q.topic HAVING COUNT(*) >= 3 AND AVG(a.score) < 0.6 ORDER BY avg ASC LIMIT 15`,
    )
    .all(userId);
  const totals = db
    .prepare(
      `SELECT SUM(CASE WHEN kind='new' THEN 1 ELSE 0 END) AS newDone, SUM(CASE WHEN kind='remedial' THEN 1 ELSE 0 END) AS remedialDone
       FROM attempts WHERE user_id = ? AND graded_at IS NOT NULL`,
    )
    .get(userId) as any;
  return {
    today,
    daily,
    byFormat,
    byTopic,
    weak,
    totals: { newDone: totals.newDone ?? 0, remedialDone: totals.remedialDone ?? 0 },
    categories: categoriesWithCounts(db),
  };
}

// ---------- Bank soal (tampilan peserta) ----------

const PROGRESS_SQL = `CASE
  WHEN la.is_correct = 1 THEN 'correct'
  WHEN la.is_correct = 0 THEN 'wrong'
  WHEN e.question_id IS NOT NULL OR ua.question_id IS NOT NULL THEN 'opened'
  ELSE 'unseen' END`;

export function listBank(db: DB, userId: number, f: Record<string, any>) {
  const page = Math.max(1, Number(f.page) || 1);
  const pageSize = Math.min(100, Math.max(5, Number(f.pageSize) || 20));
  const where: string[] = [eligibleSql(db)];
  const params: any = { u: userId };
  if (f.category) (where.push('q.category = @category'), (params.category = String(f.category)));
  if (f.format) (where.push('q.format = @format'), (params.format = String(f.format)));
  if (f.difficulty) (where.push('q.difficulty = @difficulty'), (params.difficulty = String(f.difficulty)));
  if (f.bookmarked === '1') where.push('b.question_id IS NOT NULL');
  if (f.sourceId) (where.push('q.source_id = @sourceId'), (params.sourceId = Number(f.sourceId)));
  if (f.progress) (where.push(`${PROGRESS_SQL} = @progress`), (params.progress = String(f.progress)));
  if (f.search) {
    // Isi soal yang belum dibuka tidak ikut dicari agar tidak membocorkan soal baru
    where.push(`(q.id LIKE @s OR q.topic LIKE @s OR q.subtopic LIKE @s OR q.body_region LIKE @s
      OR ((e.question_id IS NOT NULL OR ua.question_id IS NOT NULL OR la.question_id IS NOT NULL) AND q.content LIKE @s))`);
    params.s = `%${String(f.search).replace(/[%_]/g, ' ').trim()}%`;
  }
  const from = `FROM questions q
    JOIN categories c ON c.slug = q.category
    LEFT JOIN question_exposures e ON e.user_id = @u AND e.question_id = q.id
    LEFT JOIN bookmarks b ON b.user_id = @u AND b.question_id = q.id
    LEFT JOIN (SELECT DISTINCT question_id FROM attempts WHERE user_id = @u) ua ON ua.question_id = q.id
    LEFT JOIN (
      SELECT a.question_id, a.is_correct, a.score FROM attempts a
      WHERE a.user_id = @u AND a.graded_at IS NOT NULL
        AND a.rowid = (SELECT x.rowid FROM attempts x WHERE x.user_id = @u AND x.question_id = a.question_id AND x.graded_at IS NOT NULL ORDER BY x.graded_at DESC, x.rowid DESC LIMIT 1)
    ) la ON la.question_id = q.id
    WHERE ${where.join(' AND ')}`;
  const total = (db.prepare(`SELECT COUNT(*) n ${from}`).get(params) as any).n as number;
  const rows = db
    .prepare(
      `SELECT q.id, q.format, q.category, c.name AS categoryName, q.topic, q.subtopic, q.body_region AS bodyRegion, q.difficulty,
              q.is_demo AS demo, q.content, ${PROGRESS_SQL} AS progress, la.score AS lastScore, (b.question_id IS NOT NULL) AS bookmarked
       ${from} ORDER BY q.category, q.topic, q.id LIMIT @limit OFFSET @offset`,
    )
    .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize }) as any[];
  return {
    page,
    pageSize,
    total,
    pages: Math.max(1, Math.ceil(total / pageSize)),
    items: rows.map((r) => ({
      id: r.id,
      format: r.format,
      category: r.category,
      categoryName: r.categoryName,
      topic: r.topic,
      subtopic: r.subtopic,
      bodyRegion: r.bodyRegion,
      difficulty: r.difficulty,
      demo: !!r.demo,
      progress: r.progress,
      lastScore: r.lastScore,
      bookmarked: !!r.bookmarked,
      // Isi soal yang belum pernah dibuka disembunyikan agar tetap menjadi soal baru
      stem: r.progress === 'unseen' ? null : stemOf(r.format, JSON.parse(r.content)).slice(0, 220),
    })),
  };
}

export function bankDetail(db: DB, userId: number, id: string, role: string) {
  const q = getQuestion(db, id);
  if (!q) throw notFound('Soal');
  const isEligible = !!db.prepare(`SELECT 1 FROM questions q WHERE q.id = ? AND ${eligibleSql(db)}`).get(id);
  const attempts = db
    .prepare(
      `SELECT a.kind, a.response, a.submitted_at AS submittedAt, a.graded_at AS gradedAt, a.auto_graded AS autoGraded, a.is_correct AS isCorrect, a.score, a.grade, s.mode, s.status AS sessionStatus
       FROM attempts a JOIN sessions s ON s.id = a.session_id WHERE a.user_id = ? AND a.question_id = ? ORDER BY a.updated_at`,
    )
    .all(userId, id) as any[];
  const exposed = !!db.prepare('SELECT 1 FROM question_exposures WHERE user_id = ? AND question_id = ?').get(userId, id) || attempts.length > 0;
  const cat = db.prepare('SELECT name FROM categories WHERE slug = ?').get(q.category) as any;
  const meta = {
    id: q.id, format: q.format, category: q.category, categoryName: cat?.name ?? q.category, topic: q.topic, subtopic: q.subtopic,
    bodyRegion: q.bodyRegion, difficulty: q.difficulty, demo: q.demo,
  };
  if (!isEligible && role !== 'admin') throw notFound('Soal');
  if (!exposed) return { question: { ...meta, content: null }, hidden: true, attempts: [], reveal: null, bookmarked: false };
  // Kunci & pembahasan hanya setelah ada penilaian, dan tidak saat soal masih dikerjakan di sesi ujian aktif
  const graded = attempts.some((a) => a.gradedAt);
  const inActiveExam = attempts.some((a) => a.mode === 'exam' && a.sessionStatus === 'active');
  return {
    question: { ...meta, content: publicContent(q.format, q.content) },
    hidden: false,
    bookmarked: !!db.prepare('SELECT 1 FROM bookmarks WHERE user_id = ? AND question_id = ?').get(userId, id),
    attempts: attempts
      .filter((a) => a.gradedAt)
      .map((a) => ({ kind: a.kind, gradedAt: a.gradedAt, autoGraded: !!a.autoGraded, isCorrect: !!a.isCorrect, score: a.score, response: JSON.parse(a.response), grade: a.grade ? JSON.parse(a.grade) : null })),
    reveal: graded && !inActiveExam ? { content: q.content, reference: referenceView(db, q, role) } : null,
  };
}

// ---------- Cadangan progres ----------

const BACKUP_VERSION = 1;

export function exportBackup(db: DB, userId: number) {
  const all = (sql: string) => db.prepare(sql).all(userId);
  return {
    app: 'orthoboard-reference-lab',
    kind: 'progress-backup',
    version: BACKUP_VERSION,
    exportedAt: nowIso(),
    packages: all('SELECT id, date, target, created_at FROM daily_packages WHERE user_id = ?'),
    packageItems: all('SELECT i.* FROM daily_package_items i JOIN daily_packages p ON p.id = i.package_id WHERE p.user_id = ? ORDER BY i.package_id, i.position'),
    exposures: all('SELECT question_id, package_id, opened_at FROM question_exposures WHERE user_id = ?'),
    sessions: all('SELECT id, kind, mode, package_id, status, current_index, elapsed_seconds, time_limit_seconds, label, created_at, finished_at FROM sessions WHERE user_id = ?'),
    sessionItems: all('SELECT i.* FROM session_items i JOIN sessions s ON s.id = i.session_id WHERE s.user_id = ? ORDER BY i.session_id, i.position'),
    attempts: all('SELECT id, question_id, session_id, package_id, kind, format, question_version, response, submitted_at, graded_at, auto_graded, is_correct, score, grade, updated_at FROM attempts WHERE user_id = ?'),
    bookmarks: all('SELECT question_id, created_at FROM bookmarks WHERE user_id = ?'),
  };
}

/**
 * Memulihkan cadangan: progres pengguna saat ini DIGANTI dengan isi cadangan (dalam satu transaksi).
 * Baris yang merujuk soal yang tidak ada di bank dilewati dan dilaporkan.
 */
export function importBackup(db: DB, userId: number, data: any) {
  if (!data || data.app !== 'orthoboard-reference-lab' || data.kind !== 'progress-backup') throw badRequest('Berkas bukan cadangan progres OrthoBoard.');
  if (data.version !== BACKUP_VERSION) throw badRequest(`Versi cadangan ${data.version} tidak didukung.`);
  const arr = (x: any): any[] => (Array.isArray(x) ? x : []);
  const known = new Set((db.prepare('SELECT id FROM questions').all() as any[]).map((r) => r.id));
  const skipped = new Set<string>();
  const ok = (qid: string) => (known.has(qid) ? true : (skipped.add(qid), false));
  const counts = { packages: 0, packageItems: 0, exposures: 0, sessions: 0, sessionItems: 0, attempts: 0, bookmarks: 0 };
  db.transaction(() => {
    for (const t of ['attempts', 'sessions', 'question_exposures', 'bookmarks', 'daily_packages']) db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(userId);
    const pkgIds = new Set<string>();
    for (const p of arr(data.packages)) {
      db.prepare('INSERT INTO daily_packages (id, user_id, date, target, created_at) VALUES (?, ?, ?, ?, ?)').run(p.id, userId, p.date, p.target, p.created_at);
      pkgIds.add(p.id);
      counts.packages++;
    }
    for (const i of arr(data.packageItems)) {
      if (!pkgIds.has(i.package_id) || !ok(i.question_id)) continue;
      db.prepare('INSERT INTO daily_package_items (package_id, position, question_id) VALUES (?, ?, ?)').run(i.package_id, i.position, i.question_id);
      counts.packageItems++;
    }
    for (const e of arr(data.exposures)) {
      if (!ok(e.question_id)) continue;
      db.prepare('INSERT INTO question_exposures (user_id, question_id, package_id, opened_at) VALUES (?, ?, ?, ?)').run(userId, e.question_id, e.package_id, e.opened_at);
      counts.exposures++;
    }
    const sessIds = new Set<string>();
    for (const s of arr(data.sessions)) {
      db.prepare(
        `INSERT INTO sessions (id, user_id, kind, mode, package_id, status, current_index, elapsed_seconds, time_limit_seconds, label, created_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(s.id, userId, s.kind, s.mode, pkgIds.has(s.package_id) ? s.package_id : null, s.status, s.current_index, s.elapsed_seconds, s.time_limit_seconds, s.label, s.created_at, s.finished_at);
      sessIds.add(s.id);
      counts.sessions++;
    }
    for (const i of arr(data.sessionItems)) {
      if (!sessIds.has(i.session_id) || !ok(i.question_id)) continue;
      db.prepare('INSERT INTO session_items (session_id, position, question_id, opened_at) VALUES (?, ?, ?, ?)').run(i.session_id, i.position, i.question_id, i.opened_at);
      counts.sessionItems++;
    }
    for (const a of arr(data.attempts)) {
      if (!sessIds.has(a.session_id) || !ok(a.question_id)) continue;
      db.prepare(
        `INSERT INTO attempts (id, user_id, question_id, session_id, package_id, kind, format, question_version, response, submitted_at, graded_at, auto_graded, is_correct, score, grade, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(a.id, userId, a.question_id, a.session_id, a.package_id, a.kind, a.format, a.question_version, a.response, a.submitted_at, a.graded_at, a.auto_graded, a.is_correct, a.score, a.grade, a.updated_at);
      counts.attempts++;
    }
    for (const b of arr(data.bookmarks)) {
      if (!ok(b.question_id)) continue;
      db.prepare('INSERT INTO bookmarks (user_id, question_id, created_at) VALUES (?, ?, ?)').run(userId, b.question_id, b.created_at);
      counts.bookmarks++;
    }
  })();
  return { restored: counts, skippedQuestionIds: [...skipped] };
}

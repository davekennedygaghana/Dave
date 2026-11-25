import crypto from 'node:crypto';
import type { DB } from '../db.js';
import { eligibleSql, demoModeOn } from '../db.js';
import { config } from '../config.js';
import { localDate, nowIso } from '../clock.js';

export interface DailyPackage {
  id: string;
  userId: number;
  date: string;
  target: number;
}

const orderKey = (seed: string, id: string) => crypto.createHash('sha256').update(`${seed}|${id}`).digest('hex');

/**
 * Soal yang layak menjadi "soal baru" bagi pengguna: memenuhi syarat paket, belum pernah dibuka
 * dalam mode soal baru, belum punya percobaan soal baru, dan belum ada di paket ini.
 */
function unseenEligibleIds(db: DB, userId: number, excludePackageId: string | null): string[] {
  const rows = db
    .prepare(
      `SELECT q.id FROM questions q
       WHERE ${eligibleSql(db)}
         AND NOT EXISTS (SELECT 1 FROM question_exposures e WHERE e.user_id = ? AND e.question_id = q.id)
         AND NOT EXISTS (SELECT 1 FROM attempts a WHERE a.user_id = ? AND a.question_id = q.id AND a.kind = 'new')
         AND NOT EXISTS (SELECT 1 FROM daily_package_items i WHERE i.package_id = ? AND i.question_id = q.id)`,
    )
    .all(userId, userId, excludePackageId ?? '') as { id: string }[];
  return rows.map((r) => r.id);
}

export function countUnseenEligible(db: DB, userId: number): number {
  return unseenEligibleIds(db, userId, null).length;
}

/**
 * Mengambil paket harian untuk tanggal (WITA) saat ini; dibuat saat pertama kali diakses pada tanggal itu,
 * sehingga pergantian tanggal tidak memerlukan proses latar belakang.
 * Urutan disimpan di database sehingga tetap sama setelah muat ulang. Bila paket belum mencapai target
 * dan ada soal tervalidasi baru, soal itu DITAMBAHKAN di akhir (urutan lama tidak berubah).
 */
export function getOrCreatePackage(db: DB, userId: number, date: string = localDate()): DailyPackage {
  return db.transaction(() => {
    let row = db.prepare('SELECT * FROM daily_packages WHERE user_id = ? AND date = ?').get(userId, date) as any;
    if (!row) {
      const id = crypto.randomUUID();
      db.prepare('INSERT INTO daily_packages (id, user_id, date, target, created_at) VALUES (?, ?, ?, ?, ?)').run(id, userId, date, config.dailyTarget, nowIso());
      row = { id, user_id: userId, date, target: config.dailyTarget };
    }
    // Isi / tambah hanya untuk paket tanggal berjalan
    if (date === localDate()) {
      const size = (db.prepare('SELECT COUNT(*) n FROM daily_package_items WHERE package_id = ?').get(row.id) as any).n as number;
      const room = row.target - size;
      if (room > 0) {
        const seed = `${userId}|${date}`;
        const picked = unseenEligibleIds(db, userId, row.id)
          .map((id) => ({ id, k: orderKey(seed, id) }))
          .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0))
          .slice(0, room);
        const maxPos = (db.prepare('SELECT COALESCE(MAX(position), 0) p FROM daily_package_items WHERE package_id = ?').get(row.id) as any).p as number;
        const ins = db.prepare('INSERT INTO daily_package_items (package_id, position, question_id) VALUES (?, ?, ?)');
        picked.forEach((p, i) => ins.run(row.id, maxPos + 1 + i, p.id));
      }
    }
    return { id: row.id, userId, date: row.date, target: row.target };
  })();
}

export interface PackageStats {
  date: string;
  target: number;
  size: number; // jumlah soal sebenarnya di paket (yang masih layak atau sudah dinilai)
  done: number; // dijawab DAN dinilai
  opened: number; // sudah dibuka
  awaitingGrade: number; // jawaban terkunci, menunggu nilai mandiri
  remaining: number;
  shortfall: number; // kekurangan terhadap target
  containsDemo: boolean;
}

export function packageStats(db: DB, pkg: DailyPackage): PackageStats {
  const r = db
    .prepare(
      `SELECT
         SUM(CASE WHEN a.graded_at IS NOT NULL OR ${eligibleSql(db)} THEN 1 ELSE 0 END) AS size,
         SUM(CASE WHEN a.graded_at IS NOT NULL THEN 1 ELSE 0 END) AS done,
         SUM(CASE WHEN e.question_id IS NOT NULL THEN 1 ELSE 0 END) AS opened,
         SUM(CASE WHEN a.submitted_at IS NOT NULL AND a.graded_at IS NULL THEN 1 ELSE 0 END) AS awaiting,
         SUM(CASE WHEN q.is_demo = 1 THEN 1 ELSE 0 END) AS demo
       FROM daily_package_items i
       JOIN questions q ON q.id = i.question_id
       LEFT JOIN attempts a ON a.user_id = ? AND a.question_id = i.question_id AND a.kind = 'new'
       LEFT JOIN question_exposures e ON e.user_id = ? AND e.question_id = i.question_id
       WHERE i.package_id = ?`,
    )
    .get(pkg.userId, pkg.userId, pkg.id) as any;
  const size = r.size ?? 0;
  const done = r.done ?? 0;
  return {
    date: pkg.date,
    target: pkg.target,
    size,
    done,
    opened: r.opened ?? 0,
    awaitingGrade: r.awaiting ?? 0,
    remaining: size - done,
    shortfall: Math.max(0, pkg.target - size),
    containsDemo: (r.demo ?? 0) > 0 && demoModeOn(db),
  };
}

/** Butir paket yang masih bisa disajikan sebagai soal baru: belum dikunci/dinilai dan soalnya masih layak. */
export function pendingPackageItems(db: DB, pkg: DailyPackage, limit: number): { questionId: string; attemptId: string | null }[] {
  return db
    .prepare(
      `SELECT i.question_id AS questionId, a.id AS attemptId
       FROM daily_package_items i
       JOIN questions q ON q.id = i.question_id
       LEFT JOIN attempts a ON a.user_id = ? AND a.question_id = i.question_id AND a.kind = 'new'
       WHERE i.package_id = ? AND ${eligibleSql(db)} AND (a.id IS NULL OR a.submitted_at IS NULL)
       ORDER BY i.position LIMIT ?`,
    )
    .all(pkg.userId, pkg.id, limit) as any[];
}

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

export type DB = Database.Database;

function migrationsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // server/src (tsx) -> server/migrations ; dist/server (build) -> server/migrations
  const candidates = [path.resolve(here, '../migrations'), path.resolve(here, '../../server/migrations')];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error('Folder migrasi tidak ditemukan');
  return found;
}

/** Menjalankan berkas migrasi *.sql yang belum diterapkan, berurutan menurut nama berkas. */
export function migrate(db: DB) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const applied = new Set(db.prepare('SELECT name FROM schema_migrations').all().map((r: any) => r.name));
  const dir = migrationsDir();
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(file, new Date().toISOString());
    })();
  }
}

export function openDb(file?: string): DB {
  let target = file;
  if (!target) {
    fs.mkdirSync(config.dataDir, { recursive: true });
    target = path.join(config.dataDir, 'orthoboard.sqlite');
  }
  const db = new Database(target);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

export function getSetting(db: DB, key: string, fallback: string): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? row.value : fallback;
}

export function setSetting(db: DB, key: string, value: string) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

export function demoModeOn(db: DB): boolean {
  return getSetting(db, 'demo_mode', '0') === '1';
}

/**
 * Syarat SQL soal layak masuk paket latihan:
 *  - resmi: status disetujui dan bukan demo
 *  - bila mode demo aktif: soal berlabel DEMO juga ikut (paket akan ditandai DEMO)
 */
export function eligibleSql(db: DB, alias = 'q'): string {
  const official = `(${alias}.status = 'approved' AND ${alias}.is_demo = 0)`;
  return demoModeOn(db) ? `(${official} OR ${alias}.is_demo = 1)` : official;
}

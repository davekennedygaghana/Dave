import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { DB } from './db.js';
import { config } from './config.js';
import { now, nowIso } from './clock.js';

export interface User {
  id: number;
  username: string;
  role: 'admin' | 'learner';
}

const COOKIE = 'ob_session';
const SESSION_DAYS = 30;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), 64);
  const expected = Buffer.from(hashHex, 'hex');
  return hash.length === expected.length && crypto.timingSafeEqual(hash, expected);
}

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export function createUser(db: DB, username: string, password: string, role: 'admin' | 'learner'): number {
  if (!username.trim()) throw new Error('Nama pengguna wajib diisi');
  if (password.length < 8) throw new Error('Sandi minimal 8 karakter');
  const r = db
    .prepare('INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)')
    .run(username.trim(), hashPassword(password), role, nowIso());
  return Number(r.lastInsertRowid);
}

export function setPassword(db: DB, username: string, password: string): boolean {
  if (password.length < 8) throw new Error('Sandi minimal 8 karakter');
  const r = db.prepare('UPDATE users SET password_hash = ? WHERE username = ?').run(hashPassword(password), username);
  if (r.changes) db.prepare('DELETE FROM auth_sessions WHERE user_id = (SELECT id FROM users WHERE username = ?)').run(username);
  return r.changes > 0;
}

/** Membuat admin awal dari environment jika belum ada pengguna sama sekali. */
export function ensureAdmin(db: DB): string | null {
  const n = (db.prepare('SELECT COUNT(*) n FROM users').get() as any).n as number;
  if (n > 0) return null;
  if (!config.adminPassword) {
    return 'Belum ada pengguna dan ADMIN_PASSWORD kosong. Isi ADMIN_PASSWORD (min. 8 karakter) di .env lalu jalankan ulang.';
  }
  createUser(db, config.adminUsername, config.adminPassword, 'admin');
  return null;
}

export function login(db: DB, username: string, password: string): { token: string; user: User } | null {
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username).trim()) as any;
  if (!row || !verifyPassword(String(password), row.password_hash)) return null;
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(now().getTime() + SESSION_DAYS * 86400_000).toISOString();
  db.prepare('INSERT INTO auth_sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(sha(token), row.id, expires, nowIso());
  db.prepare('DELETE FROM auth_sessions WHERE expires_at < ?').run(nowIso());
  return { token, user: { id: row.id, username: row.username, role: row.role } };
}

function readCookie(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function setSessionCookie(res: Response, token: string) {
  const attrs = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${SESSION_DAYS * 86400}`];
  if (config.cookieSecure) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

export function clearSessionCookie(res: Response) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export function logout(db: DB, req: Request) {
  const token = readCookie(req);
  if (token) db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(sha(token));
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: User;
  }
}

export function authMiddleware(db: DB) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const token = readCookie(req);
    if (token) {
      const row = db
        .prepare(
          `SELECT u.id, u.username, u.role FROM auth_sessions s JOIN users u ON u.id = s.user_id
           WHERE s.token_hash = ? AND s.expires_at > ?`,
        )
        .get(sha(token), nowIso()) as User | undefined;
      if (row) req.user = row;
    }
    next();
  };
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' });
  // Perlindungan CSRF sederhana: permintaan yang mengubah data wajib membawa header khusus
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers['x-requested-with'] !== 'orthoboard') {
    return res.status(403).json({ error: 'Permintaan ditolak.' });
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Khusus admin.' });
  next();
}

// Pembatas percobaan masuk (di memori, per alamat IP)
const attempts = new Map<string, { n: number; reset: number }>();
export function loginRateLimit(req: Request, res: Response, next: NextFunction) {
  const key = req.ip ?? 'x';
  const t = Date.now();
  const a = attempts.get(key);
  if (!a || a.reset < t) attempts.set(key, { n: 1, reset: t + 10 * 60_000 });
  else if (++a.n > 20) return res.status(429).json({ error: 'Terlalu banyak percobaan masuk. Coba lagi 10 menit lagi.' });
  next();
}

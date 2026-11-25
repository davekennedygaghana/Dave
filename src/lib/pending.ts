import { putSession } from './db';
import type { Session } from './types';

/**
 * Penyangga draft sinkron (localStorage) untuk menutup celah ketika halaman di-refresh/ditutup
 * sebelum penulisan IndexedDB yang di-debounce selesai. Data utama tetap di IndexedDB.
 */
const KEY = (id: string) => `osce-harian:pending:${id}`;

interface Pending {
  updatedAt: string;
  progress: Session['progress'];
  currentIndex: number;
}

export function writePending(s: Session) {
  try {
    const p: Pending = { updatedAt: s.updatedAt, progress: s.progress, currentIndex: s.currentIndex };
    localStorage.setItem(KEY(s.id), JSON.stringify(p));
  } catch {
    /* localStorage tidak tersedia (mode privat) — abaikan */
  }
}

export function clearPending(id: string) {
  try {
    localStorage.removeItem(KEY(id));
  } catch {
    /* abaikan */
  }
}

/** Terapkan draft tertunda bila lebih baru dari yang tersimpan di IndexedDB. */
export async function recoverPending(s: Session): Promise<Session> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY(s.id));
  } catch {
    return s;
  }
  if (!raw) return s;
  try {
    const p = JSON.parse(raw) as Pending;
    if (p.updatedAt >= s.updatedAt && p.progress && Object.keys(p.progress).every((id) => s.progress[id])) {
      const merged: Session = { ...s, progress: p.progress, currentIndex: p.currentIndex, updatedAt: p.updatedAt };
      await putSession(merged);
      clearPending(s.id);
      return merged;
    }
  } catch {
    /* data rusak — abaikan */
  }
  clearPending(s.id);
  return s;
}

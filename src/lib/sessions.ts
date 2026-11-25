import { DEMO_STATIONS } from '../data/demoStations';
import { cycleDateFor } from './cycle';
import { addSessionIfAbsent, getAllSessions, getAllStations, getSession, putSession } from './db';
import { buildSession, resetSessionProgress, sessionId, TARGET_PACK_SIZE } from './pack';
import { clearPending } from './pending';
import type { BankStation, Session, SessionKind } from './types';

/** Bank untuk paket tertentu: stasiun sumber dari DB, atau demo bawaan + demo impor. */
export async function loadBank(): Promise<BankStation[]> {
  const stored = await getAllStations();
  const ids = new Set(stored.map((s) => s.id));
  return [...stored, ...DEMO_STATIONS.filter((d) => !ids.has(d.id))];
}

export interface TodayState {
  cycleDate: string;
  session: Session | null;
  eligibleNow: number;
}

/**
 * Ambil (atau buat) sesi untuk siklus saat ini. Snapshot dibuat sekali; setelah itu
 * refresh/impor tidak mengubah isi maupun urutan.
 */
export async function ensureSession(kind: SessionKind, now: Date = new Date(), target = TARGET_PACK_SIZE): Promise<TodayState> {
  const cycleDate = cycleDateFor(now);
  const bank = await loadBank();
  const eligibleNow = new Set(bank.filter((s) => s.eligible && s.demo === (kind === 'demo')).map((s) => s.id)).size;
  const existing = await getSession(sessionId(kind, cycleDate));
  if (existing) return { cycleDate, session: existing, eligibleNow };
  const built = buildSession(bank, cycleDate, kind, now, target);
  if (!built) return { cycleDate, session: null, eligibleNow };
  const saved = await addSessionIfAbsent(built);
  return { cycleDate, session: saved, eligibleNow };
}

export async function peekSession(kind: SessionKind, now: Date = new Date()): Promise<Session | undefined> {
  return getSession(sessionId(kind, cycleDateFor(now)));
}

export async function listSessions(): Promise<Session[]> {
  const all = await getAllSessions();
  return all.sort((a, b) => (a.cycleDate === b.cycleDate ? a.kind.localeCompare(b.kind) : a.cycleDate < b.cycleDate ? 1 : -1));
}

export async function saveSession(s: Session): Promise<void> {
  await putSession(s);
}

export async function resetSession(id: string, now: Date = new Date()): Promise<Session | null> {
  const s = await getSession(id);
  if (!s) return null;
  const r = resetSessionProgress(s, now);
  clearPending(id);
  await putSession(r);
  return r;
}

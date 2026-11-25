import { seededShuffle } from './rng';
import type { BankStation, Session, SessionKind, Station, StationProgress } from './types';

export const TARGET_PACK_SIZE = 25;

/**
 * Pilih stasiun paket secara deterministik dari tanggal siklus.
 * - Hanya stasiun layak (eligible) dengan jenis yang sesuai (sumber vs demo).
 * - Tidak pernah menggandakan stasiun: tiap ID paling banyak sekali.
 * - Seimbang antar-topik (round-robin) lalu diacak ulang dengan seed tanggal.
 * Hasil tidak bergantung pada urutan impor karena diurutkan berdasarkan ID terlebih dulu.
 */
export function selectPackStations(
  bank: readonly BankStation[],
  cycleDate: string,
  kind: SessionKind,
  target = TARGET_PACK_SIZE,
): BankStation[] {
  const pool = new Map<string, BankStation>();
  for (const s of bank) {
    if (!s.eligible) continue;
    if ((kind === 'demo') !== s.demo) continue;
    if (!pool.has(s.id)) pool.set(s.id, s);
  }
  const sorted = [...pool.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const byTopic = new Map<string, BankStation[]>();
  for (const s of sorted) {
    const list = byTopic.get(s.topic) ?? [];
    list.push(s);
    byTopic.set(s.topic, list);
  }
  const topics = seededShuffle([...byTopic.keys()].sort(), `${kind}:${cycleDate}:topics`);
  const queues = topics.map((t) => seededShuffle(byTopic.get(t)!, `${kind}:${cycleDate}:${t}`));

  const picked: BankStation[] = [];
  let progressed = true;
  while (picked.length < target && progressed) {
    progressed = false;
    for (const q of queues) {
      if (picked.length >= target) break;
      const next = q.shift();
      if (next) {
        picked.push(next);
        progressed = true;
      }
    }
  }
  return seededShuffle(picked, `${kind}:${cycleDate}:order`);
}

export function emptyProgress(stationId: string): StationProgress {
  return { stationId, stage: 'clinical', draftClinical: '', draftFollowup: '', checked: {} };
}

/** Salin stasiun tanpa metadata bank agar snapshot sesi berdiri sendiri. */
export function toSnapshot(s: BankStation): Station {
  const { eligible: _e, issues: _i, importedAt: _t, bankName: _b, ...station } = s;
  return JSON.parse(JSON.stringify(station)) as Station;
}

export function sessionId(kind: SessionKind, cycleDate: string): string {
  return `${kind}:${cycleDate}`;
}

export function buildSession(
  bank: readonly BankStation[],
  cycleDate: string,
  kind: SessionKind,
  now: Date = new Date(),
  target = TARGET_PACK_SIZE,
): Session | null {
  const picked = selectPackStations(bank, cycleDate, kind, target);
  if (picked.length === 0) return null;
  const eligibleCount = new Set(bank.filter((s) => s.eligible && s.demo === (kind === 'demo')).map((s) => s.id)).size;
  const stations = picked.map(toSnapshot);
  const progress: Record<string, StationProgress> = {};
  for (const s of stations) progress[s.id] = emptyProgress(s.id);
  const iso = now.toISOString();
  return {
    id: sessionId(kind, cycleDate),
    kind,
    cycleDate,
    createdAt: iso,
    updatedAt: iso,
    targetSize: target,
    stations,
    progress,
    currentIndex: 0,
    eligibleAtCreation: eligibleCount,
  };
}

/** Kosongkan progres sesi tanpa mengubah snapshot stasiun maupun urutannya. */
export function resetSessionProgress(session: Session, now: Date = new Date()): Session {
  const progress: Record<string, StationProgress> = {};
  for (const s of session.stations) progress[s.id] = emptyProgress(s.id);
  return { ...session, progress, currentIndex: 0, updatedAt: now.toISOString() };
}

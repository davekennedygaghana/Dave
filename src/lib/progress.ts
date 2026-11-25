import { checkKey, type Phase } from './scoring';
import type { Session, StationProgress } from './types';

/** Transisi murni pada sesi. Semua mengembalikan objek sesi baru. */

function update(session: Session, stationId: string, fn: (p: StationProgress) => StationProgress | null, now: Date): Session {
  const p = session.progress[stationId];
  if (!p) throw new Error(`Stasiun ${stationId} tidak ada di sesi ini.`);
  const next = fn(p);
  if (!next) return session;
  return { ...session, progress: { ...session.progress, [stationId]: next }, updatedAt: now.toISOString() };
}

export function saveDraft(session: Session, stationId: string, phase: Phase, text: string, now = new Date()): Session {
  return update(session, stationId, (p) => {
    if (phase === 'clinical' && p.stage !== 'clinical') return null; // sudah terkunci
    if (phase === 'followup' && p.stage !== 'followup') return null;
    return phase === 'clinical' ? { ...p, draftClinical: text } : { ...p, draftFollowup: text };
  }, now);
}

export function submitClinical(session: Session, stationId: string, now = new Date()): Session {
  return update(session, stationId, (p) => {
    if (p.stage !== 'clinical') return null;
    return { ...p, stage: 'followup', answerClinical: p.draftClinical, submittedClinicalAt: now.toISOString() };
  }, now);
}

export function submitFollowup(session: Session, stationId: string, now = new Date()): Session {
  return update(session, stationId, (p) => {
    if (p.stage !== 'followup') return null;
    return { ...p, stage: 'review', answerFollowup: p.draftFollowup, submittedFollowupAt: now.toISOString() };
  }, now);
}

export function toggleCheck(session: Session, stationId: string, phase: Phase, itemId: string, value: boolean, now = new Date()): Session {
  return update(session, stationId, (p) => {
    if (p.stage !== 'review') return null; // checklist hanya bisa diisi saat review
    return { ...p, checked: { ...p.checked, [checkKey(phase, itemId)]: value } };
  }, now);
}

export function markReviewed(session: Session, stationId: string, now = new Date()): Session {
  const s = update(session, stationId, (p) => (p.stage === 'review' ? { ...p, reviewedAt: p.reviewedAt ?? now.toISOString() } : null), now);
  return s;
}

export function goTo(session: Session, index: number, now = new Date()): Session {
  const i = Math.max(0, Math.min(session.stations.length - 1, index));
  if (i === session.currentIndex) return session;
  return { ...session, currentIndex: i, updatedAt: now.toISOString() };
}

/** Indeks stasiun berikutnya yang belum direview (melingkar), atau -1 bila semua selesai. */
export function nextUnreviewed(session: Session, from: number): number {
  const n = session.stations.length;
  for (let k = 1; k <= n; k++) {
    const i = (from + k) % n;
    if (!session.progress[session.stations[i].id]?.reviewedAt) return i;
  }
  return -1;
}

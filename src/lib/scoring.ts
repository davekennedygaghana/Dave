import type { ChecklistItem, Session, Station, StationProgress } from './types';

export type Phase = 'clinical' | 'followup';

export const checkKey = (phase: Phase, itemId: string) => `${phase}:${itemId}`;

export function sumWeights(items: readonly ChecklistItem[]): number {
  return items.reduce((a, i) => a + i.weight, 0);
}

export function stationMax(s: Station): number {
  return sumWeights(s.checklist.clinical) + sumWeights(s.checklist.followup);
}

export function phaseScore(s: Station, p: StationProgress | undefined, phase: Phase): number {
  if (!p) return 0;
  return s.checklist[phase].reduce((a, i) => a + (p.checked[checkKey(phase, i.id)] ? i.weight : 0), 0);
}

export function stationScore(s: Station, p: StationProgress | undefined): number {
  return phaseScore(s, p, 'clinical') + phaseScore(s, p, 'followup');
}

export interface SessionStats {
  stationCount: number;
  responseTotal: number;
  /** Respons yang benar-benar dikunci (draft tidak dihitung). */
  responsesSubmitted: number;
  stationsReviewed: number;
  score: number;
  /** Penyebut skor = jumlah bobot seluruh butir checklist di paket. */
  maxScore: number;
  /** Skor dari stasiun yang sudah direview saja, dan penyebutnya. */
  reviewedScore: number;
  reviewedMax: number;
  complete: boolean;
}

export function sessionStats(session: Session): SessionStats {
  let submitted = 0;
  let reviewed = 0;
  let score = 0;
  let max = 0;
  let reviewedScore = 0;
  let reviewedMax = 0;
  for (const s of session.stations) {
    const p = session.progress[s.id];
    if (p?.submittedClinicalAt) submitted++;
    if (p?.submittedFollowupAt) submitted++;
    const sm = stationMax(s);
    max += sm;
    if (p?.stage === 'review') {
      const sc = stationScore(s, p);
      score += sc;
      if (p.reviewedAt) {
        reviewed++;
        reviewedScore += sc;
        reviewedMax += sm;
      }
    }
  }
  return {
    stationCount: session.stations.length,
    responseTotal: session.stations.length * 2,
    responsesSubmitted: submitted,
    stationsReviewed: reviewed,
    score,
    maxScore: max,
    reviewedScore,
    reviewedMax,
    complete: session.stations.length > 0 && reviewed === session.stations.length,
  };
}

export interface TopicScore {
  topic: string;
  score: number;
  max: number;
  stations: number;
}

export interface MissedItem {
  stationId: string;
  stationTitle: string;
  phase: Phase;
  text: string;
  weight: number;
}

export interface SessionSummary {
  stats: SessionStats;
  byTopic: TopicScore[];
  /** Stasiun dengan skor < ambang (default 60%) atau belum direview. */
  toRepeat: { stationId: string; title: string; topic: string; score: number; max: number; reason: string }[];
  missed: MissedItem[];
}

export const REPEAT_THRESHOLD = 0.6;

export function sessionSummary(session: Session, threshold = REPEAT_THRESHOLD): SessionSummary {
  const stats = sessionStats(session);
  const topics = new Map<string, TopicScore>();
  const toRepeat: SessionSummary['toRepeat'] = [];
  const missed: MissedItem[] = [];
  for (const s of session.stations) {
    const p = session.progress[s.id];
    const max = stationMax(s);
    const sc = p?.stage === 'review' ? stationScore(s, p) : 0;
    const t = topics.get(s.topic) ?? { topic: s.topic, score: 0, max: 0, stations: 0 };
    t.score += sc;
    t.max += max;
    t.stations += 1;
    topics.set(s.topic, t);
    if (!p?.reviewedAt) {
      toRepeat.push({ stationId: s.id, title: s.title, topic: s.topic, score: sc, max, reason: 'Belum selesai direview' });
      continue;
    }
    if (max > 0 && sc / max < threshold) {
      toRepeat.push({ stationId: s.id, title: s.title, topic: s.topic, score: sc, max, reason: `Skor < ${Math.round(threshold * 100)}%` });
    }
    for (const phase of ['clinical', 'followup'] as const) {
      for (const item of s.checklist[phase]) {
        if (!p.checked[checkKey(phase, item.id)]) {
          missed.push({ stationId: s.id, stationTitle: s.title, phase, text: item.text, weight: item.weight });
        }
      }
    }
  }
  return {
    stats,
    byTopic: [...topics.values()].sort((a, b) => a.topic.localeCompare(b.topic)),
    toRepeat,
    missed,
  };
}

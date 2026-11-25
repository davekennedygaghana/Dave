import { zipSync, strToU8 } from 'fflate';
import type { BankStation } from '../src/lib/types';

export const TOPICS = ['trauma', 'spine', 'sports', 'pediatrics', 'tumor', 'hand-upper-limb', 'foot-ankle', 'adult-reconstruction'];

export function rawStation(id: string, topic = 'trauma', extra: Record<string, unknown> = {}) {
  return {
    id,
    topic,
    title: `Stasiun netral ${id}`,
    vignette: `Vignette ${id}`,
    clinicalQuestion: 'Apa diagnosis kerja Anda?',
    followupQuestion: 'Interpretasikan informasi lanjutan.',
    followupInfo: 'Informasi lanjutan.',
    imagingRequired: false,
    assets: [],
    key: { clinical: `KUNCI-KLINIS-${id}`, followup: `KUNCI-LANJUTAN-${id}` },
    discussion: [{ heading: 'Diagnosis', body: `Pembahasan ${id}` }],
    checklist: {
      clinical: [
        { id: 'c1', text: 'Butir klinis 1', weight: 2 },
        { id: 'c2', text: 'Butir klinis 2' },
      ],
      followup: [{ id: 'f1', text: 'Butir lanjutan 1', weight: 3 }],
    },
    source: { document: 'Dokumen Uji.pdf', scenario: '1', paraphrased: true },
    ...extra,
  };
}

export function bankStation(id: string, topic = 'trauma', extra: Partial<BankStation> = {}): BankStation {
  const r = rawStation(id, topic) as unknown as BankStation;
  return {
    ...r,
    checklist: {
      clinical: [
        { id: 'c1', text: 'Butir klinis 1', weight: 2 },
        { id: 'c2', text: 'Butir klinis 2', weight: 1 },
      ],
      followup: [{ id: 'f1', text: 'Butir lanjutan 1', weight: 3 }],
    },
    demo: false,
    eligible: true,
    issues: [],
    importedAt: '2026-01-01T00:00:00Z',
    bankName: 'Uji',
    ...extra,
  };
}

export function makeBank(n: number): BankStation[] {
  return Array.from({ length: n }, (_, i) => bankStation(`st-${String(i).padStart(3, '0')}`, TOPICS[i % TOPICS.length]));
}

export function makeZip(stations: unknown[], files: Record<string, Uint8Array> = {}, prefix = ''): Uint8Array {
  const entries: Record<string, Uint8Array> = {
    [`${prefix}stations.json`]: strToU8(JSON.stringify({ schemaVersion: 1, bank: { name: 'Bank ZIP Uji' }, stations })),
  };
  for (const [k, v] of Object.entries(files)) entries[prefix + k] = v;
  return zipSync(entries);
}

export const PNG_1PX = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
);

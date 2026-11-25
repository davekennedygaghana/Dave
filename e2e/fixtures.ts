export const TOPICS = ['trauma', 'spine', 'sports', 'pediatrics', 'tumor', 'hand-upper-limb', 'foot-ankle', 'adult-reconstruction'];

export function station(i: number, prefix = 'e2e') {
  const id = `${prefix}-${String(i).padStart(3, '0')}`;
  return {
    id,
    topic: TOPICS[i % TOPICS.length],
    title: `Judul netral ${id}`,
    vignette: `Vignette untuk ${id}.`,
    clinicalQuestion: `Pertanyaan klinis ${id}?`,
    followupQuestion: `Pertanyaan lanjutan ${id}?`,
    followupInfo: `Info lanjutan ${id}.`,
    imagingRequired: false,
    assets: [],
    key: { clinical: `RAHASIA-KUNCI-KLINIS-${id}`, followup: `RAHASIA-KUNCI-LANJUTAN-${id}` },
    discussion: [{ heading: 'Diagnosis', body: `RAHASIA-PEMBAHASAN-${id}` }],
    checklist: {
      clinical: [
        { id: 'c1', text: `Butir klinis A ${id}`, weight: 2 },
        { id: 'c2', text: `Butir klinis B ${id}` },
      ],
      followup: [{ id: 'f1', text: `Butir lanjutan ${id}`, weight: 3 }],
    },
    source: { document: 'Dokumen Uji E2E.pdf', scenario: String(i), paraphrased: true },
  };
}

export function bankFile(n: number, prefix = 'e2e') {
  const json = JSON.stringify({ schemaVersion: 1, bank: { name: `Bank uji ${n}` }, stations: Array.from({ length: n }, (_, i) => station(i, prefix)) });
  return { name: 'stations.json', mimeType: 'application/json', buffer: Buffer.from(json) };
}

/** Bobot per stasiun di fixture: 2 + 1 + 3 */
export const WEIGHT_PER_STATION = 6;

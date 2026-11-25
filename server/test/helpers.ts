import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, type DB } from '../src/db.js';
import { config } from '../src/config.js';
import { createUser } from '../src/auth.js';
import { setClock } from '../src/clock.js';
import { createQuestion, parseQuestionInput, type Status } from '../src/services/questions.js';

export function freshDb(): { db: DB; userId: number; adminId: number } {
  config.dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orthoboard-test-'));
  config.dailyTarget = 1000;
  const db = openDb(':memory:');
  const adminId = createUser(db, 'admin', 'sandi-admin-123', 'admin');
  const userId = createUser(db, 'residen', 'sandi-residen-123', 'learner');
  return { db, userId, adminId };
}

/** Mengatur jam uji. Contoh: at('2026-03-01T02:00:00Z') = 10.00 WITA. */
export function at(iso: string) {
  setClock(() => new Date(iso));
}

const ref = { bookTitle: 'Buku Uji (sintetis)', edition: '1', chapter: 'Bab Uji', pdfPageStart: 10, pdfPageEnd: 11 };

// Isi sintetis untuk pengujian logika — bukan materi medis.
export function cbtInput(i: number, extra: Record<string, unknown> = {}) {
  return {
    id: `T-CBT-${String(i).padStart(5, '0')}`,
    format: 'cbt',
    category: i % 2 ? 'trauma' : 'spine',
    topic: `Topik ${i % 4}`,
    subtopic: 'Sub',
    bodyRegion: 'Uji',
    difficulty: 'sedang',
    reference: ref,
    content: {
      stem: `Soal uji ${i}`,
      options: ['A', 'B', 'C', 'D', 'E'].map((k) => ({ key: k, text: `Opsi ${k} ${i}` })),
      answer: 'A',
      explanation: 'Pembahasan uji',
    },
    ...extra,
  };
}

export function vivaInput(id: string) {
  return {
    id, format: 'viva', category: 'trauma', topic: 'Topik V', subtopic: 'Sub', bodyRegion: 'Uji', difficulty: 'sedang', reference: ref,
    content: { stem: 'Pertanyaan viva uji', rubric: [{ point: 'P1', weight: 3 }, { point: 'P2', weight: 1 }], explanation: 'Pembahasan' },
  };
}

export function osceInput(id: string) {
  return {
    id, format: 'osce', category: 'trauma', topic: 'Topik O', subtopic: 'Sub', bodyRegion: 'Uji', difficulty: 'sedang', reference: ref,
    content: {
      instructions: 'Instruksi', scenario: 'Skenario', tasks: ['Tugas 1'], timeSeconds: 300,
      checklist: [{ item: 'C1', weight: 1, critical: true }, { item: 'C2', weight: 3, critical: false }], explanation: 'Pembahasan',
    },
  };
}

export function add(db: DB, raw: unknown, status: Status = 'approved') {
  const p = parseQuestionInput(raw);
  if (!p.ok) throw new Error(p.errors.join('; '));
  return createQuestion(db, p.value, null, 'manual', status);
}

export function addCbts(db: DB, from: number, to: number, status: Status = 'approved') {
  db.transaction(() => {
    for (let i = from; i <= to; i++) add(db, cbtInput(i), status);
  })();
}

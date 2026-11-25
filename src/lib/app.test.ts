import { describe, expect, it } from 'vitest';
import { builtinBank, generateFromTable, validateQuestion } from './bank';
import { BLOCK_SIZE, DAILY_TARGET, MAX_BLOCKS, blockCount, blockIds, buildDailyIds } from './daily';
import { emptyState, ensureDay, recordRemedial, scoreBlock, streak, submitBlock, updateBlock, dueIds, daySummary } from './store';
import type { Question } from './types';

const bank = builtinBank();
const map = new Map(bank.map(q => [q.id, q]));

describe('bank soal', () => {
  it('memuat minimal 1.000 soal unik', () => {
    expect(bank.length).toBeGreaterThanOrEqual(DAILY_TARGET);
    expect(new Set(bank.map(q => q.id)).size).toBe(bank.length);
    expect(new Set(bank.map(q => q.stem)).size).toBe(bank.length);
  });

  it('setiap soal single-best-answer yang valid', () => {
    for (const q of bank) {
      expect(q.options.length, q.id).toBeGreaterThanOrEqual(4);
      expect(q.options.length, q.id).toBeLessThanOrEqual(5);
      expect(new Set(q.options).size, q.id).toBe(q.options.length);
      expect(q.answer, q.id).toBeGreaterThanOrEqual(0);
      expect(q.answer, q.id).toBeLessThan(q.options.length);
      expect(q.stem.includes('{'), q.id).toBe(false);
      expect(q.explanation.length, q.id).toBeGreaterThan(5);
      expect(validateQuestion(q), q.id).toBeNull();
    }
  });

  it('distraktor tidak pernah berasal dari grup yang sama atau bernilai sama', () => {
    const qs = generateFromTable({
      id: 't', domain: 'D', topic: 'T', f: '{k}?', r: '{v}?',
      pairs: [['a', '1', 'g'], ['b', '2', 'g'], ['c', '3'], ['d', '4'], ['e', '5'], ['f', '1']],
    });
    const fa = qs.find(q => q.stem === 'a?')!;
    expect(fa.options).not.toContain('2');
    expect(fa.options[fa.answer]).toBe('1');
    const ra = qs.find(q => q.id.startsWith('t:r:a'))!;
    expect(ra.options).not.toContain('b');
    expect(ra.options).not.toContain('f');
  });

  it('pembangkitan deterministik', () => {
    const a = JSON.stringify(bank.slice(0, 50));
    const b = JSON.stringify(builtinBank().slice(0, 50));
    expect(a).toBe(b);
  });

  it('menolak soal impor yang tidak valid', () => {
    expect(validateQuestion({ id: 'x', domain: 'd', stem: 's', explanation: 'e', options: ['a', 'b'], answer: 2 })).not.toBeNull();
    expect(validateQuestion({ id: 'x', domain: 'd', stem: 's', explanation: 'e', options: ['a', 'a'], answer: 0 })).not.toBeNull();
    expect(validateQuestion({ id: 'x', domain: 'd', stem: 's', explanation: 'e', options: ['a', 'b'], answer: 1 })).toBeNull();
  });
});

describe('paket harian', () => {
  const ids = buildDailyIds('2026-01-05', bank, {});
  it('1.000 soal unik dalam 20 blok berisi 50', () => {
    expect(ids.length).toBe(DAILY_TARGET);
    expect(new Set(ids).size).toBe(DAILY_TARGET);
    expect(blockCount(ids.length)).toBe(MAX_BLOCKS);
    for (let i = 0; i < MAX_BLOCKS; i++) expect(blockIds(ids, i).length).toBe(BLOCK_SIZE);
  });
  it('deterministik per tanggal dan berbeda antar tanggal', () => {
    expect(buildDailyIds('2026-01-05', bank, {})).toEqual(ids);
    expect(buildDailyIds('2026-01-06', bank, {})).not.toEqual(ids);
  });
  it('bank kecil → blok lebih sedikit, tanpa duplikat', () => {
    const small = bank.slice(0, 120);
    const s = buildDailyIds('2026-01-05', small, {});
    expect(s.length).toBe(120);
    expect(blockCount(s.length)).toBe(3);
    expect(blockIds(s, 2).length).toBe(20);
  });
  it('memprioritaskan remedial lalu soal yang belum pernah dikerjakan', () => {
    const hist: Record<string, { n: number; c: number; last: string; due: boolean }> = {};
    ids.forEach((id, i) => (hist[id] = { n: 1, c: i < 10 ? 0 : 1, last: '2026-01-05', due: i < 10 }));
    const next = new Set(buildDailyIds('2026-01-06', bank, hist));
    ids.slice(0, 10).forEach(id => expect(next.has(id)).toBe(true));
    bank.filter(q => !hist[q.id]).forEach(q => expect(next.has(q.id)).toBe(true));
  });
});

describe('alur blok → hasil → remedial', () => {
  const date = '2026-01-05';
  it('menilai blok, mengunci, dan mengisi antrean remedial', () => {
    let s = ensureDay(emptyState(), date, bank);
    const b0 = blockIds(s.days[date].ids, 0);
    s = updateBlock(s, date, 0, b => {
      const answers: Record<string, number> = {};
      b0.slice(0, 30).forEach(id => (answers[id] = map.get(id)!.answer));
      b0.slice(30, 40).forEach(id => (answers[id] = (map.get(id)!.answer + 1) % map.get(id)!.options.length));
      return { ...b, answers };
    });
    s = submitBlock(s, date, 0, map);
    const sc = scoreBlock(s.days[date], 0, map);
    expect(sc).toMatchObject({ total: 50, correct: 30, wrong: 10, blank: 10, pct: 60 });
    expect(sc.byDomain.reduce((a, d) => a + d.total, 0)).toBe(50);
    expect(dueIds(s, map).length).toBe(20);
    expect(daySummary(s.days[date], map)).toMatchObject({ blocks: 20, done: 1, answered: 40, correct: 30 });

    // blok terkunci: perubahan & submit ulang diabaikan
    const again = submitBlock(updateBlock(s, date, 0, b => ({ ...b, answers: {} })), date, 0, map);
    expect(again).toBe(s);

    const wrongId = b0[35];
    s = recordRemedial(s, wrongId, true, date);
    expect(s.hist[wrongId]).toMatchObject({ n: 2, c: 1, due: false });
    expect(dueIds(s, map).length).toBe(19);
    expect(streak(s, date)).toBe(1);
    expect(streak(s, '2026-01-06')).toBe(1);
    expect(streak(s, '2026-01-07')).toBe(0);
  });

  it('paket hari yang sama tidak dibuat ulang', () => {
    const s = ensureDay(emptyState(), date, bank);
    expect(ensureDay(s, date, bank.slice(0, 10) as Question[])).toBe(s);
  });
});

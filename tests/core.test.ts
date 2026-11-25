import { describe, expect, it } from 'vitest';
import { cycleDateFor, nextCycleStart } from '../src/lib/cycle';
import { buildSession, resetSessionProgress, selectPackStations } from '../src/lib/pack';
import { markReviewed, saveDraft, submitClinical, submitFollowup, toggleCheck } from '../src/lib/progress';
import { sessionStats, sessionSummary } from '../src/lib/scoring';
import { validateStationEntry } from '../src/lib/validate';
import { bankStation, makeBank, rawStation } from './helpers';

describe('siklus 09.00 WITA (Asia/Makassar)', () => {
  it('sebelum 09.00 WITA memakai tanggal kemarin', () => {
    // 08:59:59 WITA 25 Nov = 00:59:59 UTC 25 Nov
    expect(cycleDateFor(new Date('2026-11-25T00:59:59.999Z'))).toBe('2026-11-24');
  });
  it('tepat 09.00 WITA berganti ke tanggal hari ini', () => {
    expect(cycleDateFor(new Date('2026-11-25T01:00:00.000Z'))).toBe('2026-11-25');
  });
  it('tengah malam WITA masih siklus kemarin', () => {
    // 00:30 WITA 26 Nov = 16:30 UTC 25 Nov
    expect(cycleDateFor(new Date('2026-11-25T16:30:00Z'))).toBe('2026-11-25');
  });
  it('tidak bergantung zona waktu perangkat & melewati batas tahun', () => {
    expect(cycleDateFor(new Date('2027-01-01T00:30:00Z'))).toBe('2026-12-31');
    expect(cycleDateFor(new Date('2027-01-01T01:00:00Z'))).toBe('2027-01-01');
  });
  it('nextCycleStart = 01.00 UTC hari berikutnya', () => {
    expect(nextCycleStart(new Date('2026-11-25T00:10:00Z')).toISOString()).toBe('2026-11-25T01:00:00.000Z');
    expect(nextCycleStart(new Date('2026-11-25T05:00:00Z')).toISOString()).toBe('2026-11-26T01:00:00.000Z');
  });
});

describe('pemilihan paket deterministik', () => {
  it('tanggal sama → urutan sama; tanggal lain → urutan berbeda', () => {
    const bank = makeBank(60);
    const a = selectPackStations(bank, '2026-11-25', 'source').map((s) => s.id);
    const b = selectPackStations([...bank].reverse(), '2026-11-25', 'source').map((s) => s.id);
    const c = selectPackStations(bank, '2026-11-26', 'source').map((s) => s.id);
    expect(a).toEqual(b);
    expect(a).toHaveLength(25);
    expect(c).not.toEqual(a);
  });
  it('bank kecil: jumlah aktual, tanpa duplikasi', () => {
    const bank = makeBank(7);
    const picked = selectPackStations([...bank, ...bank], '2026-11-25', 'source');
    expect(picked).toHaveLength(7);
    expect(new Set(picked.map((s) => s.id)).size).toBe(7);
  });
  it('mengabaikan stasiun belum layak dan memisahkan demo dari sumber', () => {
    const bank = [bankStation('a'), bankStation('b', 'spine', { eligible: false }), bankStation('d1', 'trauma', { demo: true })];
    expect(selectPackStations(bank, '2026-11-25', 'source').map((s) => s.id)).toEqual(['a']);
    expect(selectPackStations(bank, '2026-11-25', 'demo').map((s) => s.id)).toEqual(['d1']);
  });
  it('mencakup semua topik bila tersedia', () => {
    const picked = selectPackStations(makeBank(80), '2026-11-25', 'source');
    expect(new Set(picked.map((s) => s.topic)).size).toBe(8);
  });
  it('bank kosong → tidak ada sesi', () => {
    expect(buildSession([], '2026-11-25', 'source')).toBeNull();
  });
});

describe('alur tahap & skor', () => {
  const bank = makeBank(3);
  const fresh = () => buildSession(bank, '2026-11-25', 'source')!;

  it('draft tidak dihitung sebagai respons; submit mengunci', () => {
    let s = fresh();
    const id = s.stations[0].id;
    s = saveDraft(s, id, 'clinical', 'draft saya');
    expect(sessionStats(s).responsesSubmitted).toBe(0);
    s = submitClinical(s, id);
    expect(s.progress[id].answerClinical).toBe('draft saya');
    expect(sessionStats(s).responsesSubmitted).toBe(1);
    // Setelah terkunci, draft klinis tidak bisa diubah
    const locked = saveDraft(s, id, 'clinical', 'ubah');
    expect(locked.progress[id].draftClinical).toBe('draft saya');
    // Tidak bisa submit tahap 2 dua kali atau mencentang sebelum review
    expect(toggleCheck(s, id, 'clinical', 'c1', true).progress[id].checked).toEqual({});
    s = submitFollowup(saveDraft(s, id, 'followup', 'jawaban 2'), id);
    expect(s.progress[id].stage).toBe('review');
    expect(sessionStats(s).responsesSubmitted).toBe(2);
  });

  it('tahap 2 tidak bisa di-submit sebelum tahap 1', () => {
    const s = fresh();
    const id = s.stations[0].id;
    expect(submitFollowup(s, id).progress[id].stage).toBe('clinical');
  });

  it('penyebut dihitung dari rubrik paket, skor dari butir dicentang', () => {
    let s = fresh();
    const st = sessionStats(s);
    expect(st.maxScore).toBe(3 * (2 + 1 + 3));
    expect(st.responseTotal).toBe(6);
    const id = s.stations[0].id;
    s = submitFollowup(submitClinical(s, id), id);
    s = toggleCheck(s, id, 'clinical', 'c1', true);
    s = toggleCheck(s, id, 'followup', 'f1', true);
    expect(sessionStats(s).score).toBe(5);
    s = toggleCheck(s, id, 'followup', 'f1', false);
    expect(sessionStats(s).score).toBe(2);
    expect(sessionStats(s).stationsReviewed).toBe(0);
    s = markReviewed(s, id);
    const sum = sessionSummary(s);
    expect(sum.stats.stationsReviewed).toBe(1);
    expect(sum.missed.map((m) => m.text)).toEqual(['Butir klinis 2', 'Butir lanjutan 1']);
    expect(sum.toRepeat.find((r) => r.stationId === id)?.reason).toMatch(/Skor/);
    expect(sum.toRepeat.filter((r) => r.reason === 'Belum selesai direview')).toHaveLength(2);
    expect(sum.byTopic.reduce((a, t) => a + t.max, 0)).toBe(st.maxScore);
  });

  it('reset menghapus progres tanpa mengubah urutan', () => {
    let s = fresh();
    const order = s.stations.map((x) => x.id);
    s = submitClinical(saveDraft(s, order[0], 'clinical', 'x'), order[0]);
    const r = resetSessionProgress(s);
    expect(r.stations.map((x) => x.id)).toEqual(order);
    expect(sessionStats(r).responsesSubmitted).toBe(0);
    expect(r.progress[order[0]].draftClinical).toBe('');
  });
});

describe('validasi entri', () => {
  it('menerima entri lengkap dan default bobot 1', () => {
    const v = validateStationEntry(rawStation('ok-1'));
    expect(v.errors).toEqual([]);
    expect(v.station!.checklist.clinical[1].weight).toBe(1);
  });
  it('menolak tanpa tahap kedua, tanpa rubrik, atau tanpa sumber', () => {
    const v = validateStationEntry(rawStation('x', 'trauma', { followupQuestion: '', checklist: { clinical: [], followup: [] }, source: undefined }));
    expect(v.station).toBeUndefined();
    expect(v.errors.join('\n')).toMatch(/followupQuestion/);
    expect(v.errors.join('\n')).toMatch(/Checklist clinical/);
    expect(v.errors.join('\n')).toMatch(/source.document/);
  });
  it('menolak bobot tidak valid dan path aset absolut', () => {
    const v = validateStationEntry(
      rawStation('y', 'trauma', {
        imagingRequired: true,
        assets: [{ path: '../luar.png', label: 'AP' }],
        checklist: { clinical: [{ id: 'c1', text: 'a', weight: -1 }], followup: ['b'] },
      }),
    );
    expect(v.errors.join('\n')).toMatch(/bobot/);
    expect(v.errors.join('\n')).toMatch(/relatif/);
  });
  it('demo tidak wajib sumber dan diberi label demo', () => {
    const v = validateStationEntry(rawStation('d', 'trauma', { source: undefined, demo: true }));
    expect(v.station!.source.document).toBe('Demo — bukan dari bank sumber');
  });
});

describe('template', () => {
  it('template mentah ditolak karena placeholder', async () => {
    const { readFileSync } = await import('node:fs');
    const t = JSON.parse(readFileSync('examples/stations.template.json', 'utf8'));
    const v = validateStationEntry(t.stations[0]);
    expect(v.errors.join()).toMatch(/GANTI/);
  });
});

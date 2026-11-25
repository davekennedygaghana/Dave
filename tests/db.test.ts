import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { closeDb, DB_NAME, getAllStations, getAsset, getSession } from '../src/lib/db';
import { importPackage } from '../src/lib/importer';
import { saveDraft, submitClinical } from '../src/lib/progress';
import { ensureSession, listSessions, resetSession, saveSession } from '../src/lib/sessions';
import { exportBackup, restoreBackup } from '../src/lib/backup';
import { makeZip, PNG_1PX, rawStation } from './helpers';
import { strToU8 } from 'fflate';

beforeEach(async () => {
  await closeDb();
  await new Promise<void>((res, rej) => {
    const r = indexedDB.deleteDatabase(DB_NAME);
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
});

const T0 = new Date('2026-11-25T02:00:00Z'); // 10.00 WITA

describe('importer', () => {
  it('ZIP dengan aset lengkap → layak; aset hilang → belum layak dengan alasan', async () => {
    const zip = makeZip(
      [
        rawStation('img-ok', 'trauma', { imagingRequired: true, assets: [{ path: 'assets/a.png', label: 'AP', caption: 'Bocoran' }] }),
        rawStation('img-missing', 'spine', { imagingRequired: true, assets: [{ path: 'assets/hilang.png', label: 'Lateral' }] }),
        rawStation('opt-missing', 'sports', { imagingRequired: false, assets: [{ path: 'assets/tidak-ada.png', label: 'AP' }] }),
        rawStation('img-ok', 'trauma'),
        { id: 'rusak' },
      ],
      { 'assets/a.png': PNG_1PX },
      'paket/',
    );
    const rep = await importPackage(zip, 'paket.zip', T0);
    expect(rep.errors).toEqual([]);
    const byId = Object.fromEntries(rep.accepted.map((a) => [a.id, a]));
    expect(byId['img-ok'].eligible).toBe(true);
    expect(byId['img-missing'].eligible).toBe(false);
    expect(byId['img-missing'].issues.join()).toMatch(/tidak ditemukan/);
    expect(byId['opt-missing'].eligible).toBe(true);
    expect(rep.rejected.map((r) => r.id).sort()).toEqual(['img-ok', 'rusak']);
    const stations = await getAllStations();
    const ok = stations.find((s) => s.id === 'img-ok')!;
    expect(ok.assets[0].blobKey).toMatch(/^[0-9a-f]{64}$/);
    expect(await getAsset(ok.assets[0].blobKey!)).toBeTruthy();
    expect(stations.find((s) => s.id === 'opt-missing')!.assets).toEqual([]);
  });

  it('JSON tanpa ZIP dengan imaging wajib → belum layak', async () => {
    const rep = await importPackage(
      strToU8(JSON.stringify([rawStation('j1', 'trauma', { imagingRequired: true, assets: [{ path: 'x.jpg', label: 'AP' }] })])),
      'bank.json',
    );
    expect(rep.accepted[0].eligible).toBe(false);
  });

  it('file rusak memberi pesan jelas', async () => {
    const rep = await importPackage(strToU8('{bukan json'), 'x.json');
    expect(rep.errors[0]).toMatch(/bukan JSON valid/);
    const rep2 = await importPackage(makeZip([]).slice(0, 10), 'x.zip');
    expect(rep2.errors[0]).toMatch(/ZIP/);
  });
});

describe('sesi harian', () => {
  async function importN(n: number, prefix = 's') {
    const list = Array.from({ length: n }, (_, i) => rawStation(`${prefix}-${i}`, ['trauma', 'spine', 'tumor'][i % 3]));
    return importPackage(strToU8(JSON.stringify(list)), 'b.json', T0);
  }

  it('refresh (pemanggilan ulang) tidak mengubah urutan atau progres', async () => {
    await importN(30);
    const a = await ensureSession('source', T0);
    expect(a.session!.stations).toHaveLength(25);
    const id = a.session!.stations[0].id;
    await saveSession(submitClinical(saveDraft(a.session!, id, 'clinical', 'jawaban'), id));
    const b = await ensureSession('source', new Date(T0.getTime() + 3600_000));
    expect(b.session!.stations.map((s) => s.id)).toEqual(a.session!.stations.map((s) => s.id));
    expect(b.session!.progress[id].answerClinical).toBe('jawaban');
  });

  it('impor bank baru tidak mengubah paket yang sudah dimulai', async () => {
    await importN(5);
    const a = await ensureSession('source', T0);
    expect(a.session!.stations).toHaveLength(5);
    await importN(40, 'baru');
    const b = await ensureSession('source', T0);
    expect(b.session!.stations.map((s) => s.id)).toEqual(a.session!.stations.map((s) => s.id));
    expect(b.eligibleNow).toBe(45);
  });

  it('paket baru tersedia pukul 09.00 WITA dan sesi lama tetap bisa dilanjutkan', async () => {
    await importN(10);
    const before = await ensureSession('source', new Date('2026-11-26T00:59:00Z')); // 08.59 WITA 26 Nov
    expect(before.cycleDate).toBe('2026-11-25');
    const id = before.session!.stations[0].id;
    await saveSession(saveDraft(before.session!, id, 'clinical', 'draft lama'));
    const after = await ensureSession('source', new Date('2026-11-26T01:00:00Z'));
    expect(after.cycleDate).toBe('2026-11-26');
    const all = await listSessions();
    expect(all.map((s) => s.id)).toEqual(['source:2026-11-26', 'source:2026-11-25']);
    const old = await getSession('source:2026-11-25');
    expect(old!.progress[id].draftClinical).toBe('draft lama');
  });

  it('reset hanya menghapus progres sesi yang dipilih', async () => {
    await importN(4);
    const d1 = (await ensureSession('source', new Date('2026-11-24T02:00:00Z'))).session!;
    const d2 = (await ensureSession('source', T0)).session!;
    await saveSession(saveDraft(d1, d1.stations[0].id, 'clinical', 'A'));
    await saveSession(saveDraft(d2, d2.stations[0].id, 'clinical', 'B'));
    await resetSession(d2.id);
    expect((await getSession(d2.id))!.progress[d2.stations[0].id].draftClinical).toBe('');
    expect((await getSession(d1.id))!.progress[d1.stations[0].id].draftClinical).toBe('A');
  });

  it('demo terpisah: tanpa bank sumber tidak ada paket sumber, tapi demo tersedia', async () => {
    const src = await ensureSession('source', T0);
    expect(src.session).toBeNull();
    const demo = await ensureSession('demo', T0);
    expect(demo.session!.stations.every((s) => s.demo)).toBe(true);
    expect(demo.session!.stations.length).toBe(3);
  });

  it('cadangan bisa diekspor dan dipulihkan', async () => {
    await importN(3);
    const s = (await ensureSession('source', T0)).session!;
    await saveSession(saveDraft(s, s.stations[0].id, 'clinical', 'dicadangkan'));
    const zip = await exportBackup();
    await closeDb();
    await new Promise<void>((r) => {
      const q = indexedDB.deleteDatabase(DB_NAME);
      q.onsuccess = () => r();
    });
    const rep = await restoreBackup(zip);
    expect(rep.sessions).toBe(1);
    expect((await getSession(s.id))!.progress[s.stations[0].id].draftClinical).toBe('dicadangkan');
    expect(await getAllStations()).toHaveLength(3);
  });
});

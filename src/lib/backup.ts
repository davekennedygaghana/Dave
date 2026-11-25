import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { getAllAssetKeys, getAllSessions, getAllStations, getAsset, putAssets, putSession, putStations, type StoredAsset } from './db';
import type { BankStation, Session } from './types';

export const BACKUP_FORMAT = 'osce-harian-backup';

interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  version: 1;
  exportedAt: string;
  sessions: Session[];
  stations: BankStation[];
  assets: { key: string; mime: string; file: string }[];
}

/** Ekspor progres (sesi), bank, dan aset menjadi satu ZIP. */
export async function exportBackup(now: Date = new Date()): Promise<Uint8Array> {
  const [sessions, stations, keys] = await Promise.all([getAllSessions(), getAllStations(), getAllAssetKeys()]);
  const files: Record<string, Uint8Array> = {};
  const assets: BackupManifest['assets'] = [];
  for (const key of keys) {
    const a = await getAsset(key);
    if (!a) continue;
    const file = `assets/${key}`;
    files[file] = new Uint8Array(await a.blob.arrayBuffer());
    assets.push({ key, mime: a.mime, file });
  }
  const manifest: BackupManifest = { format: BACKUP_FORMAT, version: 1, exportedAt: now.toISOString(), sessions, stations, assets };
  files['backup.json'] = strToU8(JSON.stringify(manifest));
  return zipSync(files, { level: 0 });
}

export interface RestoreReport {
  sessions: number;
  stations: number;
  assets: number;
  skippedSessions: string[];
}

/**
 * Pulihkan cadangan. Sesi dengan ID yang sama ditimpa hanya bila cadangan lebih baru
 * (updatedAt) — kecuali overwrite = true.
 */
export async function restoreBackup(bytes: Uint8Array, overwrite = false): Promise<RestoreReport> {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new Error('File cadangan bukan ZIP yang valid.');
  }
  if (!entries['backup.json']) throw new Error('backup.json tidak ditemukan — ini bukan file cadangan OSCE Harian.');
  const m = JSON.parse(strFromU8(entries['backup.json'])) as BackupManifest;
  if (m.format !== BACKUP_FORMAT) throw new Error('Format cadangan tidak dikenal.');
  const assets: StoredAsset[] = [];
  for (const a of m.assets) {
    const data = entries[a.file];
    if (!data) continue;
    assets.push({ key: a.key, mime: a.mime, size: data.length, blob: new Blob([data as BlobPart], { type: a.mime }) });
  }
  if (assets.length) await putAssets(assets);
  if (m.stations.length) await putStations(m.stations);
  const existing = new Map((await getAllSessions()).map((s) => [s.id, s]));
  const skipped: string[] = [];
  let restored = 0;
  for (const s of m.sessions) {
    const cur = existing.get(s.id);
    if (cur && !overwrite && cur.updatedAt >= s.updatedAt) {
      skipped.push(s.id);
      continue;
    }
    await putSession(s);
    restored++;
  }
  return { sessions: restored, stations: m.stations.length, assets: assets.length, skippedSessions: skipped };
}

import type { BankStation, Session } from './types';

/** Penyimpanan lokal berbasis IndexedDB. Data hanya ada di browser/perangkat ini. */
export const DB_NAME = 'osce-harian';
const DB_VERSION = 1;

export interface StoredAsset {
  key: string;
  blob: Blob;
  mime: string;
  size: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('stations')) db.createObjectStore('stations', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/** Untuk tes: tutup koneksi agar DB bisa dihapus/dibuka ulang. */
export async function closeDb(): Promise<void> {
  if (!dbPromise) return;
  const db = await dbPromise;
  db.close();
  dbPromise = null;
}

type StoreName = 'stations' | 'assets' | 'sessions' | 'meta';

function reqP<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(stores: StoreName[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => Promise<T> | T): Promise<T> {
  const db = await openDb();
  const t = db.transaction(stores, mode);
  const done = new Promise<void>((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error('Transaksi IndexedDB dibatalkan'));
  });
  const result = await fn(t);
  await done;
  return result;
}

export const getAllStations = () => tx(['stations'], 'readonly', (t) => reqP(t.objectStore('stations').getAll() as IDBRequest<BankStation[]>));

export const putStations = (list: BankStation[]) =>
  tx(['stations'], 'readwrite', (t) => {
    const os = t.objectStore('stations');
    for (const s of list) os.put(s);
  });

export const deleteStations = (ids: string[]) =>
  tx(['stations'], 'readwrite', (t) => {
    const os = t.objectStore('stations');
    for (const id of ids) os.delete(id);
  });

export const getAsset = (key: string) => tx(['assets'], 'readonly', (t) => reqP(t.objectStore('assets').get(key) as IDBRequest<StoredAsset | undefined>));
export const getAllAssetKeys = () => tx(['assets'], 'readonly', (t) => reqP(t.objectStore('assets').getAllKeys() as IDBRequest<string[]>));

export const putAssets = (list: StoredAsset[]) =>
  tx(['assets'], 'readwrite', (t) => {
    const os = t.objectStore('assets');
    for (const a of list) os.put(a);
  });

export const getSession = (id: string) => tx(['sessions'], 'readonly', (t) => reqP(t.objectStore('sessions').get(id) as IDBRequest<Session | undefined>));
export const getAllSessions = () => tx(['sessions'], 'readonly', (t) => reqP(t.objectStore('sessions').getAll() as IDBRequest<Session[]>));
export const putSession = (s: Session) => tx(['sessions'], 'readwrite', (t) => void t.objectStore('sessions').put(s));
export const deleteSession = (id: string) => tx(['sessions'], 'readwrite', (t) => void t.objectStore('sessions').delete(id));

/** Tambah sesi hanya jika belum ada (atomik dalam satu transaksi) — mencegah dua tab membuat paket berbeda. */
export const addSessionIfAbsent = (s: Session) =>
  tx(['sessions'], 'readwrite', async (t) => {
    const os = t.objectStore('sessions');
    const existing = (await reqP(os.get(s.id))) as Session | undefined;
    if (existing) return existing;
    os.add(s);
    return s;
  });

export const getMeta = <T>(key: string) => tx(['meta'], 'readonly', (t) => reqP(t.objectStore('meta').get(key) as IDBRequest<T | undefined>));
export const setMeta = (key: string, value: unknown) => tx(['meta'], 'readwrite', (t) => void t.objectStore('meta').put(value, key));

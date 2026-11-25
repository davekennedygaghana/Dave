import { useEffect, useState, useSyncExternalStore } from 'react';
import { getAsset } from './lib/db';

export type Route =
  | { page: 'latihan'; sessionId?: string }
  | { page: 'riwayat' }
  | { page: 'bank' };

export function parseHash(hash: string): Route {
  const h = hash.replace(/^#\/?/, '');
  const [page, ...rest] = h.split('/');
  if (page === 'riwayat') return { page: 'riwayat' };
  if (page === 'bank') return { page: 'bank' };
  const sid = rest.length ? decodeURIComponent(rest.join('/')) : undefined;
  return { page: 'latihan', sessionId: sid };
}

export function navigate(route: Route) {
  const hash =
    route.page === 'latihan' ? (route.sessionId ? `#/latihan/${encodeURIComponent(route.sessionId)}` : '#/latihan') : `#/${route.page}`;
  if (location.hash !== hash) location.hash = hash;
}

const subscribeHash = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribeHash, () => location.hash);
  return parseHash(hash);
}

const subscribeOnline = (cb: () => void) => {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
};
export const useOnline = () => useSyncExternalStore(subscribeOnline, () => navigator.onLine);

/** URL objek untuk aset di IndexedDB. Nama file asli tidak pernah dipakai. */
export function useAssetUrl(blobKey: string | undefined): { url?: string; missing: boolean } {
  const [state, setState] = useState<{ url?: string; missing: boolean }>({ missing: false });
  useEffect(() => {
    if (!blobKey) {
      setState({ missing: true });
      return;
    }
    let url: string | undefined;
    let cancelled = false;
    getAsset(blobKey).then((a) => {
      if (cancelled) return;
      if (!a) return setState({ missing: true });
      url = URL.createObjectURL(a.blob);
      setState({ url, missing: false });
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [blobKey]);
  return state;
}

export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    const vis = () => document.visibilityState === 'visible' && setNow(new Date());
    document.addEventListener('visibilitychange', vis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', vis);
    };
  }, [intervalMs]);
  return now;
}

export function downloadBytes(bytes: Uint8Array | string, name: string, mime: string) {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppCtx } from './ctx';
import { fullBank } from './lib/bank';
import { todayStr } from './lib/daily';
import { ensureDay, loadState, saveState } from './lib/store';
import type { AppState } from './lib/types';
import { Dashboard } from './pages/Dashboard';
import { Paket } from './pages/Paket';
import { Blok } from './pages/Blok';
import { Hasil } from './pages/Hasil';
import { Review } from './pages/Review';
import { Remedial } from './pages/Remedial';
import { Data } from './pages/Data';

function useHash(): string {
  const [h, setH] = useState(() => window.location.hash.slice(1) || '/');
  useEffect(() => {
    const on = () => {
      setH(window.location.hash.slice(1) || '/');
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return h;
}

export function App() {
  const path = useHash();
  const [state, setState] = useState<AppState>(loadState);
  const [today, setToday] = useState(todayStr);
  const [saveOk, setSaveOk] = useState(true);

  const bank = useMemo(() => fullBank(state.custom), [state.custom]);
  const map = useMemo(() => new Map(bank.map(q => [q.id, q])), [bank]);

  // Pergantian hari saat tab tetap terbuka.
  useEffect(() => {
    const t = setInterval(() => setToday(todayStr()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    setState(s => ensureDay(s, today, bank));
  }, [today, bank]);

  useEffect(() => {
    setSaveOk(saveState(state));
  }, [state]);

  const set = useCallback((fn: (s: AppState) => AppState) => setState(fn), []);
  const go = useCallback((p: string) => {
    window.location.hash = p;
  }, []);

  const ctx = useMemo(() => ({ state, set, bank, map, today, go }), [state, set, bank, map, today, go]);

  if (!state.days[today]) return <div className="wrap"><p>Menyiapkan paket hari ini…</p></div>;

  const seg = path.split('/').filter(Boolean);
  const n = Number(seg[1]);
  let page;
  let focus = false;
  switch (seg[0]) {
    case undefined: page = <Dashboard />; break;
    case 'paket': page = <Paket />; break;
    case 'blok': page = <Blok key={n} block={n} />; focus = true; break;
    case 'hasil': page = <Hasil block={n} />; break;
    case 'review': page = <Review block={n} />; break;
    case 'remedial': page = <Remedial />; break;
    case 'data': page = <Data />; break;
    default: page = <Dashboard />;
  }

  const nav: [string, string, string][] = [
    ['/', 'Dashboard', ''],
    ['/paket', 'Paket Hari Ini', 'paket'],
    ['/remedial', 'Remedial', 'remedial'],
    ['/data', 'Data', 'data'],
  ];

  return (
    <AppCtx.Provider value={ctx}>
      <header className="top">
        <a className="brand" href="#/">CBT Harian <span>• Ortopedi</span></a>
        {!focus && (
          <nav>
            {nav.map(([href, label, key]) => (
              <a key={href} href={'#' + href} className={(seg[0] ?? '') === key ? 'on' : ''}>{label}</a>
            ))}
          </nav>
        )}
      </header>
      {!saveOk && (
        <div className="warn wrap">Progres tidak dapat disimpan di browser ini (penyimpanan penuh atau diblokir). Ekspor data Anda dari menu Data.</div>
      )}
      <main className="wrap">{page}</main>
      <footer className="wrap foot">
        Materi latihan untuk belajar mandiri — bukan pengganti textbook, guideline, atau penilaian klinis. Progres tersimpan hanya di perangkat ini.
      </footer>
    </AppCtx.Provider>
  );
}

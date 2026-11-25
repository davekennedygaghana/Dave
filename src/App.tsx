import { navigate, useOnline, useRoute } from './hooks';
import PracticePage from './components/PracticePage';
import HistoryPage from './components/HistoryPage';
import BankPage from './components/BankPage';

const NAV = [
  { page: 'latihan', label: 'Latihan Hari Ini', icon: '◎' },
  { page: 'riwayat', label: 'Riwayat', icon: '☰' },
  { page: 'bank', label: 'Bank Kasus', icon: '▤' },
] as const;

export default function App() {
  const route = useRoute();
  const online = useOnline();
  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#/latihan" aria-label="OSCE Harian Interaktif — beranda">
          <img src="./icons/icon.svg" alt="" width={28} height={28} />
          <span>OSCE Harian</span>
        </a>
        <nav className="nav-top" aria-label="Navigasi utama">
          {NAV.map((n) => (
            <button key={n.page} className={route.page === n.page ? 'active' : ''} onClick={() => navigate({ page: n.page })}>
              {n.label}
            </button>
          ))}
        </nav>
        {!online && <span className="pill offline" title="Data tersimpan di perangkat ini">Offline</span>}
      </header>
      <main className="content">
        {route.page === 'latihan' && <PracticePage key={route.sessionId ?? 'today'} sessionId={route.sessionId} />}
        {route.page === 'riwayat' && <HistoryPage />}
        {route.page === 'bank' && <BankPage />}
      </main>
      <nav className="nav-bottom" aria-label="Navigasi utama (seluler)">
        {NAV.map((n) => (
          <button key={n.page} className={route.page === n.page ? 'active' : ''} onClick={() => navigate({ page: n.page })}>
            <span aria-hidden="true">{n.icon}</span>
            {n.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

import { createContext, useContext, useEffect, useState, type FormEvent } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ApiError, get, post } from './api';
import { Icon, Loading, Notice } from './components/ui';
import { Dashboard } from './pages/Dashboard';
import { Exam } from './pages/Exam';
import { Bank } from './pages/Bank';
import { Progress } from './pages/Progress';
import { References } from './pages/References';
import { Remedial } from './pages/Remedial';
import { Admin } from './pages/Admin';

export interface User {
  id: number;
  username: string;
  role: 'admin' | 'learner';
}
const AuthCtx = createContext<{ user: User; logout: () => void }>(null as any);
export const useAuth = () => useContext(AuthCtx);

function Brand() {
  return (
    <NavLink to="/" className="brand">
      <span className="brand-mark" aria-hidden="true">
        O
      </span>
      <span>
        <b>OrthoBoard</b>
        <small>Reference Lab</small>
      </span>
    </NavLink>
  );
}

const NAV = [
  { to: '/', label: 'Dashboard', icon: 'home' },
  { to: '/bank', label: 'Bank soal', icon: 'bank' },
  { to: '/remedial', label: 'Remedial', icon: 'redo' },
  { to: '/progres', label: 'Progres', icon: 'chart' },
  { to: '/referensi', label: 'Referensi', icon: 'book' },
];

function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      onLogin((await post('/auth/login', { username, password })).user);
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="login">
      <form className="card stack" onSubmit={submit}>
        <div>
          <h1 style={{ marginBottom: 2 }}>OrthoBoard</h1>
          <p className="muted">Reference Lab — latihan ujian board ortopedi</p>
        </div>
        {error && <Notice kind="err">{error}</Notice>}
        <label className="field">
          <span>Nama pengguna</span>
          <input type="text" autoComplete="username" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
        </label>
        <label className="field">
          <span>Sandi</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <button className="btn primary block" disabled={busy}>
          {busy ? 'Memeriksa…' : 'Masuk'}
        </button>
      </form>
    </main>
  );
}

export function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [more, setMore] = useState(false);
  const loc = useLocation();
  const inExam = loc.pathname.startsWith('/sesi/');

  useEffect(() => {
    get('/auth/me')
      .then((r) => setUser(r.user))
      .catch(() => setUser(null));
    const out = () => setUser(null);
    window.addEventListener('ob:unauthorized', out);
    return () => window.removeEventListener('ob:unauthorized', out);
  }, []);
  useEffect(() => setMore(false), [loc.pathname]);

  if (user === undefined) return <Loading />;
  if (!user) return <Login onLogin={setUser} />;

  const logout = async () => {
    await post('/auth/logout').catch(() => {});
    setUser(null);
  };
  const nav = user.role === 'admin' ? [...NAV, { to: '/admin', label: 'Panel admin', icon: 'admin' }] : NAV;
  const link = (n: (typeof NAV)[number]) => (
    <NavLink key={n.to} to={n.to} end={n.to === '/'}>
      <Icon name={n.icon} />
      <span>{n.label}</span>
    </NavLink>
  );

  return (
    <AuthCtx.Provider value={{ user, logout }}>
      <a className="skip" href="#konten">
        Lompat ke konten
      </a>
      <div className={`shell ${inExam ? 'exam-mode' : ''}`}>
        <aside className="sidebar">
          <Brand />
          <nav className="nav" aria-label="Navigasi utama">
            {nav.map(link)}
          </nav>
          <div className="side-foot">
            Masuk sebagai <b>{user.username}</b>
            <br />
            <button className="btn sm on-dark" onClick={logout}>
              Keluar
            </button>
          </div>
        </aside>
        <div style={{ flex: 1, minWidth: 0 }}>
          <header className="topbar">
            <Brand />
            <button className="btn sm on-dark" onClick={logout}>
              Keluar
            </button>
          </header>
          <main className="main" id="konten">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/sesi/:id" element={<Exam />} />
              <Route path="/bank" element={<Bank />} />
              <Route path="/remedial" element={<Remedial />} />
              <Route path="/progres" element={<Progress />} />
              <Route path="/referensi" element={<References />} />
              <Route path="/admin/*" element={user.role === 'admin' ? <Admin /> : <Navigate to="/" replace />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
        {more && (
          <div className="more-sheet">
            <nav className="nav" aria-label="Menu lainnya">
              {nav.slice(4).map(link)}
            </nav>
          </div>
        )}
        <nav className="bottomnav" aria-label="Navigasi utama">
          {nav.slice(0, 4).map(link)}
          <button onClick={() => setMore((m) => !m)} aria-expanded={more}>
            <Icon name="more" />
            <span>Lainnya</span>
          </button>
        </nav>
      </div>
    </AuthCtx.Provider>
  );
}

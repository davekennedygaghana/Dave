import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError, get } from '../api';

/** Memuat data dari API dengan status muat/galat dan fungsi muat ulang. */
export function useLoad<T = any>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!url);
  const seq = useRef(0);
  const reload = useCallback(async () => {
    if (!url) return;
    const my = ++seq.current;
    setLoading(true);
    try {
      const d = await get<T>(url);
      if (my === seq.current) (setData(d), setError(null));
    } catch (e) {
      if (my === seq.current) setError((e as ApiError).message);
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [url]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, loading, reload, setData };
}

/** true bila tombol ditekan saat mengetik teks (pintasan keyboard harus diabaikan). Radio/checkbox/tombol tidak dihitung. */
export function isTextEntry(e: KeyboardEvent): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return true;
  const t = e.target as HTMLElement;
  if (t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true;
  return t.tagName === 'INPUT' && !['radio', 'checkbox', 'button', 'submit'].includes((t as HTMLInputElement).type);
}

export function Loading() {
  return <div className="spinner" role="status" aria-label="Memuat" />;
}

export function Notice({ kind = '', children }: { kind?: '' | 'warn' | 'err' | 'ok' | 'demo'; children: ReactNode }) {
  return (
    <div className={`notice ${kind}`} role={kind === 'err' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function LoadState({ loading, error, children }: { loading: boolean; error: string | null; children: ReactNode }) {
  if (error) return <Notice kind="err">{error}</Notice>;
  if (loading) return <Loading />;
  return <>{children}</>;
}

export function Bar({ value, max, gold, thin, label }: { value: number; max: number; gold?: boolean; thin?: boolean; label: string }) {
  const p = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className={`bar ${gold ? 'gold' : ''} ${thin ? 'thin' : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label}>
      <i style={{ width: `${p}%` }} />
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

export function Seg<T extends string | number>({ name, value, options, onChange, legend }: { name: string; value: T; options: { value: T; label: string; disabled?: boolean }[]; onChange: (v: T) => void; legend: string }) {
  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="lbl" style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--navy)', marginBottom: 6, padding: 0 }}>
        {legend}
      </legend>
      <div className="seg">
        {options.map((o) => (
          <label key={String(o.value)}>
            <input type="radio" name={name} checked={value === o.value} disabled={o.disabled} onChange={() => onChange(o.value)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  return (
    <nav className="pager" aria-label="Halaman">
      <button className="btn sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        ‹ Sebelumnya
      </button>
      <span className="num small">
        Halaman {page} / {pages}
      </span>
      <button className="btn sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Berikutnya ›
      </button>
    </nav>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus();
    };
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <div className="row between" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button className="btn sm" onClick={onClose}>
            Tutup
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function DemoChip() {
  return <span className="chip demo">DEMO</span>;
}

const paths: Record<string, string> = {
  home: 'M3 11.5 12 4l9 7.5M5.5 10v9.5h13V10',
  bank: 'M4 5.5h16M4 12h16M4 18.5h10',
  chart: 'M4 20V10m6 10V4m6 16v-7m4 7H2',
  book: 'M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4Zm0 13a3 3 0 0 1 3-3h11',
  redo: 'M4 12a8 8 0 1 0 2.6-5.9M4 4v5h5',
  admin: 'M12 3l8 3.5v5c0 4.6-3.2 8-8 9.5-4.8-1.5-8-4.9-8-9.5v-5L12 3Zm-3 9 2.2 2.2L15.5 10',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  flag: 'M6 21V4h11l-2 4 2 4H6',
};
export function Icon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={name === 'more' ? 3 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}

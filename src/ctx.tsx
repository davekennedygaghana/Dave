import { createContext, useContext } from 'react';
import type { AppState, Question } from './lib/types';

export interface Ctx {
  state: AppState;
  /** perbarui state; otomatis tersimpan ke localStorage */
  set: (fn: (s: AppState) => AppState) => void;
  bank: Question[];
  map: Map<string, Question>;
  today: string;
  go: (path: string) => void;
}

export const AppCtx = createContext<Ctx | null>(null);

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error('AppCtx belum tersedia');
  return c;
}

export const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

export function fmtTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

export function fmtDate(d: string): string {
  return new Date(d + 'T12:00:00').toLocaleDateString('id-ID', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

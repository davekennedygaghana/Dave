import { config } from './config.js';

// Jam yang bisa diganti saat pengujian (pergantian tanggal WITA).
let override: (() => Date) | null = null;

export function setClock(fn: (() => Date) | null) {
  override = fn;
}

export function now(): Date {
  return override ? override() : new Date();
}

export function nowIso(): string {
  return now().toISOString();
}

/** Tanggal kalender (YYYY-MM-DD) pada zona waktu aplikasi (bawaan Asia/Makassar = WITA). */
export function localDate(d: Date = now(), timeZone: string = config.timezone): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

import { unzipSync } from 'fflate';
import { putAssets, putStations, type StoredAsset } from './db';
import type { AssetRef, BankStation, ImportReport, Station } from './types';
import { validateStationEntry } from './validate';

export const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  svg: 'image/svg+xml',
};

export interface ParsedPackage {
  json: unknown;
  /** File di dalam paket, path dinormalisasi relatif terhadap folder stations.json. */
  files: Map<string, Uint8Array>;
  isZip: boolean;
}

const isZipBytes = (b: Uint8Array) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05);

export function normalizePath(p: string): string {
  const parts: string[] = [];
  for (const seg of p.replace(/\\/g, '/').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

/** Baca file .json atau .zip (berisi stations.json + folder aset). */
export function parsePackage(bytes: Uint8Array, fileName = ''): ParsedPackage {
  if (isZipBytes(bytes) || fileName.toLowerCase().endsWith('.zip')) {
    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(bytes);
    } catch (e) {
      throw new Error(`File ZIP tidak dapat dibuka: ${(e as Error).message}`);
    }
    const names = Object.keys(entries).filter((n) => !n.startsWith('__MACOSX/') && !n.endsWith('/'));
    const candidates = names.filter((n) => n.split('/').pop() === 'stations.json').sort((a, b) => a.length - b.length);
    if (candidates.length === 0) throw new Error('ZIP tidak berisi stations.json.');
    const jsonPath = candidates[0];
    const base = jsonPath.includes('/') ? jsonPath.slice(0, jsonPath.lastIndexOf('/') + 1) : '';
    const files = new Map<string, Uint8Array>();
    for (const n of names) {
      if (n === jsonPath || !n.startsWith(base)) continue;
      files.set(normalizePath(n.slice(base.length)), entries[n]);
    }
    return { json: parseJsonBytes(entries[jsonPath], 'stations.json'), files, isZip: true };
  }
  return { json: parseJsonBytes(bytes, fileName || 'JSON'), files: new Map(), isZip: false };
}

function parseJsonBytes(b: Uint8Array, label: string): unknown {
  const text = new TextDecoder('utf-8').decode(b).replace(/^﻿/, '');
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`${label} bukan JSON valid: ${(e as Error).message}`);
  }
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data as BufferSource);
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export interface PreparedImport {
  report: ImportReport;
  stations: BankStation[];
  assets: StoredAsset[];
}

/** Validasi paket dan siapkan entri bank + aset tanpa menulis ke DB. */
export async function prepareImport(pkg: ParsedPackage, now: Date = new Date()): Promise<PreparedImport> {
  const report: ImportReport = { bankName: '', accepted: [], rejected: [], errors: [] };
  const raw = pkg.json;
  let entries: unknown[];
  let bankName = 'Bank tanpa nama';
  let bankDemo = false;
  if (Array.isArray(raw)) entries = raw;
  else if (raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).stations)) {
    const obj = raw as Record<string, unknown>;
    entries = obj.stations as unknown[];
    const bank = (obj.bank ?? {}) as Record<string, unknown>;
    if (typeof bank.name === 'string' && bank.name.trim()) bankName = bank.name.trim();
    bankDemo = bank.demo === true;
    if (obj.schemaVersion !== undefined && obj.schemaVersion !== 1) {
      report.errors.push(`schemaVersion ${String(obj.schemaVersion)} tidak didukung (hanya 1).`);
      return { report, stations: [], assets: [] };
    }
  } else {
    report.errors.push('Format tidak dikenal: harus array stasiun atau objek { "stations": [...] }.');
    return { report, stations: [], assets: [] };
  }
  report.bankName = bankName;
  if (entries.length === 0) report.errors.push('Tidak ada stasiun di dalam file.');

  const seen = new Set<string>();
  const stations: BankStation[] = [];
  const assets = new Map<string, StoredAsset>();

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const rawId = entry && typeof entry === 'object' && typeof (entry as { id?: unknown }).id === 'string' ? ((entry as { id: string }).id.trim() || `#${i + 1}`) : `#${i + 1}`;
    const v = validateStationEntry(entry, bankDemo);
    if (!v.station) {
      report.rejected.push({ id: rawId, reasons: v.errors });
      continue;
    }
    const st: Station = v.station;
    if (seen.has(st.id)) {
      report.rejected.push({ id: st.id, reasons: [`ID "${st.id}" ganda di dalam file; hanya entri pertama yang dipakai.`] });
      continue;
    }
    seen.add(st.id);

    const issues: string[] = [];
    const warnings = [...v.warnings];
    const resolved: AssetRef[] = [];
    for (const a of st.assets) {
      const path = normalizePath(a.path);
      const ext = path.split('.').pop()?.toLowerCase() ?? '';
      const mime = MIME_BY_EXT[ext];
      const bytes = pkg.files.get(path);
      let problem = '';
      if (!mime) problem = `Aset "${a.label}" berformat .${ext} yang tidak didukung (gunakan jpg/png/webp/gif/avif/svg).`;
      else if (!bytes) problem = `File aset untuk "${a.label}" tidak ditemukan di paket (${path}).`;
      else if (bytes.length === 0) problem = `File aset untuk "${a.label}" kosong (${path}).`;
      if (problem) {
        if (st.imagingRequired) issues.push(problem);
        else warnings.push(`${problem} Aset dilewati.`);
        continue;
      }
      const key = await sha256Hex(bytes!);
      if (!assets.has(key)) assets.set(key, { key, blob: new Blob([bytes as BlobPart], { type: mime }), mime, size: bytes!.length });
      resolved.push({ ...a, path, blobKey: key, mime });
    }
    if (st.imagingRequired && resolved.length === 0 && issues.length === 0) issues.push('Imaging wajib tetapi tidak ada aset yang valid.');

    const bankStation: BankStation = {
      ...st,
      assets: resolved,
      eligible: issues.length === 0,
      issues: [...issues, ...warnings.map((w) => `Peringatan: ${w}`)],
      importedAt: now.toISOString(),
      bankName: st.demo ? `${bankName} (Demo)` : bankName,
    };
    stations.push(bankStation);
    report.accepted.push({ id: st.id, eligible: bankStation.eligible, issues: bankStation.issues });
  }
  return { report, stations, assets: [...assets.values()] };
}

/** Impor ke IndexedDB. Sesi yang sudah dimulai tidak berubah karena memakai snapshot. */
export async function importPackage(bytes: Uint8Array, fileName: string, now: Date = new Date()): Promise<ImportReport> {
  let pkg: ParsedPackage;
  try {
    pkg = parsePackage(bytes, fileName);
  } catch (e) {
    return { bankName: '', accepted: [], rejected: [], errors: [(e as Error).message] };
  }
  const prepared = await prepareImport(pkg, now);
  if (prepared.assets.length) await putAssets(prepared.assets);
  if (prepared.stations.length) await putStations(prepared.stations);
  return prepared.report;
}

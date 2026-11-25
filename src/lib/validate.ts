import type { AssetRef, ChecklistItem, Station } from './types';

/** Validasi struktur satu entri stasiun dari file impor. Tidak memeriksa keberadaan file aset. */
export interface StationValidation {
  station?: Station;
  errors: string[];
  warnings: string[];
}

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

function parseChecklist(raw: unknown, phase: string, errors: string[]): ChecklistItem[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    errors.push(`Checklist ${phase} wajib berisi minimal satu butir.`);
    return [];
  }
  const ids = new Set<string>();
  const out: ChecklistItem[] = [];
  raw.forEach((item, i) => {
    const n = i + 1;
    if (typeof item === 'string') {
      // Bentuk ringkas: string → bobot 1, id otomatis.
      if (!item.trim()) errors.push(`Checklist ${phase} butir #${n} kosong.`);
      out.push({ id: `${phase[0]}${n}`, text: item.trim(), weight: 1 });
      return;
    }
    if (!isObj(item)) {
      errors.push(`Checklist ${phase} butir #${n} harus berupa objek atau teks.`);
      return;
    }
    const text = str(item.text);
    if (!text) errors.push(`Checklist ${phase} butir #${n} tidak punya "text".`);
    const id = str(item.id) || `${phase[0]}${n}`;
    if (ids.has(id)) errors.push(`Checklist ${phase}: id butir "${id}" ganda.`);
    ids.add(id);
    let weight = 1;
    if (item.weight !== undefined) {
      if (typeof item.weight !== 'number' || !Number.isFinite(item.weight) || item.weight <= 0) {
        errors.push(`Checklist ${phase} butir "${id}": bobot harus angka > 0.`);
      } else weight = item.weight;
    }
    out.push({ id, text, weight });
  });
  return out;
}

function parseAssets(raw: unknown, errors: string[]): AssetRef[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    errors.push('"assets" harus berupa array.');
    return [];
  }
  const out: AssetRef[] = [];
  raw.forEach((a, i) => {
    if (!isObj(a)) {
      errors.push(`Aset #${i + 1} harus berupa objek.`);
      return;
    }
    const path = str(a.path);
    if (!path) errors.push(`Aset #${i + 1} tidak punya "path".`);
    else if (/^[a-z]+:\/\//i.test(path) || path.startsWith('/') || path.split('/').includes('..')) {
      errors.push(`Aset "${path}": path harus relatif di dalam paket (tanpa URL, "/" awal, atau "..").`);
    }
    const label = str(a.label);
    if (!label) errors.push(`Aset #${i + 1} tidak punya "label" netral (mis. "AP").`);
    out.push({
      path,
      label,
      modality: str(a.modality) || undefined,
      caption: str(a.caption) || undefined,
    });
  });
  return out;
}

export function validateStationEntry(raw: unknown, forceDemo = false): StationValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isObj(raw)) return { errors: ['Entri stasiun harus berupa objek JSON.'], warnings };

  const id = str(raw.id);
  if (!id) errors.push('"id" wajib diisi.');
  else if (!ID_RE.test(id)) errors.push(`"id" "${id}" hanya boleh huruf, angka, titik, garis bawah, atau tanda hubung (maks 80).`);

  const topic = str(raw.topic).toLowerCase();
  if (!topic) errors.push('"topic" wajib diisi.');
  const title = str(raw.title);
  if (!title) errors.push('"title" (judul netral) wajib diisi.');
  const vignette = str(raw.vignette);
  if (!vignette) errors.push('"vignette" wajib diisi.');
  const clinicalQuestion = str(raw.clinicalQuestion);
  if (!clinicalQuestion) errors.push('"clinicalQuestion" (pertanyaan tahap 1) wajib diisi.');
  const followupQuestion = str(raw.followupQuestion);
  if (!followupQuestion) errors.push('"followupQuestion" (pertanyaan tahap 2) wajib diisi.');
  const followupInfo = str(raw.followupInfo) || undefined;

  if (typeof raw.imagingRequired !== 'boolean') errors.push('"imagingRequired" wajib bernilai true/false.');
  const imagingRequired = raw.imagingRequired === true;
  const assets = parseAssets(raw.assets, errors);
  if (imagingRequired && assets.length === 0) errors.push('"imagingRequired" = true tetapi "assets" kosong.');
  if (!imagingRequired && assets.length === 0 && !followupInfo) {
    warnings.push('Tidak ada gambar maupun "followupInfo"; pastikan pertanyaan lanjutan dapat dijawab dari vignette.');
  }

  const key = isObj(raw.key) ? raw.key : {};
  const keyClinical = str(key.clinical);
  const keyFollowup = str(key.followup);
  if (!keyClinical) errors.push('"key.clinical" (kunci tahap 1) wajib diisi.');
  if (!keyFollowup) errors.push('"key.followup" (kunci tahap 2) wajib diisi.');

  const discussion: Station['discussion'] = [];
  if (raw.discussion !== undefined) {
    if (!Array.isArray(raw.discussion)) errors.push('"discussion" harus berupa array {heading, body}.');
    else
      raw.discussion.forEach((d, i) => {
        if (!isObj(d) || !str(d.heading) || !str(d.body)) errors.push(`Pembahasan #${i + 1} butuh "heading" dan "body".`);
        else discussion.push({ heading: str(d.heading), body: str(d.body) });
      });
  }
  if (discussion.length === 0) warnings.push('Tidak ada pembahasan ("discussion").');

  const cl = isObj(raw.checklist) ? raw.checklist : {};
  const clinical = parseChecklist(cl.clinical, 'clinical', errors);
  const followup = parseChecklist(cl.followup, 'followup', errors);

  const src = isObj(raw.source) ? raw.source : null;
  const demo = forceDemo || raw.demo === true;
  let source: Station['source'] = { document: '' };
  if (!src || !str(src.document)) {
    if (demo) source = { document: 'Demo — bukan dari bank sumber', paraphrased: false };
    else errors.push('"source.document" (nama dokumen sumber) wajib untuk stasiun non-demo.');
  } else {
    const url = str(src.url) || undefined;
    if (url && !/^https?:\/\//i.test(url)) errors.push('"source.url" harus diawali http:// atau https://.');
    source = {
      document: str(src.document),
      scenario: str(src.scenario) || undefined,
      page: str(src.page) || undefined,
      url,
      paraphrased: src.paraphrased === true,
      note: str(src.note) || undefined,
    };
  }

  // Peringatan kebocoran ringan: judul memuat kalimat pertama kunci tahap 1.
  const firstKey = keyClinical.split(/[.\n;]/)[0]?.trim().toLowerCase();
  if (title && firstKey && firstKey.length >= 6 && title.toLowerCase().includes(firstKey)) {
    warnings.push('Judul tampaknya memuat diagnosis dari kunci; gunakan judul netral.');
  }

  if (JSON.stringify(raw).includes('GANTI:')) errors.push('Entri masih memuat teks placeholder "GANTI:" dari template.');

  if (errors.length) return { errors, warnings };
  return {
    station: {
      id,
      topic,
      title,
      vignette,
      clinicalQuestion,
      followupQuestion,
      followupInfo,
      imagingRequired,
      assets,
      key: { clinical: keyClinical, followup: keyFollowup },
      discussion,
      checklist: { clinical, followup },
      source,
      demo,
    },
    errors,
    warnings,
  };
}

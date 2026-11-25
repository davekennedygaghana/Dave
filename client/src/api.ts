export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public data: any = {},
  ) {
    super(message);
  }
}

export async function api<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  const isForm = body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(`/api${url}`, {
      method,
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'orthoboard', ...(body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Tidak dapat terhubung ke server. Periksa koneksi Anda.');
  }
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* respons tanpa JSON */
  }
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/auth/')) window.dispatchEvent(new Event('ob:unauthorized'));
    throw new ApiError(res.status, data?.error ?? `Permintaan gagal (${res.status}).`, data ?? {});
  }
  return data as T;
}

export const get = <T = any>(url: string) => api<T>('GET', url);
export const post = <T = any>(url: string, body: unknown = {}) => api<T>('POST', url, body);
export const put = <T = any>(url: string, body: unknown = {}) => api<T>('PUT', url, body);

export const qs = (o: Record<string, unknown>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== '' && v != null) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const FORMAT_LABEL: Record<string, string> = { cbt: 'CBT', viva: 'VIVA', osce: 'OSCE', essay: 'Esai' };
export const STATUS_LABEL: Record<string, string> = { draft: 'Draft', needs_review: 'Perlu ditinjau', approved: 'Disetujui' };
export const PROGRESS_LABEL: Record<string, string> = { unseen: 'Belum dibuka', opened: 'Dibuka, belum dinilai', correct: 'Benar / lulus', wrong: 'Salah / belum lulus' };

export const pct = (x: number | null | undefined) => (x == null ? '–' : `${Math.round(x * 100)}%`);
export const fmtDate = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
export const fmtClock = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
};

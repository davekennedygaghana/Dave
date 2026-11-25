import { Component, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, FORMAT_LABEL, STATUS_LABEL, api, get, post, put, qs } from '../api';
import { DemoChip, LoadState, Modal, Notice, Pager, useLoad } from '../components/ui';
import { QuestionView } from '../components/QuestionView';

const statusChip = (s: string) => <span className={`chip ${s === 'approved' ? 'ok' : s === 'needs_review' ? 'gold' : ''}`}>{STATUS_LABEL[s]}</span>;
const errText = (e: unknown) => {
  const err = e as ApiError;
  return [err.message, ...(err.data?.details ?? [])].join(' ');
};

const TEMPLATES: Record<string, any> = {
  cbt: { stem: '', options: ['A', 'B', 'C', 'D', 'E'].map((key) => ({ key, text: '', rationale: '' })), answer: 'A', explanation: '' },
  viva: { stem: '', rubric: [{ point: '', weight: 1 }, { point: '', weight: 1 }], explanation: '' },
  osce: { instructions: '', scenario: '', tasks: [''], timeSeconds: 420, checklist: [{ item: '', weight: 1, critical: false }, { item: '', weight: 1, critical: false }], image: null, explanation: '' },
  essay: { stem: '', outline: [''], rubric: [{ point: '', weight: 1 }, { point: '', weight: 1 }], explanation: '' },
};

// ---------------- Editor soal ----------------

function Editor({ id, newFormat, onClose, onSaved }: { id: string | null; newFormat?: string; onClose: () => void; onSaved: () => void }) {
  const cats = useLoad('/categories');
  const srcs = useLoad('/sources');
  const [loaded, setLoaded] = useState<any>(null);
  const [m, setM] = useState<any>(null);
  const [json, setJson] = useState('');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err' | 'warn'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [pages, setPages] = useState<any[] | null>(null);
  const [showVer, setShowVer] = useState<number | null>(null);

  const load = async () => {
    if (!id) {
      const f = newFormat!;
      setM({ format: f, category: 'other', topic: '', subtopic: '', bodyRegion: '', difficulty: 'sedang', demo: false, reference: { sourceId: null, bookTitle: '', edition: '', chapter: '', pdfPageStart: null, pdfPageEnd: null, printPage: '', printPageVerified: false } });
      setJson(JSON.stringify(TEMPLATES[f], null, 2));
      return;
    }
    const d = await get(`/admin/questions/${encodeURIComponent(id)}`);
    setLoaded(d);
    setM({ ...d.question, reference: { ...d.question.reference, printPage: d.question.reference.printPage ?? '' } });
    setJson(JSON.stringify(d.question.content, null, 2));
  };
  useEffect(() => {
    void load().catch((e) => setMsg({ kind: 'err', text: errText(e) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const parsed = useMemo(() => {
    try {
      return { ok: true as const, value: JSON.parse(json) };
    } catch (e: any) {
      return { ok: false as const, error: e.message as string };
    }
  }, [json]);

  if (!m) return <Modal title="Memuat…" onClose={onClose}>{msg ? <Notice kind="err">{msg.text}</Notice> : <LoadState loading error={null}>{null}</LoadState>}</Modal>;
  const r = m.reference;
  const setRef = (patch: any) => setM({ ...m, reference: { ...r, ...patch } });
  const numOrNull = (v: string) => (v === '' ? null : Number(v));

  const save = async (status: string) => {
    if (!parsed.ok) return setMsg({ kind: 'err', text: `JSON isi soal tidak valid: ${parsed.error}` });
    setBusy(true);
    setMsg(null);
    const question = { ...m, content: parsed.value, reference: { ...r, printPage: r.printPage === '' ? null : r.printPage } };
    try {
      if (id) {
        const res = await put(`/admin/questions/${encodeURIComponent(id)}`, { question, status, changeNote: note });
        setMsg(res.downgraded ? { kind: 'warn', text: `Tersimpan sebagai "perlu ditinjau" — belum bisa disetujui: ${res.problems.join(' ')}` } : { kind: 'ok', text: `Tersimpan (versi ${res.question.version}, ${STATUS_LABEL[res.question.status]}).` });
        setNote('');
        await load();
      } else {
        const res = await post('/admin/questions', { question: { ...question, status } });
        setMsg({ kind: 'ok', text: `Soal ${res.question.id} dibuat (${STATUS_LABEL[res.question.status]}).` });
        onSaved();
        onClose();
        return;
      }
      onSaved();
    } catch (e) {
      setMsg({ kind: 'err', text: errText(e) });
    } finally {
      setBusy(false);
    }
  };

  const showPages = async () => {
    try {
      setPages((await get(`/admin/sources/${r.sourceId}/pages${qs({ from: r.pdfPageStart, to: r.pdfPageEnd ?? r.pdfPageStart })}`)).pages);
    } catch (e) {
      setMsg({ kind: 'err', text: errText(e) });
    }
  };

  return (
    <Modal title={id ? `Tinjau soal ${id}` : `Soal ${FORMAT_LABEL[m.format]} baru`} onClose={onClose}>
      <div className="stack">
        {loaded && (
          <div className="row">
            {statusChip(loaded.question.status)} <span className="chip teal">{FORMAT_LABEL[m.format]}</span> {m.demo && <DemoChip />}
            <span className="muted small">versi {loaded.question.version} · asal: {loaded.question.origin} · {loaded.gradedAttempts} jawaban ternilai</span>
          </div>
        )}
        {loaded?.question.reviewNote && <Notice kind="warn">{loaded.question.reviewNote}</Notice>}
        {loaded && loaded.problems.length > 0 && (
          <Notice kind="warn">
            <b>Belum memenuhi syarat disetujui:</b>
            <ul className="list-plain">{loaded.problems.map((p: string) => <li key={p}>{p}</li>)}</ul>
          </Notice>
        )}
        {loaded && loaded.gradedAttempts > 0 && <p className="muted small">Soal ini sudah pernah dikerjakan. Perbaikan disimpan sebagai versi baru; riwayat jawaban tidak berubah.</p>}

        <div className="form-grid">
          <label className="field"><span>Kategori</span>
            <select value={m.category} onChange={(e) => setM({ ...m, category: e.target.value })}>
              {cats.data?.categories.map((c: any) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
            </select>
          </label>
          <label className="field"><span>Topik</span><input type="text" value={m.topic} onChange={(e) => setM({ ...m, topic: e.target.value })} /></label>
          <label className="field"><span>Subtopik</span><input type="text" value={m.subtopic} onChange={(e) => setM({ ...m, subtopic: e.target.value })} /></label>
          <label className="field"><span>Bagian tubuh</span><input type="text" value={m.bodyRegion} onChange={(e) => setM({ ...m, bodyRegion: e.target.value })} /></label>
          <label className="field"><span>Kesulitan</span>
            <select value={m.difficulty} onChange={(e) => setM({ ...m, difficulty: e.target.value })}><option>mudah</option><option>sedang</option><option>sulit</option></select>
          </label>
        </div>

        <h3 style={{ marginBottom: 0 }}>Rujukan sumber</h3>
        <div className="form-grid">
          <label className="field"><span>Sumber terunggah</span>
            <select value={r.sourceId ?? ''} onChange={(e) => {
              const s = srcs.data?.sources.find((x: any) => String(x.id) === e.target.value);
              setRef(s ? { sourceId: s.id, bookTitle: s.title, edition: s.edition } : { sourceId: null });
            }}>
              <option value="">(tidak ditautkan)</option>
              {srcs.data?.sources.map((s: any) => <option key={s.id} value={s.id}>{s.title}{s.edition && `, ed. ${s.edition}`}</option>)}
            </select>
          </label>
          <label className="field"><span>Nama buku</span><input type="text" value={r.bookTitle} onChange={(e) => setRef({ bookTitle: e.target.value })} /></label>
          <label className="field"><span>Edisi</span><input type="text" value={r.edition} onChange={(e) => setRef({ edition: e.target.value })} /></label>
          <label className="field"><span>Bab</span><input type="text" value={r.chapter} onChange={(e) => setRef({ chapter: e.target.value })} /></label>
          <label className="field"><span>Halaman PDF (awal)</span><input type="number" min={1} value={r.pdfPageStart ?? ''} onChange={(e) => setRef({ pdfPageStart: numOrNull(e.target.value) })} /></label>
          <label className="field"><span>Halaman PDF (akhir)</span><input type="number" min={1} value={r.pdfPageEnd ?? ''} onChange={(e) => setRef({ pdfPageEnd: numOrNull(e.target.value) })} /></label>
          <label className="field"><span>Halaman cetak (jika terverifikasi)</span><input type="text" value={r.printPage} onChange={(e) => setRef({ printPage: e.target.value })} /></label>
          <label className="row" style={{ alignSelf: 'end', minHeight: 44 }}>
            <input type="checkbox" style={{ width: 20, height: 20 }} checked={r.printPageVerified} disabled={!r.printPage} onChange={(e) => setRef({ printPageVerified: e.target.checked })} />
            <span className="small">Halaman cetak sudah saya cocokkan dengan buku</span>
          </label>
        </div>
        {r.sourceId && r.pdfPageStart && (
          <div className="row">
            <button className="btn sm" onClick={showPages}>Tampilkan teks halaman sumber</button>
            <a className="btn sm" href={`/api/sources/${r.sourceId}/file#page=${r.pdfPageStart}`} target="_blank" rel="noreferrer">Buka PDF di halaman {r.pdfPageStart}</a>
          </div>
        )}
        {pages && (
          <div>
            {pages.length === 0 && <Notice kind="warn">Halaman tidak ditemukan pada berkas.</Notice>}
            {pages.map((p) => (
              <details key={p.page} open>
                <summary className="small"><b>Halaman PDF {p.page}</b></summary>
                {p.text ? <pre className="json" style={{ whiteSpace: 'pre-wrap' }}>{p.text}</pre> : <Notice kind="warn">Tidak ada teks terbaca pada halaman ini (mungkin hasil pindai). Periksa langsung di PDF.</Notice>}
              </details>
            ))}
          </div>
        )}

        <label className="field">
          <span>Isi soal (JSON: pertanyaan, kunci/rubrik, pembahasan)</span>
          <textarea className="mono" rows={16} spellCheck={false} value={json} onChange={(e) => setJson(e.target.value)} aria-invalid={!parsed.ok} />
        </label>
        {!parsed.ok && <Notice kind="err">JSON tidak valid: {parsed.error}</Notice>}
        {m.format === 'osce' && <AssetUpload />}

        {parsed.ok && (
          <details>
            <summary><b>Pratinjau tampilan peserta (dengan kunci)</b></summary>
            <div className="card" style={{ marginTop: 8 }}>
              <PreviewGuard resetKey={json}>
                <QuestionView mode="readonly" item={{ question: { ...m, id: id ?? '(baru)', categoryName: cats.data?.categories.find((c: any) => c.slug === m.category)?.name ?? m.category, content: parsed.value }, attempt: null, reveal: { content: parsed.value, reference: r } }} />
              </PreviewGuard>
            </div>
          </details>
        )}

        {id && <label className="field"><span>Catatan perubahan (riwayat versi)</span><input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="mis. memperbaiki kunci sesuai hal. 212" /></label>}
        {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
        <div className="row">
          <button className="btn" disabled={busy} onClick={() => save('draft')}>Simpan sebagai draft</button>
          <button className="btn" disabled={busy} onClick={() => save('needs_review')}>Simpan — perlu ditinjau</button>
          <button className="btn primary" disabled={busy || m.demo} onClick={() => save('approved')} title={m.demo ? 'Soal DEMO tidak dapat disetujui' : ''}>Simpan &amp; setujui</button>
        </div>

        {loaded && (
          <div>
            <h3>Riwayat versi</h3>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Versi</th><th>Waktu</th><th>Oleh</th><th>Catatan</th><th></th></tr></thead>
                <tbody>
                  {loaded.versions.map((v: any) => (
                    <tr key={v.version}>
                      <td className="num">{v.version}</td>
                      <td className="small">{new Date(v.createdAt).toLocaleString('id-ID')}</td>
                      <td>{v.changedBy ?? '–'}</td>
                      <td>{v.changeNote} {statusChip(v.snapshot.status)}</td>
                      <td><button className="btn sm" onClick={() => setShowVer(showVer === v.version ? null : v.version)}>{showVer === v.version ? 'Tutup' : 'Lihat'}</button>{' '}
                        <button className="btn sm" onClick={() => (setJson(JSON.stringify(v.snapshot.content, null, 2)), setMsg({ kind: 'warn', text: `Isi versi ${v.version} dimuat ke editor. Belum tersimpan.` }))}>Muat isi</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {showVer != null && <pre className="json">{JSON.stringify(loaded.versions.find((v: any) => v.version === showVer)?.snapshot, null, 2)}</pre>}
          </div>
        )}
      </div>
    </Modal>
  );
}

/** Pratinjau memakai JSON yang sedang diketik; strukturnya bisa belum lengkap. */
class PreviewGuard extends Component<{ children: ReactNode; resetKey: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false });
  }
  render() {
    return this.state.failed ? <Notice kind="warn">Pratinjau belum dapat ditampilkan — struktur JSON belum lengkap untuk format ini.</Notice> : this.props.children;
  }
}

function AssetUpload() {
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const upload = async (f: File) => {
    const fd = new FormData();
    fd.append('file', f);
    try {
      setName((await api('POST', '/admin/assets', fd)).asset);
      setErr('');
    } catch (e) {
      setErr(errText(e));
    }
  };
  return (
    <div className="small">
      <label className="field"><span>Gambar stasiun OSCE (opsional, PNG/JPG/WebP)</span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} /></label>
      {name && <p>Terunggah. Isi pada JSON: <code>{`"image": { "asset": "${name}", "caption": "" }`}</code></p>}
      {err && <Notice kind="err">{err}</Notice>}
    </div>
  );
}

// ---------------- Tab: Tinjau ----------------

function Review() {
  const [f, setF] = useState({ status: 'needs_review', format: '', category: '', demo: '', origin: '', search: '', page: 1 });
  const { data, loading, error, reload } = useLoad(`/admin/questions${qs({ ...f, pageSize: 25 })}`);
  const cats = useLoad('/categories');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [edit, setEdit] = useState<{ id: string | null; format?: string } | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err' | 'warn'; text: string } | null>(null);
  const set = (patch: Partial<typeof f>) => (setSel(new Set()), setF((x) => ({ ...x, page: 1, ...patch })));
  const bulk = async (status: string) => {
    try {
      const r = await post('/admin/questions/bulk-status', { ids: [...sel], status });
      setMsg(r.failed.length ? { kind: 'warn', text: `${r.changed} diubah; ${r.failed.length} gagal: ${r.failed.slice(0, 3).map((x: any) => `${x.id} (${x.problems[0]})`).join('; ')}${r.failed.length > 3 ? '…' : ''}` } : { kind: 'ok', text: `${r.changed} soal diubah menjadi "${STATUS_LABEL[status]}".` });
      setSel(new Set());
      void reload();
    } catch (e) {
      setMsg({ kind: 'err', text: errText(e) });
    }
  };
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return (
    <div className="stack">
      <div className="card">
        <div className="form-grid">
          <label className="field"><span>Status</span>
            <select value={f.status} onChange={(e) => set({ status: e.target.value })}><option value="">Semua</option>{Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </label>
          <label className="field"><span>Format</span>
            <select value={f.format} onChange={(e) => set({ format: e.target.value })}><option value="">Semua</option>{Object.entries(FORMAT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </label>
          <label className="field"><span>Kategori</span>
            <select value={f.category} onChange={(e) => set({ category: e.target.value })}><option value="">Semua</option>{cats.data?.categories.map((c: any) => <option key={c.slug} value={c.slug}>{c.name} ({c.total})</option>)}</select>
          </label>
          <label className="field"><span>Asal</span>
            <select value={f.origin} onChange={(e) => set({ origin: e.target.value })}><option value="">Semua</option><option value="import">Impor</option><option value="ai">Draft AI</option><option value="manual">Manual</option><option value="demo">Demo</option></select>
          </label>
          <label className="field"><span>Cari</span><input type="search" value={f.search} onChange={(e) => set({ search: e.target.value })} /></label>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <span className="small muted">Soal baru:</span>
          {Object.entries(FORMAT_LABEL).map(([k, v]) => <button key={k} className="btn sm" onClick={() => setEdit({ id: null, format: k })}>+ {v}</button>)}
        </div>
      </div>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <LoadState loading={loading && !data} error={error}>
        {data && (
          <div className="card">
            <div className="row between" style={{ marginBottom: 10 }}>
              <span className="num">{data.total} soal · {sel.size} dipilih</span>
              <div className="row">
                <button className="btn sm" onClick={() => setSel(new Set(sel.size === data.items.length ? [] : data.items.map((q: any) => q.id)))}>{sel.size === data.items.length && sel.size > 0 ? 'Batal pilih' : 'Pilih halaman ini'}</button>
                <button className="btn sm primary" disabled={sel.size === 0} onClick={() => bulk('approved')}>Setujui terpilih</button>
                <button className="btn sm" disabled={sel.size === 0} onClick={() => bulk('needs_review')}>Tandai perlu ditinjau</button>
                <button className="btn sm" disabled={sel.size === 0} onClick={() => bulk('draft')}>Jadikan draft</button>
              </div>
            </div>
            {data.items.length === 0 ? <p className="muted">Tidak ada soal pada filter ini.</p> : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th><span className="sr-only">Pilih</span></th><th>Soal</th><th>Rujukan</th><th>Status</th><th></th></tr></thead>
                  <tbody>
                    {data.items.map((q: any) => (
                      <tr key={q.id}>
                        <td><input type="checkbox" style={{ width: 20, height: 20 }} aria-label={`Pilih ${q.id}`} checked={sel.has(q.id)} onChange={() => toggle(q.id)} /></td>
                        <td style={{ minWidth: 240 }}>
                          <span className="q-id">{q.id}</span> <span className="chip teal">{FORMAT_LABEL[q.format]}</span> {q.demo && <DemoChip />}<br />
                          {q.stem || <i className="muted">(kosong)</i>}<br />
                          <span className="muted small">{q.category} · {q.topic || 'tanpa topik'} · v{q.version} · {q.origin}</span>
                        </td>
                        <td className="small">{q.reference.bookTitle || <i className="muted">belum ada</i>}{q.reference.edition && `, ed. ${q.reference.edition}`}<br />{q.reference.chapter}{q.reference.pdfPageStart ? ` · PDF hlm. ${q.reference.pdfPageStart}` : ''}</td>
                        <td>{statusChip(q.status)}{q.problems.length > 0 && <><br /><span className="chip bad" title={q.problems.join('\n')}>{q.problems.length} kekurangan</span></>}</td>
                        <td><button className="btn sm" onClick={() => setEdit({ id: q.id })}>Tinjau</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Pager page={data.page} pages={data.pages} onPage={(p) => (setSel(new Set()), setF((x) => ({ ...x, page: p })))} />
          </div>
        )}
      </LoadState>
      {edit && <Editor id={edit.id} newFormat={edit.format} onClose={() => setEdit(null)} onSaved={reload} />}
    </div>
  );
}

// ---------------- Tab: Impor ----------------

function Import() {
  const [textValue, setTextValue] = useState('');
  const [trust, setTrust] = useState(false);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<any>(null);
  const [err, setErr] = useState('');
  const run = async () => {
    setBusy(true);
    setErr('');
    setReport(null);
    try {
      const data = JSON.parse(textValue);
      const questions = Array.isArray(data) ? data : data.questions;
      setReport(await post('/admin/import', { questions, trustApproved: trust }));
    } catch (e) {
      setErr(e instanceof ApiError ? errText(e) : `JSON tidak valid: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack">
      <div className="card stack">
        <h2>Impor bank soal (JSON)</h2>
        <p className="muted small">
          Format: <code>{'{ "questions": [ … ] }'}</code> — lihat <code>data-examples/import-example.json</code> dan README. ID yang sudah ada diperbarui sebagai versi baru; progres tidak terhapus. Soal masuk sebagai draft/perlu ditinjau lalu disetujui di tab Tinjau.
        </p>
        <label className="field"><span>Pilih berkas .json</span><input type="file" accept="application/json,.json" onChange={async (e) => e.target.files?.[0] && setTextValue(await e.target.files[0].text())} /></label>
        <label className="field"><span>atau tempel JSON</span><textarea className="mono" rows={8} spellCheck={false} value={textValue} onChange={(e) => setTextValue(e.target.value)} /></label>
        <label className="row"><input type="checkbox" style={{ width: 20, height: 20 }} checked={trust} onChange={(e) => setTrust(e.target.checked)} /><span className="small">Hormati status <code>"approved"</code> dari berkas (hanya untuk bank yang sudah saya tinjau sendiri; soal yang tidak lengkap tetap ditahan)</span></label>
        <div><button className="btn primary" disabled={busy || !textValue.trim()} onClick={run}>{busy ? 'Mengimpor…' : 'Impor'}</button></div>
        {err && <Notice kind="err">{err}</Notice>}
      </div>
      {report && (
        <div className="card">
          <h2>Hasil impor</h2>
          <p className="num">{report.total} butir · <b>{report.created}</b> dibuat · <b>{report.updated}</b> diperbarui · {report.unchanged} tidak berubah · <b>{report.rejected}</b> ditolak</p>
          <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
            <table>
              <thead><tr><th>#</th><th>ID</th><th>Hasil</th><th>Status</th><th>Catatan</th></tr></thead>
              <tbody>
                {report.items.filter((i: any) => i.result !== 'unchanged').slice(0, 500).map((i: any) => (
                  <tr key={i.index}><td className="num">{i.index + 1}</td><td className="q-id">{i.id ?? '–'}</td><td><span className={`chip ${i.result === 'rejected' ? 'bad' : 'ok'}`}>{i.result}</span></td><td>{i.status ? statusChip(i.status) : '–'}</td><td className="small">{i.messages.join(' ')}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- Tab: Sumber ----------------

function Sources() {
  const { data, loading, error, reload } = useLoad('/sources');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<any[] | null>(null);
  const [err, setErr] = useState('');
  const form = useRef<HTMLFormElement>(null);
  const upload = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    setResults(null);
    try {
      setResults((await api('POST', '/admin/sources', new FormData(form.current!))).results);
      form.current!.reset();
      void reload();
    } catch (e2) {
      setErr(errText(e2));
    } finally {
      setBusy(false);
    }
  };
  const editMeta = async (s: any) => {
    const title = window.prompt('Nama buku', s.title);
    if (title == null) return;
    const edition = window.prompt('Edisi', s.edition);
    if (edition == null) return;
    const authors = window.prompt('Penulis/editor', s.authors) ?? s.authors;
    await api('PATCH', `/admin/sources/${s.id}`, { title, edition, authors }).catch((e2) => setErr(errText(e2)));
    void reload();
  };
  const remove = async (s: any) => {
    if (!window.confirm(`Hapus sumber "${s.title}" beserta berkasnya?`)) return;
    await api('DELETE', `/admin/sources/${s.id}`).catch((e2) => setErr(errText(e2)));
    void reload();
  };
  return (
    <div className="stack">
      <form className="card stack" ref={form} onSubmit={upload}>
        <h2>Unggah sumber referensi</h2>
        <p className="muted small">PDF tunggal, atau ZIP berisi beberapa PDF (tiap PDF menjadi satu sumber; lengkapi nama buku dan edisinya setelah unggah). Berkas disimpan di server dan hanya dapat dibuka pengguna yang masuk sesuai pengaturan akses.</p>
        <div className="form-grid">
          <label className="field"><span>Berkas PDF / ZIP</span><input type="file" name="file" accept=".pdf,.zip,application/pdf,application/zip" required /></label>
          <label className="field"><span>Nama buku</span><input type="text" name="title" placeholder="kosongkan = nama berkas" /></label>
          <label className="field"><span>Edisi</span><input type="text" name="edition" /></label>
          <label className="field"><span>Penulis / editor</span><input type="text" name="authors" /></label>
        </div>
        <div><button className="btn primary" disabled={busy}>{busy ? 'Mengunggah & membaca…' : 'Unggah'}</button></div>
        {err && <Notice kind="err">{err}</Notice>}
        {results?.map((r, i) => <Notice key={i} kind={r.result === 'created' ? 'ok' : 'warn'}><b>{r.filename}</b>: {r.message}</Notice>)}
      </form>
      <LoadState loading={loading && !data} error={error}>
        {data && (
          <div className="card">
            <h2>Daftar sumber</h2>
            {data.sources.length === 0 ? <p className="muted">Belum ada sumber.</p> : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>ID</th><th>Buku</th><th className="num">Halaman</th><th className="num">Soal</th><th></th></tr></thead>
                  <tbody>
                    {data.sources.map((s: any) => (
                      <tr key={s.id}>
                        <td className="num">{s.id}</td>
                        <td><b>{s.title}</b> {s.demo && <DemoChip />}<br /><span className="muted small">{s.edition ? `Edisi ${s.edition}` : <span className="chip gold">edisi belum diisi</span>} {s.authors && `· ${s.authors}`} {s.filename && `· ${s.filename}`}</span></td>
                        <td className="num">{s.pageCount ?? '–'}</td>
                        <td className="num">{s.approvedCount} / {s.questionCount}</td>
                        <td><div className="row">{s.fileUrl && <a className="btn sm" href={s.fileUrl} target="_blank" rel="noreferrer">Buka</a>}<button className="btn sm" onClick={() => editMeta(s)}>Ubah</button><button className="btn sm danger" onClick={() => remove(s)}>Hapus</button></div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </LoadState>
    </div>
  );
}

// ---------------- Tab: Draft AI ----------------

function AiTab() {
  const { data, error, reload } = useLoad('/admin/ai');
  const srcs = useLoad('/sources');
  const cats = useLoad('/categories');
  const [f, setF] = useState({ sourceId: '', pageStart: '', pageEnd: '', format: 'cbt', category: 'other', chapter: '', countPerBatch: '5' });
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const pending = (data?.status.queue.queued ?? 0) + (data?.status.queue.running ?? 0);
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(reload, 4000);
    return () => clearInterval(t);
  }, [pending, reload]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const r = await post('/admin/ai/jobs', f);
      setMsg({ kind: 'ok', text: `${r.jobIds.length} pekerjaan masuk antrean.` });
      void reload();
    } catch (e2) {
      setMsg({ kind: 'err', text: errText(e2) });
    }
  };
  const act = async (id: number, what: string) => {
    await post(`/admin/ai/jobs/${id}/${what}`).catch((e2) => setMsg({ kind: 'err', text: errText(e2) }));
    void reload();
  };
  if (error) return <Notice kind="err">{error}</Notice>;
  if (!data) return <LoadState loading error={null}>{null}</LoadState>;
  const st = data.status;
  return (
    <div className="stack">
      {st.configured ? (
        <Notice>Integrasi AI aktif di server (model <code>{st.model}</code>, {st.pagesPerBatch} halaman per batch). Hasil selalu masuk sebagai <b>draft</b> dan wajib ditinjau terhadap sumber sebelum disetujui. Antrean {st.workerRunning ? 'sedang berjalan' : 'tidak sedang berjalan'}.</Notice>
      ) : (
        <Notice kind="warn"><b>Integrasi AI belum dikonfigurasi.</b> Variabel <code>ANTHROPIC_API_KEY</code> kosong di server, jadi tidak ada generasi otomatis. Aplikasi tetap berfungsi penuh dengan impor JSON dan penulisan manual.</Notice>
      )}
      <form className="card stack" onSubmit={submit}>
        <h2>Buat draft dari halaman sumber</h2>
        <div className="form-grid">
          <label className="field"><span>Sumber</span>
            <select required value={f.sourceId} onChange={(e) => setF({ ...f, sourceId: e.target.value })}><option value="">Pilih…</option>{srcs.data?.sources.filter((s: any) => s.hasFile).map((s: any) => <option key={s.id} value={s.id}>{s.title} ({s.pageCount ?? '?'} hlm.)</option>)}</select>
          </label>
          <label className="field"><span>Halaman PDF awal</span><input type="number" min={1} required value={f.pageStart} onChange={(e) => setF({ ...f, pageStart: e.target.value })} /></label>
          <label className="field"><span>Halaman PDF akhir</span><input type="number" min={1} required value={f.pageEnd} onChange={(e) => setF({ ...f, pageEnd: e.target.value })} /></label>
          <label className="field"><span>Bab</span><input type="text" value={f.chapter} onChange={(e) => setF({ ...f, chapter: e.target.value })} /></label>
          <label className="field"><span>Format</span><select value={f.format} onChange={(e) => setF({ ...f, format: e.target.value })}>{Object.entries(FORMAT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="field"><span>Kategori</span><select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{cats.data?.categories.map((c: any) => <option key={c.slug} value={c.slug}>{c.name}</option>)}</select></label>
          <label className="field"><span>Maks. soal per batch (1–20)</span><input type="number" min={1} max={20} required value={f.countPerBatch} onChange={(e) => setF({ ...f, countPerBatch: e.target.value })} /></label>
        </div>
        <div><button className="btn primary" disabled={!st.configured}>Masukkan ke antrean</button></div>
        {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      </form>
      <div className="card">
        <div className="row between"><h2>Antrean</h2><button className="btn sm" onClick={reload}>Muat ulang</button></div>
        {data.jobs.length === 0 ? <p className="muted">Belum ada pekerjaan.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>#</th><th>Sumber</th><th>Halaman</th><th>Format</th><th>Status</th><th className="num">Draft</th><th>Catatan / galat</th><th></th></tr></thead>
              <tbody>
                {data.jobs.map((j: any) => (
                  <tr key={j.id}>
                    <td className="num">{j.id}</td><td>{j.sourceTitle}</td><td className="num">{j.pageStart}–{j.pageEnd}</td><td>{FORMAT_LABEL[j.format]}</td>
                    <td><span className={`chip ${j.status === 'done' ? 'ok' : j.status === 'failed' ? 'bad' : j.status === 'running' ? 'teal' : ''}`}>{{ queued: 'antre', running: 'diproses', done: 'selesai', failed: 'gagal', cancelled: 'dibatalkan' }[j.status as string]}</span></td>
                    <td className="num">{j.createdCount}</td><td className="small">{j.error ?? ''}</td>
                    <td>{j.status === 'queued' && <button className="btn sm" onClick={() => act(j.id, 'cancel')}>Batalkan</button>}{(j.status === 'failed' || j.status === 'cancelled') && <button className="btn sm" onClick={() => act(j.id, 'retry')}>Ulangi</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------- Tab: Pengaturan ----------------

function Settings() {
  const ov = useLoad('/admin/overview');
  const users = useLoad('/admin/users');
  const [u, setU] = useState({ username: '', password: '', role: 'learner' });
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const toggleDemo = async () => {
    await put('/admin/settings', { demoMode: !ov.data.demoMode });
    void ov.reload();
  };
  const addUser = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await post('/admin/users', u);
      setMsg({ kind: 'ok', text: `Pengguna ${u.username} dibuat.` });
      setU({ username: '', password: '', role: 'learner' });
      void users.reload();
    } catch (e2) {
      setMsg({ kind: 'err', text: errText(e2) });
    }
  };
  const resetPw = async (x: any) => {
    const password = window.prompt(`Sandi baru untuk ${x.username} (min. 8 karakter)`);
    if (!password) return;
    try {
      await post(`/admin/users/${x.id}/password`, { password });
      setMsg({ kind: 'ok', text: `Sandi ${x.username} diperbarui.` });
    } catch (e2) {
      setMsg({ kind: 'err', text: errText(e2) });
    }
  };
  return (
    <div className="stack">
      <LoadState loading={ov.loading && !ov.data} error={ov.error}>
        {ov.data && (
          <>
            <div className="card">
              <h2>Mode demo</h2>
              <p className="small">Saat aktif, soal berlabel DEMO (teks pengisi, bukan materi medis) ikut masuk paket harian dan seluruh tampilan diberi tanda DEMO. Matikan untuk memakai hanya soal berstatus disetujui.</p>
              <div className="row"><span className={`chip ${ov.data.demoMode ? 'demo' : ''}`}>{ov.data.demoMode ? 'AKTIF' : 'Nonaktif'}</span><button className="btn" onClick={toggleDemo}>{ov.data.demoMode ? 'Matikan mode demo' : 'Nyalakan mode demo'}</button></div>
            </div>
            <div className="card">
              <h2>Konfigurasi server</h2>
              <p className="small muted">Diatur lewat environment variable (lihat <code>.env.example</code>); tidak dapat diubah dari browser.</p>
              <ul className="list-plain small">
                <li>Target harian: <b>{ov.data.dailyTarget}</b> soal · zona waktu: <b>{ov.data.timezone}</b></li>
                <li>Akses berkas PDF referensi: <b>{ov.data.referenceAccess === 'admin' ? 'hanya admin' : 'semua pengguna yang masuk'}</b></li>
                <li>Integrasi AI: <b>{ov.data.ai.configured ? `aktif (${ov.data.ai.model})` : 'nonaktif'}</b></li>
              </ul>
            </div>
          </>
        )}
      </LoadState>
      <div className="card stack">
        <h2>Pengguna</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Nama pengguna</th><th>Peran</th><th></th></tr></thead>
            <tbody>{users.data?.users.map((x: any) => <tr key={x.id}><td>{x.username}</td><td>{x.role === 'admin' ? 'Admin' : 'Peserta'}</td><td><button className="btn sm" onClick={() => resetPw(x)}>Ganti sandi</button></td></tr>)}</tbody>
          </table>
        </div>
        <form className="form-grid" onSubmit={addUser}>
          <label className="field"><span>Nama pengguna baru</span><input type="text" required autoCapitalize="none" value={u.username} onChange={(e) => setU({ ...u, username: e.target.value })} /></label>
          <label className="field"><span>Sandi (min. 8 karakter)</span><input type="password" required minLength={8} autoComplete="new-password" value={u.password} onChange={(e) => setU({ ...u, password: e.target.value })} /></label>
          <label className="field"><span>Peran</span><select value={u.role} onChange={(e) => setU({ ...u, role: e.target.value })}><option value="learner">Peserta</option><option value="admin">Admin</option></select></label>
          <div style={{ alignSelf: 'end' }}><button className="btn">Tambah pengguna</button></div>
        </form>
        {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      </div>
    </div>
  );
}

const TABS = [
  { key: 'review', label: 'Tinjau & setujui', el: <Review /> },
  { key: 'import', label: 'Impor bank soal', el: <Import /> },
  { key: 'sources', label: 'Sumber referensi', el: <Sources /> },
  { key: 'ai', label: 'Draft AI', el: <AiTab /> },
  { key: 'settings', label: 'Pengaturan', el: <Settings /> },
];

export function Admin() {
  const [tab, setTab] = useState('review');
  const ov = useLoad('/admin/overview');
  const count = (pred: (r: any) => boolean) => (ov.data?.byStatus ?? []).filter(pred).reduce((a: number, r: any) => a + r.n, 0);
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Panel admin</h1>
          <p>Unggah sumber → impor/susun draft → tinjau → setujui. Hanya soal disetujui yang masuk paket resmi.</p>
        </div>
        {ov.data && (
          <div className="row">
            <span className="chip ok num">{count((r) => r.status === 'approved' && !r.demo)} disetujui</span>
            <span className="chip gold num">{count((r) => r.status === 'needs_review' && !r.demo)} perlu ditinjau</span>
            <span className="chip num">{count((r) => r.status === 'draft' && !r.demo)} draft</span>
            {count((r) => r.demo) > 0 && <span className="chip demo num">{count((r) => r.demo)} DEMO</span>}
          </div>
        )}
      </div>
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => (setTab(t.key), void ov.reload())}>
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">{TABS.find((t) => t.key === tab)!.el}</div>
    </div>
  );
}

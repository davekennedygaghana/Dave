import { useEffect, useState } from 'react';
import { FORMAT_LABEL, PROGRESS_LABEL, pct, put, qs } from '../api';
import { DemoChip, LoadState, Modal, Notice, Pager, useLoad } from '../components/ui';
import { QuestionView } from '../components/QuestionView';

const progressChip = (p: string) => <span className={`chip ${p === 'correct' ? 'ok' : p === 'wrong' ? 'bad' : p === 'opened' ? 'gold' : ''}`}>{PROGRESS_LABEL[p]}</span>;

function Detail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { data, loading, error, setData } = useLoad(`/bank/${encodeURIComponent(id)}`);
  const toggle = async () => {
    const on = !data.bookmarked;
    setData({ ...data, bookmarked: on });
    await put(`/bookmarks/${encodeURIComponent(id)}`, { on });
    onChanged();
  };
  return (
    <Modal title={`Soal ${id}`} onClose={onClose}>
      <LoadState loading={loading} error={error}>
        {data &&
          (data.hidden ? (
            <Notice>Soal ini belum pernah Anda buka. Isinya disembunyikan agar tetap menjadi soal baru di paket harian.</Notice>
          ) : (
            <div className="stack">
              <div className="row between">
                <span className="muted small">
                  {data.attempts.length} kali dinilai
                  {data.attempts.map((a: any, i: number) => (
                    <span key={i} className={`chip ${a.isCorrect ? 'ok' : 'bad'}`} style={{ marginLeft: 6 }}>
                      {a.kind === 'new' ? 'baru' : 'remedial'}: {a.autoGraded ? (a.isCorrect ? 'benar' : 'salah') : pct(a.score)}
                    </span>
                  ))}
                </span>
                <button className={`btn sm ${data.bookmarked ? 'gold' : ''}`} aria-pressed={data.bookmarked} onClick={toggle}>
                  {data.bookmarked ? 'Ditandai' : 'Tandai untuk remedial'}
                </button>
              </div>
              <QuestionView
                mode="readonly"
                item={{ question: data.question, reveal: data.reveal, attempt: data.attempts.length ? { ...data.attempts[data.attempts.length - 1], submitted: false, graded: true } : null }}
              />
              {!data.reveal && <Notice>Kunci dan pembahasan tampil setelah soal ini dinilai (dan sesi ujian yang memuatnya selesai).</Notice>}
            </div>
          ))}
      </LoadState>
    </Modal>
  );
}

export function Bank() {
  const [f, setF] = useState({ search: '', category: '', format: '', difficulty: '', progress: '', bookmarked: '', page: 1 });
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const cats = useLoad('/categories');
  const { data, loading, error, reload } = useLoad(`/bank${qs({ ...f, pageSize: 20 })}`);
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, page: 1, ...patch }));
  useEffect(() => {
    const t = setTimeout(() => setF((x) => (x.search === search ? x : { ...x, search, page: 1 })), 350);
    return () => clearTimeout(t);
  }, [search]);

  return (
    <div className="page stack">
      <div className="page-head">
        <div>
          <h1>Bank soal</h1>
          <p>Soal yang memenuhi syarat paket. Isi soal yang belum dibuka disembunyikan.</p>
        </div>
        {data && <span className="chip teal num">{data.total.toLocaleString('id-ID')} soal</span>}
      </div>

      <div className="card">
        <div className="form-grid">
          <label className="field">
            <span>Cari (ID, topik, isi soal yang sudah dibuka)</span>
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Ketik kata kunci…" />
          </label>
          <label className="field">
            <span>Kategori</span>
            <select value={f.category} onChange={(e) => set({ category: e.target.value })}>
              <option value="">Semua kategori</option>
              {cats.data?.categories.map((c: any) => (
                <option key={c.slug} value={c.slug} disabled={c.eligible === 0}>
                  {c.name} ({c.eligible === 0 ? 'belum ada soal' : c.eligible})
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Format</span>
            <select value={f.format} onChange={(e) => set({ format: e.target.value })}>
              <option value="">Semua format</option>
              {Object.entries(FORMAT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Kesulitan</span>
            <select value={f.difficulty} onChange={(e) => set({ difficulty: e.target.value })}>
              <option value="">Semua</option>
              <option value="mudah">Mudah</option>
              <option value="sedang">Sedang</option>
              <option value="sulit">Sulit</option>
            </select>
          </label>
          <label className="field">
            <span>Status pengerjaan</span>
            <select value={f.progress} onChange={(e) => set({ progress: e.target.value })}>
              <option value="">Semua</option>
              {Object.entries(PROGRESS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Tanda</span>
            <select value={f.bookmarked} onChange={(e) => set({ bookmarked: e.target.value })}>
              <option value="">Semua</option>
              <option value="1">Hanya yang ditandai</option>
            </select>
          </label>
        </div>
      </div>

      <LoadState loading={loading && !data} error={error}>
        {data && (
          <div className="card">
            {data.items.length === 0 ? (
              <p className="muted">Tidak ada soal yang cocok dengan filter ini.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Soal</th><th>Format</th><th>Kategori / topik</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    {data.items.map((q: any) => (
                      <tr key={q.id} className="clickable" onClick={() => setOpen(q.id)}>
                        <td style={{ minWidth: 220 }}>
                          <button className="btn ghost sm" style={{ padding: 0, minHeight: 0, textAlign: 'left', fontWeight: 400 }} onClick={(e) => (e.stopPropagation(), setOpen(q.id))}>
                            <span>
                              <span className="q-id">{q.id}</span> {q.demo && <DemoChip />} {q.bookmarked && <span className="chip gold">ditandai</span>}
                              <br />
                              {q.stem ?? <i className="muted">Belum dibuka — isi disembunyikan</i>}
                            </span>
                          </button>
                        </td>
                        <td><span className="chip teal">{FORMAT_LABEL[q.format]}</span></td>
                        <td>{q.categoryName}<br /><span className="muted small">{q.topic} · {q.difficulty}</span></td>
                        <td>{progressChip(q.progress)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Pager page={data.page} pages={data.pages} onPage={(p) => setF((x) => ({ ...x, page: p }))} />
          </div>
        )}
      </LoadState>
      {open && <Detail id={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </div>
  );
}

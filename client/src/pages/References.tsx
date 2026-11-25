import { useState } from 'react';
import { FORMAT_LABEL, PROGRESS_LABEL } from '../api';
import { DemoChip, LoadState, Notice, useLoad } from '../components/ui';

function SourceQuestions({ id }: { id: number }) {
  const { data, loading, error } = useLoad(`/sources/${id}/questions`);
  return (
    <LoadState loading={loading} error={error}>
      {data &&
        (data.items.length === 0 ? (
          <p className="muted small">Belum ada soal layak-paket yang merujuk sumber ini.</p>
        ) : (
          <ul className="list-plain small">
            {data.items.map((q: any) => (
              <li key={q.id}>
                <span className="q-id">{q.id}</span> · {FORMAT_LABEL[q.format]} · {q.topic} · <span className="muted">{PROGRESS_LABEL[q.progress]}</span>
              </li>
            ))}
          </ul>
        ))}
    </LoadState>
  );
}

export function References() {
  const { data, loading, error } = useLoad('/sources');
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="page stack">
      <div className="page-head">
        <div>
          <h1>Referensi</h1>
          <p>Sumber yang diunggah admin. Rujukan buku, edisi, bab, dan halaman tiap soal tampil di pembahasannya.</p>
        </div>
      </div>
      <LoadState loading={loading} error={error}>
        {data && (
          <>
            {!data.canOpenFiles && <Notice>Berkas PDF referensi dibatasi untuk admin. Anda tetap melihat rujukan halaman pada pembahasan soal.</Notice>}
            {data.sources.length === 0 && <div className="card"><p className="muted" style={{ margin: 0 }}>Belum ada sumber referensi. Admin dapat mengunggah PDF atau ZIP di Panel admin → Sumber.</p></div>}
            {data.sources.map((s: any) => (
              <article className="card" key={s.id}>
                <div className="row between">
                  <div>
                    <h2 style={{ marginBottom: 2 }}>{s.title} {s.demo && <DemoChip />}</h2>
                    <p className="muted small" style={{ margin: 0 }}>
                      {s.edition ? `Edisi ${s.edition}` : 'Edisi belum diisi'}
                      {s.authors && ` · ${s.authors}`}
                      {s.pageCount ? ` · ${s.pageCount} halaman PDF` : ''}
                      {!s.hasFile && ' · tanpa berkas'}
                    </p>
                  </div>
                  <div className="row">
                    <span className="chip teal num">{s.approvedCount} soal disetujui</span>
                    {s.fileUrl && <a className="btn sm" href={s.fileUrl} target="_blank" rel="noreferrer">Buka PDF</a>}
                    <button className="btn sm" aria-expanded={open === s.id} onClick={() => setOpen(open === s.id ? null : s.id)}>
                      {open === s.id ? 'Tutup daftar soal' : 'Soal yang merujuk'}
                    </button>
                  </div>
                </div>
                {s.notes && <p className="small" style={{ marginTop: 8 }}>{s.notes}</p>}
                {open === s.id && <div style={{ marginTop: 10 }}><SourceQuestions id={s.id} /></div>}
              </article>
            ))}
          </>
        )}
      </LoadState>
    </div>
  );
}

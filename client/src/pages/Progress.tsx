import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, FORMAT_LABEL, fmtDate, pct, post } from '../api';
import { Bar, LoadState, Notice, Stat, useLoad } from '../components/ui';

function Backup({ onRestored }: { onRestored: () => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const restore = async (f: File) => {
    setMsg(null);
    try {
      const data = JSON.parse(await f.text());
      if (!window.confirm('Memulihkan cadangan akan MENGGANTI seluruh progres Anda saat ini dengan isi berkas. Lanjutkan?')) return;
      const r = await post('/backup/import', data);
      setMsg({
        kind: 'ok',
        text: `Dipulihkan: ${r.restored.attempts} jawaban, ${r.restored.sessions} sesi, ${r.restored.packages} paket, ${r.restored.bookmarks} tanda.${r.skippedQuestionIds.length ? ` ${r.skippedQuestionIds.length} soal dilewati karena tidak ada di bank.` : ''}`,
      });
      onRestored();
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof ApiError ? e.message : 'Berkas bukan JSON yang valid.' });
    } finally {
      if (file.current) file.current.value = '';
    }
  };
  return (
    <section className="card">
      <h2>Cadangan progres</h2>
      <p className="muted small">Progres utama tersimpan di database server. Ekspor berkas ini sebagai cadangan tambahan (paket harian, jawaban, nilai, tanda, sesi).</p>
      <div className="row">
        <a className="btn" href="/api/backup/export" download>
          Ekspor cadangan (.json)
        </a>
        <button className="btn" onClick={() => file.current?.click()}>
          Impor cadangan…
        </button>
        <input ref={file} type="file" accept="application/json,.json" className="sr-only" aria-label="Berkas cadangan" onChange={(e) => e.target.files?.[0] && restore(e.target.files[0])} />
      </div>
      {msg && <div style={{ marginTop: 12 }}><Notice kind={msg.kind}>{msg.text}</Notice></div>}
    </section>
  );
}

export function Progress() {
  const { data: d, loading, error, reload } = useLoad('/progress');
  const sess = useLoad('/sessions');
  const n = (x: number) => x.toLocaleString('id-ID');
  const catHas = new Set<string>((d?.byTopic ?? []).map((t: any) => t.category));
  return (
    <div className="page stack">
      <div className="page-head">
        <div>
          <h1>Progres</h1>
          <p>Nilai otomatis (CBT) dan nilai mandiri (VIVA, OSCE, esai) ditampilkan terpisah.</p>
        </div>
      </div>
      <LoadState loading={loading && !d} error={error}>
        {d && (
          <>
            <div className="grid cols-2">
              <Stat label="Total soal baru selesai" value={n(d.totals.newDone)} sub="dijawab dan dinilai" />
              <Stat label="Total remedial dinilai" value={n(d.totals.remedialDone)} sub="tidak dihitung sebagai soal baru" />
            </div>

            <section className="card">
              <h2>Riwayat harian</h2>
              {d.daily.length === 0 ? (
                <p className="muted">Belum ada riwayat.</p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr><th>Tanggal (WITA)</th><th style={{ minWidth: 160 }}>Soal baru selesai</th><th className="num">Paket</th><th className="num">CBT (otomatis)</th><th className="num">Mandiri</th><th className="num">Remedial</th></tr>
                    </thead>
                    <tbody>
                      {d.daily.map((x: any) => (
                        <tr key={x.date}>
                          <td>{fmtDate(x.date)} {x.isToday && <span className="chip teal">hari ini</span>}</td>
                          <td>
                            <span className="num"><b>{n(x.done)}</b> / {n(x.target)}</span>
                            <Bar value={x.done} max={x.target} thin label={`Progres ${x.date}`} />
                          </td>
                          <td className="num">{n(x.size)}{x.size < x.target && <><br /><span className="muted small">kurang {n(x.target - x.size)}</span></>}</td>
                          <td className="num">{x.cbt.n ? <>{pct(x.cbt.correct / x.cbt.n)}<br /><span className="muted small">{x.cbt.correct}/{x.cbt.n}</span></> : '–'}</td>
                          <td className="num">{x.self.n ? <>{pct(x.self.avg)}<br /><span className="muted small">{x.self.n} soal</span></> : '–'}{x.awaitingGrade > 0 && <><br /><span className="chip gold">{x.awaitingGrade} menunggu nilai</span></>}</td>
                          <td className="num">{n(x.remedialDone)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="card">
              <h2>Nilai per format</h2>
              {d.byFormat.length === 0 ? (
                <p className="muted">Belum ada soal yang dinilai.</p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Format</th><th>Jenis</th><th>Penilaian</th><th className="num">Soal</th><th className="num">Nilai rata-rata</th><th className="num">Benar / lulus</th></tr></thead>
                    <tbody>
                      {d.byFormat.map((x: any) => (
                        <tr key={x.format + x.kind}>
                          <td><span className="chip teal">{FORMAT_LABEL[x.format]}</span></td>
                          <td>{x.kind === 'new' ? 'Soal baru' : 'Remedial'}</td>
                          <td>{x.format === 'cbt' ? 'Otomatis' : 'Mandiri'}</td>
                          <td className="num">{n(x.n)}</td>
                          <td className="num">{pct(x.avg)}</td>
                          <td className="num">{n(x.correct)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="card">
              <h2>Topik yang masih lemah</h2>
              <p className="muted small">Topik dengan nilai rata-rata di bawah 60% dan minimal 3 soal dinilai (soal baru + remedial).</p>
              {d.weak.length === 0 ? (
                <p className="muted">Belum ada topik yang memenuhi kriteria.</p>
              ) : (
                <div className="stack">
                  {d.weak.map((w: any) => (
                    <div key={w.category + w.topic}>
                      <div className="row between">
                        <span><b>{w.topic || '(tanpa topik)'}</b> <span className="muted small">· {w.categoryName}</span></span>
                        <span className="num"><span className="chip bad">{pct(w.avg)}</span> <span className="muted small">{w.n} soal</span></span>
                      </div>
                      <Bar value={w.avg} max={1} thin gold label={`Nilai topik ${w.topic}`} />
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="card">
              <h2>Nilai per kategori dan topik</h2>
              {d.byTopic.length > 0 && (
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Kategori</th><th>Topik</th><th>Format</th><th className="num">Soal</th><th className="num">Nilai</th></tr></thead>
                    <tbody>
                      {d.byTopic.map((x: any, i: number) => (
                        <tr key={i}>
                          <td>{x.categoryName}</td>
                          <td>{x.topic || '–'}</td>
                          <td><span className="chip teal">{FORMAT_LABEL[x.format]}</span></td>
                          <td className="num">{n(x.n)}</td>
                          <td className="num">{pct(x.avg)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="muted small" style={{ marginTop: 10 }}>
                Belum ada nilai: {d.categories.filter((c: any) => !catHas.has(c.slug)).map((c: any) => `${c.name}${c.eligible === 0 ? ' (belum ada soal)' : ''}`).join(' · ') || '–'}
              </p>
            </section>

            <section className="card">
              <h2>Riwayat sesi</h2>
              {!sess.data || sess.data.recent.length === 0 ? (
                <p className="muted">Belum ada sesi.</p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Sesi</th><th>Status</th><th className="num">Dinilai</th><th className="num">CBT</th><th className="num">Mandiri</th><th></th></tr></thead>
                    <tbody>
                      {sess.data.recent.map((s: any) => (
                        <tr key={s.id}>
                          <td>{s.label}<br /><span className="muted small">{s.mode === 'exam' ? 'ujian' : 'latihan'} · {new Date(s.createdAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}</span></td>
                          <td>{s.status === 'active' ? <span className="chip teal">aktif</span> : <span className="chip">selesai</span>}{s.summary.awaitingGrade > 0 && <><br /><span className="chip gold">{s.summary.awaitingGrade} menunggu nilai</span></>}</td>
                          <td className="num">{s.summary.graded} / {s.summary.total}</td>
                          <td className="num">{s.summary.cbt.n ? `${s.summary.cbt.correct}/${s.summary.cbt.n}` : '–'}</td>
                          <td className="num">{s.summary.self.n ? pct(s.summary.self.avg) : '–'}</td>
                          <td><Link className="btn sm" to={`/sesi/${s.id}`}>{s.status === 'active' ? 'Lanjutkan' : 'Tinjau'}</Link></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <Backup onRestored={() => (void reload(), void sess.reload())} />
          </>
        )}
      </LoadState>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { restoreBackup, exportBackup, type RestoreReport } from '../lib/backup';
import { cycleDateFor, formatCycleDate } from '../lib/cycle';
import { listSessions, resetSession } from '../lib/sessions';
import { sessionStats } from '../lib/scoring';
import type { Session } from '../lib/types';
import { downloadBytes, navigate } from '../hooks';
import ConfirmDialog from './ConfirmDialog';

export default function HistoryPage() {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [confirm, setConfirm] = useState<Session | null>(null);
  const [msg, setMsg] = useState<string>('');
  const [err, setErr] = useState<string>('');
  const fileRef = useRef<HTMLInputElement>(null);
  const today = cycleDateFor(new Date());

  const reload = () => listSessions().then(setSessions);
  useEffect(() => {
    void reload();
  }, []);

  async function doExport() {
    setErr('');
    const bytes = await exportBackup();
    downloadBytes(bytes, `osce-harian-cadangan-${today}.zip`, 'application/zip');
    setMsg('Cadangan diekspor. Simpan file ZIP ini di tempat aman.');
  }

  async function doRestore(file: File) {
    setErr('');
    setMsg('');
    try {
      const rep: RestoreReport = await restoreBackup(new Uint8Array(await file.arrayBuffer()));
      setMsg(
        `Dipulihkan: ${rep.sessions} sesi, ${rep.stations} stasiun bank, ${rep.assets} aset.` +
          (rep.skippedSessions.length ? ` ${rep.skippedSessions.length} sesi dilewati karena versi di perangkat ini lebih baru.` : ''),
      );
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <section>
      <h1 className="page-title">Riwayat</h1>
      <p className="muted">Semua sesi tersimpan di browser perangkat ini (IndexedDB). Tidak ada sinkronisasi lintas perangkat — gunakan cadangan untuk memindahkan progres.</p>
      {sessions === null && <p className="muted">Memuat…</p>}
      {sessions?.length === 0 && <div className="card">Belum ada sesi. Mulai dari Latihan Hari Ini.</div>}
      <ul className="history">
        {sessions?.map((s) => {
          const st = sessionStats(s);
          return (
            <li key={s.id} className="card" data-testid="history-item">
              <div className="row">
                <div>
                  <strong>{formatCycleDate(s.cycleDate)}</strong> {s.kind === 'demo' && <span className="pill demo">Demo</span>}
                  {s.cycleDate === today && <span className="pill">Hari ini</span>}
                  <div className="muted small">
                    Respons {st.responsesSubmitted}/{st.responseTotal} · Direview {st.stationsReviewed}/{st.stationCount} · Nilai {st.score}/{st.maxScore}
                    {st.complete ? ' · Selesai' : ''}
                  </div>
                </div>
                <div className="actions">
                  <button className="primary" onClick={() => navigate({ page: 'latihan', sessionId: s.id })}>
                    {st.complete ? 'Buka' : 'Lanjutkan'}
                  </button>
                  <button className="danger ghost" onClick={() => setConfirm(s)}>
                    Mulai ulang
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="card">
        <h2>Cadangan progres</h2>
        <p className="muted small">Ekspor menyimpan sesi, jawaban, checklist, bank, dan aset ke satu file ZIP. Impor menggabungkan cadangan ke perangkat ini.</p>
        <div className="actions">
          <button onClick={doExport}>Ekspor cadangan</button>
          <button onClick={() => fileRef.current?.click()}>Impor cadangan</button>
          <input
            ref={fileRef}
            type="file"
            accept=".zip,application/zip"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void doRestore(f);
            }}
          />
        </div>
        {msg && <p className="ok">{msg}</p>}
        {err && <p className="error">{err}</p>}
      </div>

      {confirm && (
        <ConfirmDialog
          title="Mulai ulang sesi?"
          message={`Progres sesi ${formatCycleDate(confirm.cycleDate)}${confirm.kind === 'demo' ? ' (Demo)' : ''} akan dihapus. Urutan stasiun tetap. Sesi lain tidak terpengaruh.`}
          confirmLabel="Ya, hapus progres sesi ini"
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            const id = confirm.id;
            setConfirm(null);
            await resetSession(id);
            await reload();
          }}
        />
      )}
    </section>
  );
}

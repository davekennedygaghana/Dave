import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LoadState, Notice, Seg, useLoad } from '../components/ui';
import { StartForm } from './Dashboard';

type Source = 'wrong' | 'bookmarked' | 'unanswered' | 'all';

export function Remedial() {
  const { data: d, loading, error } = useLoad('/dashboard');
  const [source, setSource] = useState<Source>('wrong');
  const navigate = useNavigate();
  const go = (id: string) => navigate(`/sesi/${id}`);
  const active = d?.activeSessions.find((s: any) => s.kind === 'remedial');
  const r = d?.remedial;
  return (
    <div className="page stack">
      <div className="page-head">
        <div>
          <h1>Remedial</h1>
          <p>Mengulang soal yang salah, ditandai, atau pernah dibuka tanpa nilai.</p>
        </div>
      </div>
      <Notice>
        Hasil remedial dicatat terpisah. Remedial <b>tidak</b> menambah jumlah soal baru yang selesai dan tidak mengubah paket harian.
      </Notice>
      <LoadState loading={loading && !d} error={error}>
        {d &&
          (active ? (
            <div className="card">
              <h2>Sesi remedial aktif</h2>
              <p>
                {active.label} · {active.answered} dari {active.total} soal terisi
              </p>
              <button className="btn primary" onClick={() => go(active.id)}>
                Lanjutkan remedial
              </button>
            </div>
          ) : (
            <div className="card stack">
              <h2>Mulai sesi remedial</h2>
              <Seg
                name="source"
                legend="Sumber soal"
                value={source}
                onChange={setSource}
                options={[
                  { value: 'wrong', label: `Salah / belum lulus (${r.wrong})` },
                  { value: 'bookmarked', label: `Ditandai (${r.bookmarked})` },
                  { value: 'unanswered', label: `Dibuka tanpa nilai (${r.unanswered})` },
                  { value: 'all', label: `Gabungan (${r.all})` },
                ]}
              />
              {r[source] === 0 ? (
                <p className="muted">Belum ada soal pada pilihan ini.</p>
              ) : (
                <StartForm key={source} kind="remedial" sizes={d.sessionSizes} available={r[source]} extra={{ remedialSource: source }} onStarted={go} />
              )}
            </div>
          ))}
      </LoadState>
    </div>
  );
}

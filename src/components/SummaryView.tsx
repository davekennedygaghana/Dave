import { sessionSummary } from '../lib/scoring';
import { topicLabel } from '../lib/topics';
import type { Session } from '../lib/types';

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

export default function SummaryView({ session, onOpen }: { session: Session; onOpen: (index: number) => void }) {
  const sum = sessionSummary(session);
  const { stats } = sum;
  const indexOf = (id: string) => session.stations.findIndex((s) => s.id === id);
  return (
    <section className="summary" data-testid="summary">
      <div className="card">
        <h2>{stats.complete ? 'Sesi selesai' : 'Ringkasan sementara'}</h2>
        <p className="big-score" data-testid="summary-score">
          {stats.score}/{stats.maxScore} <span className="muted">({pct(stats.score, stats.maxScore)}%)</span>
        </p>
        <p className="muted small">
          Penyebut = jumlah bobot seluruh checklist di paket ini ({stats.stationCount} stasiun). Respons terkirim {stats.responsesSubmitted}/
          {stats.responseTotal}; stasiun selesai direview {stats.stationsReviewed}/{stats.stationCount}.
          {stats.stationsReviewed > 0 && ` Dari stasiun yang sudah direview: ${stats.reviewedScore}/${stats.reviewedMax} (${pct(stats.reviewedScore, stats.reviewedMax)}%).`}
        </p>
      </div>

      <div className="card">
        <h3>Skor per topik</h3>
        <table className="table">
          <thead>
            <tr>
              <th>Topik</th>
              <th>Stasiun</th>
              <th>Skor</th>
              <th>%</th>
            </tr>
          </thead>
          <tbody>
            {sum.byTopic.map((t) => (
              <tr key={t.topic}>
                <td>{topicLabel(t.topic)}</td>
                <td>{t.stations}</td>
                <td>
                  {t.score}/{t.max}
                </td>
                <td>
                  <div className="bar" aria-hidden="true">
                    <span style={{ width: `${pct(t.score, t.max)}%` }} />
                  </div>
                  {pct(t.score, t.max)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Stasiun yang perlu diulang</h3>
        {sum.toRepeat.length === 0 ? (
          <p className="muted">Tidak ada — semua stasiun direview dengan skor ≥ 60%.</p>
        ) : (
          <ul className="list">
            {sum.toRepeat.map((r) => (
              <li key={r.stationId}>
                <button className="link" onClick={() => onOpen(indexOf(r.stationId))}>
                  Stasiun {indexOf(r.stationId) + 1}: {r.title}
                </button>{' '}
                <span className="muted small">
                  — {r.reason}
                  {r.reason !== 'Belum selesai direview' && ` (${r.score}/${r.max})`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h3>Butir checklist yang terlewat</h3>
        {sum.missed.length === 0 ? (
          <p className="muted">Tidak ada butir terlewat pada stasiun yang sudah direview.</p>
        ) : (
          <ul className="list missed">
            {sum.missed.map((m, i) => (
              <li key={i}>
                <span className="muted small">
                  St. {indexOf(m.stationId) + 1} · {m.phase === 'clinical' ? 'Klinis' : 'Lanjutan'} · bobot {m.weight}
                </span>
                <br />
                {m.text}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

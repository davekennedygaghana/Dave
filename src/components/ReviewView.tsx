import { checkKey, phaseScore, sumWeights, type Phase } from '../lib/scoring';
import type { Station, StationProgress } from '../lib/types';
import { topicLabel } from '../lib/topics';

interface Props {
  station: Station;
  progress: StationProgress;
  onToggle: (phase: Phase, itemId: string, value: boolean) => void;
  onFinish: () => void;
}

function Checklist({ station, progress, phase, onToggle }: Omit<Props, 'onFinish'> & { phase: Phase }) {
  const items = station.checklist[phase];
  const score = phaseScore(station, progress, phase);
  return (
    <fieldset className="checklist" data-testid={`checklist-${phase}`}>
      <legend>
        Checklist {phase === 'clinical' ? 'jawaban klinis' : 'jawaban lanjutan'}{' '}
        <span className="score">
          {score}/{sumWeights(items)}
        </span>
      </legend>
      {items.map((item) => {
        const k = checkKey(phase, item.id);
        return (
          <label key={item.id} className="check">
            <input type="checkbox" checked={!!progress.checked[k]} onChange={(e) => onToggle(phase, item.id, e.target.checked)} />
            <span>{item.text}</span>
            <span className="weight" title="Bobot">
              bobot {item.weight}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

export default function ReviewView({ station, progress, onToggle, onFinish }: Props) {
  const src = station.source;
  return (
    <section className="review" data-testid="review">
      <h3 className="section-title">Review &amp; penilaian mandiri</h3>
      <p className="muted small">
        Bandingkan jawaban Anda dengan kunci, lalu centang butir yang benar-benar Anda sebutkan. Aplikasi tidak menilai teks Anda secara otomatis.
      </p>

      {(['clinical', 'followup'] as const).map((phase) => (
        <div className="card compare-block" key={phase}>
          <h4>{phase === 'clinical' ? 'Tahap 1 — Klinis' : 'Tahap 2 — Lanjutan'}</h4>
          <div className="compare">
            <div className="col yours">
              <h5>Jawaban Anda</h5>
              <p className="prewrap">{(phase === 'clinical' ? progress.answerClinical : progress.answerFollowup) || <em className="muted">(kosong)</em>}</p>
            </div>
            <div className="col key" data-testid={`key-${phase}`}>
              <h5>Kunci</h5>
              <p className="prewrap">{station.key[phase]}</p>
            </div>
          </div>
          <Checklist station={station} progress={progress} phase={phase} onToggle={onToggle} />
        </div>
      ))}

      {station.discussion.length > 0 && (
        <div className="card discussion">
          <h4>Pembahasan</h4>
          {station.discussion.map((d, i) => (
            <div key={i}>
              <h5>{d.heading}</h5>
              <p className="prewrap">{d.body}</p>
            </div>
          ))}
        </div>
      )}

      <div className="card source">
        <h4>Sumber kasus</h4>
        <dl>
          <dt>Topik</dt>
          <dd>{topicLabel(station.topic)}</dd>
          <dt>Dokumen</dt>
          <dd>{src.document}</dd>
          {src.scenario && (
            <>
              <dt>Skenario</dt>
              <dd>{src.scenario}</dd>
            </>
          )}
          {src.page && (
            <>
              <dt>Halaman</dt>
              <dd>{src.page}</dd>
            </>
          )}
          {src.url && (
            <>
              <dt>Tautan</dt>
              <dd>
                <a href={src.url} target="_blank" rel="noreferrer noopener">
                  Buka sumber asli
                </a>
              </dd>
            </>
          )}
        </dl>
        {src.paraphrased && <p className="muted small">Vignette diparafrasekan dari sumber.</p>}
        {src.note && <p className="muted small">{src.note}</p>}
      </div>

      <div className="actions sticky-actions">
        <button className="primary" onClick={onFinish} data-testid="finish-review">
          {progress.reviewedAt ? 'Lanjut ke stasiun berikutnya' : 'Selesai review & lanjut ke stasiun berikutnya'}
        </button>
      </div>
    </section>
  );
}

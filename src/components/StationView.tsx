import { useEffect, useRef, useState } from 'react';
import type { Phase } from '../lib/scoring';
import type { Station, StationProgress } from '../lib/types';
import ImageViewer from './ImageViewer';
import ReviewView from './ReviewView';

interface Props {
  number: number;
  total: number;
  station: Station;
  progress: StationProgress;
  demo: boolean;
  onDraft: (phase: Phase, text: string) => void;
  onSubmitClinical: () => void;
  onSubmitFollowup: () => void;
  onToggle: (phase: Phase, itemId: string, value: boolean) => void;
  onFinishReview: () => void;
}

const STAGE_LABEL = { clinical: 'Tahap 1 — Klinis', followup: 'Tahap 2 — Lanjutan', review: 'Tahap 3 — Review' } as const;

function AnswerBox({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(value);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight, 140)}px`;
  }, [text]);
  return (
    <div className="answer">
      <label htmlFor={id}>{label}</label>
      <textarea
        id={id}
        ref={ref}
        value={text}
        placeholder="Tulis jawaban Anda… (tersimpan otomatis sebagai draft)"
        onChange={(e) => {
          setText(e.target.value);
          onChange(e.target.value);
        }}
        rows={6}
        autoComplete="off"
        spellCheck={false}
      />
      <span className="muted small">Draft tersimpan otomatis. Draft belum dihitung sebagai respons sampai Anda menyimpannya.</span>
    </div>
  );
}

export default function StationView(props: Props) {
  const { station, progress, number, total } = props;
  const stage = progress.stage;
  const [confirming, setConfirming] = useState<Phase | null>(null);

  return (
    <article className="station" data-testid="station" data-stage={stage}>
      <header className="station-head">
        <div className="muted small">
          Stasiun {number} dari {total} · {STAGE_LABEL[stage]}
        </div>
        <h2 data-testid="station-title">{station.title}</h2>
        <ol className="stepper" aria-label="Tahap stasiun">
          {(['clinical', 'followup', 'review'] as const).map((s, i) => (
            <li key={s} className={stage === s ? 'current' : (['clinical', 'followup', 'review'].indexOf(stage) > i ? 'done' : '')}>
              {i + 1}. {s === 'clinical' ? 'Klinis' : s === 'followup' ? 'Lanjutan' : 'Review'}
            </li>
          ))}
        </ol>
      </header>

      <section className="card vignette">
        <h3>Vignette</h3>
        <p className="prewrap">{station.vignette}</p>
        <h3>Tugas tahap 1</h3>
        <p className="prewrap question">{station.clinicalQuestion}</p>
      </section>

      {stage === 'clinical' && (
        <section className="card">
          <AnswerBox id="ans-clinical" label="Jawaban klinis" value={progress.draftClinical} onChange={(t) => props.onDraft('clinical', t)} />
          <div className="actions sticky-actions">
            <button className="primary" onClick={() => setConfirming('clinical')} data-testid="submit-clinical">
              Simpan jawaban &amp; lanjut ke {station.assets.length ? 'imaging' : 'informasi lanjutan'}
            </button>
          </div>
        </section>
      )}

      {stage !== 'clinical' && (
        <details className="card locked" open={stage === 'followup'}>
          <summary>Jawaban klinis Anda (terkunci)</summary>
          <p className="prewrap answer-locked">{progress.answerClinical || <em className="muted">(kosong)</em>}</p>
        </details>
      )}

      {stage !== 'clinical' && (
        <section className="card followup">
          <h3>{station.assets.length ? 'Imaging' : 'Informasi lanjutan'}</h3>
          {station.assets.length > 0 && <ImageViewer assets={station.assets} revealCaptions={stage === 'review'} />}
          {station.followupInfo && <p className="prewrap info">{station.followupInfo}</p>}
          <h3>Tugas tahap 2</h3>
          <p className="prewrap question">{station.followupQuestion}</p>
          {stage === 'followup' && (
            <>
              <AnswerBox id="ans-followup" label="Jawaban lanjutan" value={progress.draftFollowup} onChange={(t) => props.onDraft('followup', t)} />
              <div className="actions sticky-actions">
                <button className="primary" onClick={() => setConfirming('followup')} data-testid="submit-followup">
                  Simpan &amp; buka pembahasan
                </button>
              </div>
            </>
          )}
        </section>
      )}

      {stage === 'review' && (
        <ReviewView station={station} progress={progress} onToggle={props.onToggle} onFinish={props.onFinishReview} />
      )}

      {confirming && (
        <div className="modal-backdrop" role="presentation" onClick={() => setConfirming(null)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="lock-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="lock-title">Kunci jawaban {confirming === 'clinical' ? 'klinis' : 'lanjutan'}?</h2>
            <p>
              Setelah disimpan, jawaban ini tidak dapat diubah.{' '}
              {confirming === 'clinical' ? 'Tahap lanjutan akan dibuka.' : 'Kunci jawaban dan checklist akan dibuka.'}
              {!(confirming === 'clinical' ? progress.draftClinical : progress.draftFollowup).trim() && <strong> Jawaban Anda masih kosong.</strong>}
            </p>
            <div className="actions">
              <button onClick={() => setConfirming(null)}>Kembali menulis</button>
              <button
                className="primary"
                data-testid="confirm-lock"
                onClick={() => {
                  const p = confirming;
                  setConfirming(null);
                  if (p === 'clinical') props.onSubmitClinical();
                  else props.onSubmitFollowup();
                }}
              >
                Ya, kunci jawaban
              </button>
            </div>
          </div>
        </div>
      )}
    </article>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { cycleDateFor, formatCycleDate } from '../lib/cycle';
import { putSession } from '../lib/db';
import { clearPending, writePending } from '../lib/pending';
import { resetSessionProgress } from '../lib/pack';
import { goTo, markReviewed, nextUnreviewed, saveDraft, submitClinical, submitFollowup, toggleCheck } from '../lib/progress';
import { sessionStats, type Phase } from '../lib/scoring';
import type { Session } from '../lib/types';
import StationView from './StationView';
import SummaryView from './SummaryView';
import ConfirmDialog from './ConfirmDialog';

interface Props {
  initial: Session;
  eligibleNow: number | null;
  nextCycleLabel: string;
}

/** Menyimpan sesi ke IndexedDB secara berurutan; draft di-debounce. */
function usePersistedSession(initial: Session) {
  const [session, setSession] = useState(initial);
  const latest = useRef(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const [saveState, setSaveState] = useState<'saved' | 'pending' | 'error'>('saved');

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const snapshot = latest.current;
    chain.current = chain.current
      .then(() => putSession(snapshot))
      .then(() => {
        if (latest.current === snapshot) {
          setSaveState('saved');
          clearPending(snapshot.id);
        }
      })
      .catch((e) => {
        console.error(e);
        setSaveState('error');
      });
    return chain.current;
  }, []);

  const update = useCallback(
    (next: Session, immediate: boolean) => {
      if (next === latest.current) return;
      latest.current = next;
      setSession(next);
      setSaveState('pending');
      writePending(next); // penyangga sinkron bila halaman ditutup sebelum IndexedDB selesai
      if (immediate) void flush();
      else {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => void flush(), 400);
      }
    },
    [flush],
  );

  useEffect(() => {
    const onHide = () => {
      if (timer.current) {
        writePending(latest.current);
        void flush();
      }
    };
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onHide);
      if (timer.current) void flush();
    };
  }, [flush]);

  return { session, update, saveState, latest };
}

export default function SessionView({ initial, eligibleNow, nextCycleLabel }: Props) {
  const { session, update, saveState, latest } = usePersistedSession(initial);
  const stats = sessionStats(session);
  const [showSummary, setShowSummary] = useState(stats.complete);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetGen, setResetGen] = useState(0);
  const topRef = useRef<HTMLDivElement>(null);

  const index = Math.min(session.currentIndex, session.stations.length - 1);
  const station = session.stations[index];
  const progress = session.progress[station.id];
  const cur = () => latest.current;

  const scrollTop = () => topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const handlers = {
    onDraft: (phase: Phase, text: string) => update(saveDraft(cur(), station.id, phase, text), false),
    onSubmitClinical: () => update(submitClinical(cur(), station.id), true),
    onSubmitFollowup: () => {
      update(submitFollowup(cur(), station.id), true);
      scrollTop();
    },
    onToggle: (phase: Phase, itemId: string, value: boolean) => update(toggleCheck(cur(), station.id, phase, itemId, value), true),
    onFinishReview: () => {
      const reviewed = markReviewed(cur(), station.id);
      const next = nextUnreviewed(reviewed, index);
      if (next === -1) {
        update(reviewed, true);
        setShowSummary(true);
      } else update(goTo(reviewed, next), true);
      scrollTop();
    },
  };

  const selectStation = (i: number) => {
    setShowSummary(false);
    update(goTo(cur(), i), true);
  };

  const isDemo = session.kind === 'demo';
  const short = session.stations.length < session.targetSize;

  return (
    <div ref={topRef}>
      <h1 className="page-title">Belajar satu stasiun, lanjut saat Anda siap.</h1>
      <div className="session-meta">
        <span>
          {isDemo ? 'Paket Demo' : 'Paket'} {formatCycleDate(session.cycleDate)}
        </span>
        <span className={`save ${saveState}`} aria-live="polite">
          {saveState === 'saved' ? 'Tersimpan di perangkat' : saveState === 'pending' ? 'Menyimpan…' : 'Gagal menyimpan'}
        </span>
      </div>
      {isDemo && <div className="demo-banner">Demo — bukan dari bank sumber</div>}
      {short && (
        <p className="muted small short-note" data-testid="short-pack">
          Paket berisi {session.stations.length} stasiun (jumlah stasiun layak saat paket dibuat; target {session.targetSize}) — tanpa duplikasi.
        </p>
      )}
      {eligibleNow !== null && eligibleNow !== session.eligibleAtCreation && (
        <p className="muted small">
          Bank kini berisi {eligibleNow} stasiun layak. Paket ini tetap memakai snapshot saat dimulai; perubahan bank berlaku pada paket berikutnya.
        </p>
      )}

      <div className="panel" role="group" aria-label="Progres sesi">
        <div className="stat" data-testid="stat-responses">
          <span className="label">Respons</span>
          <strong>
            {stats.responsesSubmitted}/{stats.responseTotal}
          </strong>
        </div>
        <div className="stat" data-testid="stat-station">
          <span className="label">Stasiun</span>
          <strong>
            {index + 1}/{stats.stationCount}
          </strong>
        </div>
        <div className="stat" data-testid="stat-reviewed">
          <span className="label">Selesai review</span>
          <strong>
            {stats.stationsReviewed}/{stats.stationCount}
          </strong>
        </div>
        <div className="stat" data-testid="stat-score">
          <span className="label">Nilai checklist</span>
          <strong>
            {stats.score}/{stats.maxScore}
          </strong>
        </div>
      </div>

      <div className="station-strip" role="tablist" aria-label="Daftar stasiun">
        {session.stations.map((s, i) => {
          const p = session.progress[s.id];
          const st = p.reviewedAt ? 'done' : p.stage === 'review' ? 'review' : p.stage === 'followup' ? 'half' : 'new';
          return (
            <button
              key={s.id}
              role="tab"
              aria-selected={!showSummary && i === index}
              className={`chip ${st} ${!showSummary && i === index ? 'current' : ''}`}
              onClick={() => selectStation(i)}
              title={`Stasiun ${i + 1}`}
            >
              {i + 1}
            </button>
          );
        })}
        <button className={`chip summary ${showSummary ? 'current' : ''}`} onClick={() => setShowSummary(true)}>
          Ringkasan
        </button>
      </div>

      {showSummary ? (
        <SummaryView session={session} onOpen={selectStation} />
      ) : (
        <StationView key={`${station.id}:${resetGen}`} number={index + 1} total={session.stations.length} station={station} progress={progress} demo={isDemo} {...handlers} />
      )}

      <footer className="session-footer">
        <p className="muted small">{nextCycleLabel}. Sesi yang belum selesai tetap tersimpan di Riwayat.</p>
        <button className="danger ghost" onClick={() => setConfirmReset(true)}>
          {session.cycleDate === cycleDateFor(new Date()) ? 'Mulai ulang sesi hari ini' : 'Mulai ulang sesi ini'}
        </button>
      </footer>

      {confirmReset && (
        <ConfirmDialog
          title="Mulai ulang sesi?"
          message={`Semua jawaban, draft, dan centang checklist untuk sesi ${formatCycleDate(session.cycleDate)}${isDemo ? ' (Demo)' : ''} akan dihapus. Urutan stasiun tetap sama. Sesi lain tidak terpengaruh.`}
          confirmLabel="Ya, hapus progres sesi ini"
          onCancel={() => setConfirmReset(false)}
          onConfirm={() => {
            setConfirmReset(false);
            setShowSummary(false);
            update(resetSessionProgress(cur()), true);
            setResetGen((g) => g + 1);
          }}
        />
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { cycleDateFor, formatCycleDate, formatWita, nextCycleStart } from '../lib/cycle';
import { getSession } from '../lib/db';
import { recoverPending } from '../lib/pending';
import { ensureSession, listSessions } from '../lib/sessions';
import { sessionStats } from '../lib/scoring';
import type { Session } from '../lib/types';
import { navigate, useNow } from '../hooks';
import SessionView from './SessionView';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'empty'; cycleDate: string }
  | { status: 'ready'; session: Session; eligibleNow: number | null; unfinished: Session[] };

export default function PracticePage({ sessionId }: { sessionId?: string }) {
  const now = useNow();
  const cycleDate = cycleDateFor(now);
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const all = await listSessions();
        let session: Session | null | undefined;
        let eligibleNow: number | null = null;
        if (sessionId) {
          session = await getSession(sessionId);
          if (!session) throw new Error(`Sesi "${sessionId}" tidak ditemukan di perangkat ini.`);
        } else {
          const t = await ensureSession('source', new Date());
          session = t.session;
          eligibleNow = t.eligibleNow;
          if (!session) {
            if (!cancelled) setState({ status: 'empty', cycleDate: t.cycleDate });
            return;
          }
        }
        session = await recoverPending(session);
        const unfinished = all.filter((s) => s.id !== session!.id && s.kind === 'source' && !sessionStats(s).complete);
        if (!cancelled) setState({ status: 'ready', session, eligibleNow, unfinished });
      } catch (e) {
        if (!cancelled) setState({ status: 'error', message: (e as Error).message });
      }
    })();
    return () => {
      cancelled = true;
    };
    // cycleDate: saat 09.00 WITA terlewati ketika aplikasi terbuka, paket baru dimuat.
  }, [sessionId, cycleDate]);

  async function startDemo() {
    const t = await ensureSession('demo', new Date());
    if (t.session) navigate({ page: 'latihan', sessionId: t.session.id });
  }

  if (state.status === 'loading') return <p className="muted">Memuat paket…</p>;
  if (state.status === 'error')
    return (
      <div className="card">
        <p className="error">{state.message}</p>
        <button onClick={() => navigate({ page: 'latihan' })}>Kembali ke latihan hari ini</button>
      </div>
    );
  if (state.status === 'empty')
    return (
      <section>
        <h1 className="page-title">Belajar satu stasiun, lanjut saat Anda siap.</h1>
        <div className="card">
          <h2>Paket {formatCycleDate(state.cycleDate)}</h2>
          <p>
            Bank sumber di perangkat ini belum berisi stasiun yang layak. Paket harian hanya disusun dari bank kasus yang Anda impor — aplikasi
            tidak mengarang kasus untuk memenuhi target.
          </p>
          <div className="actions">
            <button className="primary" onClick={() => navigate({ page: 'bank' })}>
              Impor bank kasus
            </button>
            <button onClick={startDemo}>Coba Paket Demo</button>
          </div>
          <p className="muted small">Paket Demo berisi kasus sintetis berlabel “Demo — bukan dari bank sumber”.</p>
        </div>
      </section>
    );

  const { session, unfinished, eligibleNow } = state;
  const isOld = session.cycleDate !== cycleDate;
  return (
    <section>
      {isOld && (
        <div className="notice">
          Anda membuka sesi {formatCycleDate(session.cycleDate)}.{' '}
          <button className="link" onClick={() => navigate({ page: 'latihan' })}>
            Buka paket hari ini
          </button>
        </div>
      )}
      {!isOld && unfinished.length > 0 && (
        <div className="notice">
          Ada {unfinished.length} sesi sebelumnya yang belum selesai.{' '}
          <button className="link" onClick={() => navigate({ page: 'latihan', sessionId: unfinished[0].id })}>
            Lanjutkan {formatCycleDate(unfinished[0].cycleDate)}
          </button>
        </div>
      )}
      <SessionView
        key={session.id + session.createdAt}
        initial={session}
        eligibleNow={eligibleNow}
        nextCycleLabel={`Paket berikutnya: ${formatCycleDate(cycleDateFor(nextCycleStart(now)))} pukul ${formatWita(nextCycleStart(now))}`}
      />
    </section>
  );
}

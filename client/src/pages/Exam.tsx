import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, fmtClock, get, pct, post, put } from '../api';
import { Bar, Icon, Loading, Modal, Notice, isTextEntry } from '../components/ui';
import { QuestionView, type ItemData } from '../components/QuestionView';

interface SessItem {
  position: number;
  questionId: string;
  format: string;
  state: 'unopened' | 'opened' | 'answered' | 'submitted' | 'graded';
  bookmarked: boolean;
  correct: boolean | null;
}
interface Sess {
  id: string;
  kind: 'new' | 'remedial';
  mode: 'practice' | 'exam';
  status: 'active' | 'finished';
  label: string;
  currentIndex: number;
  elapsedSeconds: number;
  timeLimitSeconds: number | null;
  items: SessItem[];
  summary: null | { total: number; graded: number; cbt: { n: number; correct: number }; self: { n: number; avg: number | null }; awaitingGrade: number; unanswered: number };
}

const stateOf = (it: ItemData & { attempt: any }): SessItem['state'] => {
  const a = it.attempt;
  if (!a) return 'opened';
  if (a.graded) return 'graded';
  if (a.submitted) return 'submitted';
  return a.response.choice || a.response.text?.trim() ? 'answered' : 'opened';
};

export function Exam() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [sess, setSess] = useState<Sess | null>(null);
  const [pos, setPos] = useState(1);
  const [loadedItem, setItem] = useState<(ItemData & { position: number; bookmarked: boolean }) | null>(null);
  const [error, setError] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [showNav, setShowNav] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const elapsedRef = useRef(0);
  const posRef = useRef(1);
  elapsedRef.current = elapsed;
  posRef.current = pos;
  const active = sess?.status === 'active';
  // Jangan pernah menampilkan soal lama pada nomor baru selagi soal berikutnya dimuat
  const item = loadedItem && loadedItem.position === pos ? loadedItem : null;

  const loadSession = useCallback(async () => {
    try {
      const s = await get<Sess>(`/sessions/${id}`);
      setSess(s);
      setElapsed(s.elapsedSeconds);
      return s;
    } catch (e) {
      setError((e as ApiError).message);
      return null;
    }
  }, [id]);

  useEffect(() => {
    void loadSession().then((s) => s && setPos(Math.min(s.items.length, Math.max(1, s.currentIndex + 1))));
  }, [loadSession]);

  const patchItem = (position: number, patch: Partial<SessItem>) =>
    setSess((s) => (s ? { ...s, items: s.items.map((i) => (i.position === position ? { ...i, ...patch } : i)) } : s));

  // Memuat soal saat berpindah posisi (pembukaan tercatat di server)
  useEffect(() => {
    if (!sess) return;
    let cancelled = false;
    setItem(null);
    get(`/sessions/${id}/items/${pos}`)
      .then((it) => {
        if (cancelled) return;
        setItem(it);
        patchItem(pos, { state: stateOf(it), bookmarked: it.bookmarked });
        window.scrollTo({ top: 0 });
      })
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, pos, sess?.id, sess?.status]);

  // Timer sesi: hanya berjalan saat tab terlihat; disimpan berkala ke server
  useEffect(() => {
    if (!active) return;
    const tick = setInterval(() => document.visibilityState === 'visible' && setElapsed((e) => e + 1), 1000);
    const beat = () =>
      fetch(`/api/sessions/${id}/heartbeat`, {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'orthoboard' },
        body: JSON.stringify({ elapsed: elapsedRef.current, currentIndex: posRef.current - 1 }),
      }).catch(() => {});
    const hb = setInterval(beat, 15000);
    const onHide = () => document.visibilityState === 'hidden' && beat();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', beat);
    return () => {
      clearInterval(tick);
      clearInterval(hb);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', beat);
      void beat();
    };
  }, [active, id]);

  const finish = useCallback(async () => {
    setFinishing(true);
    try {
      await post(`/sessions/${id}/finish`, { elapsed: elapsedRef.current });
      setConfirmFinish(false);
      await loadSession();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setFinishing(false);
    }
  }, [id, loadSession]);

  const remaining = sess?.timeLimitSeconds ? sess.timeLimitSeconds - elapsed : null;
  useEffect(() => {
    if (active && remaining !== null && remaining <= 0 && !finishing) void finish();
  }, [active, remaining, finishing, finish]);

  const go = useCallback((p: number) => sess && p >= 1 && p <= sess.items.length && setPos(p), [sess]);
  const toggleBookmark = useCallback(async () => {
    if (!item) return;
    const on = !item.bookmarked;
    setItem({ ...item, bookmarked: on });
    patchItem(item.position, { bookmarked: on });
    await put(`/bookmarks/${encodeURIComponent(item.question.id)}`, { on }).catch((e) => setError(e.message));
  }, [item]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTextEntry(e) || confirmFinish || showNav) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault(); // cegah panah mengubah pilihan radio yang sedang fokus
        go(posRef.current + (e.key === 'ArrowRight' ? 1 : -1));
      } else if (e.key.toLowerCase() === 't') void toggleBookmark();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [go, toggleBookmark, confirmFinish, showNav]);

  if (error && !sess) return <div className="page"><Notice kind="err">{error}</Notice><p><Link to="/">Kembali ke dashboard</Link></p></div>;
  if (!sess) return <Loading />;

  const total = sess.items.length;
  const doneCount = sess.items.filter((i) => i.state === 'graded').length;
  const answeredCount = sess.items.filter((i) => i.state !== 'unopened' && i.state !== 'opened').length;
  const unanswered = total - answeredCount;
  const sum = sess.summary;

  const apply = (it: any) => {
    setItem(it);
    patchItem(it.position, { state: stateOf(it), correct: it.reveal && it.attempt?.graded ? it.attempt.isCorrect : null });
  };
  const onSave = async (response: object) => {
    const p = pos;
    await put(`/sessions/${id}/items/${p}/response`, { response, elapsed: elapsedRef.current });
    const has = !!((response as any).choice || (response as any).text?.trim());
    patchItem(p, { state: has ? 'answered' : 'opened' });
  };
  const onSubmit = async (response: object) => apply(await post(`/sessions/${id}/items/${pos}/submit`, { response, elapsed: elapsedRef.current }));
  const onGrade = async (checked: number[]) => {
    apply(await post(`/sessions/${id}/items/${pos}/grade`, { checked }));
    if (!active) void get<Sess>(`/sessions/${id}`).then((s) => setSess((old) => (old ? { ...old, summary: s.summary } : old)));
  };

  return (
    <div>
      <div className="exam-head">
        <div className="inner">
          <Link to="/" className="btn sm on-dark" aria-label="Kembali ke dashboard (sesi tersimpan)">
            ‹ Keluar
          </Link>
          <div className="title">
            {sess.label} · {sess.mode === 'exam' ? 'Mode ujian' : 'Mode latihan'}
            {!active && ' · Tinjauan'}
          </div>
          <div className={`timer ${remaining !== null && remaining < 60 && active ? 'low' : ''}`} role="timer" aria-label={remaining !== null ? 'Sisa waktu' : 'Waktu berjalan'}>
            {remaining !== null && active ? `Sisa ${fmtClock(remaining)}` : fmtClock(elapsed)}
          </div>
          <button className="btn sm on-dark" onClick={() => setShowNav(true)} aria-label="Buka daftar nomor soal">
            {pos} / {total}
          </button>
          {active && (
            <button className="btn sm gold" onClick={() => setConfirmFinish(true)}>
              Selesai
            </button>
          )}
          <Bar value={sess.mode === 'exam' && active ? answeredCount : doneCount} max={total} gold label="Progres sesi" />
        </div>
      </div>

      <div className="exam-body stack">
        {error && <Notice kind="err">{error}</Notice>}
        {sum && (
          <div className="card">
            <h2>Hasil sesi</h2>
            <div className="grid cols-4">
              <div><div className="muted small">Dinilai</div><b className="num">{sum.graded} / {sum.total}</b></div>
              <div><div className="muted small">CBT (nilai otomatis)</div><b className="num">{sum.cbt.n ? `${sum.cbt.correct} / ${sum.cbt.n} (${pct(sum.cbt.correct / sum.cbt.n)})` : '–'}</b></div>
              <div><div className="muted small">VIVA/OSCE/esai (nilai mandiri)</div><b className="num">{sum.self.n ? `${pct(sum.self.avg)} dari ${sum.self.n} soal` : '–'}</b></div>
              <div><div className="muted small">Tidak dijawab</div><b className="num">{sum.unanswered}</b></div>
            </div>
            {sum.awaitingGrade > 0 && <p style={{ marginTop: 12 }}><span className="chip gold">{sum.awaitingGrade} jawaban tertulis menunggu nilai mandiri</span> — buka soalnya di bawah lalu simpan nilai agar dihitung selesai.</p>}
            {sess.kind === 'remedial' && <p className="muted small" style={{ marginTop: 8 }}>Sesi remedial tidak menambah jumlah soal baru yang selesai.</p>}
            {sum.unanswered > 0 && sess.kind === 'new' && <p className="muted small" style={{ marginTop: 8 }}>Soal yang tidak dijawab tidak dihitung selesai. Yang belum dikunci akan muncul lagi di sesi berikutnya pada tanggal paket yang sama.</p>}
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn primary" onClick={() => navigate('/')}>Kembali ke dashboard</button>
            </div>
          </div>
        )}

        <div className="card q-card">
          <div className="row between" style={{ marginBottom: 10 }}>
            <b className="num">Soal {pos} dari {total}</b>
            <button className={`btn sm ${item?.bookmarked ? 'gold' : ''}`} onClick={toggleBookmark} aria-pressed={!!item?.bookmarked} disabled={!item}>
              <span style={{ width: 16, height: 16, display: 'inline-flex' }}><Icon name="flag" /></span>
              {item?.bookmarked ? 'Ditandai' : 'Tandai'}
            </button>
          </div>
          {!item ? (
            <Loading />
          ) : (
            <QuestionView
              key={`${pos}-${sess.status}`}
              item={item}
              mode={active ? sess.mode : 'readonly'}
              onSave={active ? onSave : undefined}
              onSubmit={active ? onSubmit : undefined}
              onGrade={onGrade}
            />
          )}
        </div>

        <div className="exam-nav">
          <button className="btn" disabled={pos <= 1} onClick={() => go(pos - 1)}>‹ Sebelumnya</button>
          {pos < total ? (
            <button className="btn navy" onClick={() => go(pos + 1)}>Berikutnya ›</button>
          ) : active ? (
            <button className="btn gold" onClick={() => setConfirmFinish(true)}>Selesaikan sesi</button>
          ) : (
            <button className="btn navy" onClick={() => navigate('/')}>Dashboard</button>
          )}
        </div>
        <p className="muted small" style={{ textAlign: 'center' }}>
          Pintasan: <span className="kbd">←</span> <span className="kbd">→</span> pindah soal · <span className="kbd">T</span> tandai · jawaban tersimpan otomatis
        </p>
      </div>

      {showNav && (
        <Modal title="Daftar soal" onClose={() => setShowNav(false)}>
          <div className="navigator">
            {sess.items.map((i) => (
              <button
                key={i.position}
                className={`${i.state} ${i.correct === true ? 'is-correct' : i.correct === false ? 'is-wrong' : ''} ${i.position === pos ? 'current' : ''} ${i.bookmarked ? 'bm' : ''}`}
                aria-label={`Soal ${i.position}, ${i.state}${i.bookmarked ? ', ditandai' : ''}`}
                aria-current={i.position === pos}
                onClick={() => (go(i.position), setShowNav(false))}
              >
                {i.position}
              </button>
            ))}
          </div>
          <div className="legend">
            <span><i style={{ background: '#fff' }} />Belum dibuka/dijawab</span>
            <span><i style={{ background: 'var(--turq-soft)', borderColor: 'var(--turq)' }} />Terisi</span>
            <span><i style={{ background: 'var(--navy)' }} />Dinilai</span>
            <span><i style={{ background: 'var(--ok)' }} />Benar/lulus</span>
            <span><i style={{ background: 'var(--bad)' }} />Salah</span>
            <span><i style={{ background: 'var(--gold)', borderRadius: '50%' }} />Ditandai</span>
          </div>
        </Modal>
      )}

      {confirmFinish && (
        <Modal title="Selesaikan sesi?" onClose={() => setConfirmFinish(false)}>
          <p>
            {sess.mode === 'exam'
              ? 'Jawaban CBT akan dinilai otomatis dan pembahasan dibuka. Jawaban tertulis dikunci untuk Anda nilai sendiri.'
              : 'Sesi ditutup. Soal yang sudah dinilai tetap tersimpan.'}
          </p>
          {unanswered > 0 && (
            <Notice kind="warn">
              {unanswered} soal belum dijawab — tidak akan dinilai dan tidak dihitung selesai.
            </Notice>
          )}
          <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => setConfirmFinish(false)}>Lanjut mengerjakan</button>
            <button className="btn gold" disabled={finishing} onClick={finish}>{finishing ? 'Menyelesaikan…' : 'Ya, selesaikan'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, fmtDate, pct, post } from '../api';
import { Bar, LoadState, Notice, Seg, Stat, useLoad } from '../components/ui';

export function StartForm({ kind, sizes, available, extra, onStarted }: { kind: 'new' | 'remedial'; sizes: number[]; available: number; extra?: Record<string, unknown>; onStarted: (id: string) => void }) {
  const [mode, setMode] = useState<'practice' | 'exam'>('practice');
  const [size, setSize] = useState(sizes.includes(50) ? 50 : sizes[0]);
  const [limit, setLimit] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const start = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await post('/sessions', { kind, mode, size, timeLimitMinutes: mode === 'exam' && limit ? Number(limit) : null, ...extra });
      onStarted(r.id);
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 409 && err.data.sessionId) onStarted(err.data.sessionId);
      else setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const actual = Math.min(size, available);
  return (
    <div className="stack">
      <Seg name={`mode-${kind}`} legend="Mode" value={mode} onChange={setMode} options={[{ value: 'practice', label: 'Latihan — pembahasan tiap soal' }, { value: 'exam', label: 'Ujian — pembahasan di akhir' }]} />
      <Seg name={`size-${kind}`} legend="Jumlah soal sesi" value={size} onChange={setSize} options={sizes.map((s) => ({ value: s, label: s.toLocaleString('id-ID') }))} />
      {mode === 'exam' && (
        <label className="field" style={{ maxWidth: 260 }}>
          <span>Batas waktu (menit, opsional)</span>
          <input type="number" min={1} max={1440} inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="tanpa batas" />
        </label>
      )}
      {available > 0 && size > available && (
        <p className="muted small">Hanya {available.toLocaleString('id-ID')} soal tersedia — sesi akan berisi {actual.toLocaleString('id-ID')} soal, tanpa pengulangan.</p>
      )}
      {error && <Notice kind="err">{error}</Notice>}
      <div>
        <button className="btn primary" disabled={busy || available === 0} onClick={start}>
          {busy ? 'Menyiapkan…' : `Mulai ${actual > 0 ? actual.toLocaleString('id-ID') + ' soal' : 'sesi'}`}
        </button>
      </div>
    </div>
  );
}

export function Dashboard() {
  const { data: d, loading, error } = useLoad('/dashboard');
  const navigate = useNavigate();
  return (
    <div className="page">
      <LoadState loading={loading && !d} error={error}>
        {d && <Content d={d} go={(id) => navigate(`/sesi/${id}`)} />}
      </LoadState>
    </div>
  );
}

function Content({ d, go }: { d: any; go: (id: string) => void }) {
  const p = d.package;
  const n = (x: number) => x.toLocaleString('id-ID');
  const activeNew = d.activeSessions.find((s: any) => s.kind === 'new');
  const activeRem = d.activeSessions.find((s: any) => s.kind === 'remedial');
  const cbt = d.today.new.cbt;
  const self = d.today.new.self;
  const finishedAll = p.size > 0 && p.remaining === 0;
  const availableNow = p.remaining - p.awaitingGrade;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p>
            {fmtDate(d.date)} · pergantian paket pukul 00.00 WITA ({d.timezone})
          </p>
        </div>
      </div>

      {d.demoMode && (
        <Notice kind="demo">
          <b>MODE DEMO AKTIF.</b> Paket memuat soal berlabel DEMO yang berisi teks pengisi — bukan soal terverifikasi dan bukan materi medis. Matikan di Panel admin → Pengaturan.
        </Notice>
      )}

      <section className="card" aria-label="Target harian">
        <div className="row between">
          <h2 style={{ margin: 0 }}>Target hari ini: {n(d.target)} soal</h2>
          <span className="chip teal num">{pct(p.done / d.target)} dari target</span>
        </div>
        <div className="row" style={{ alignItems: 'baseline', margin: '10px 0 8px' }}>
          <span className="num" data-testid="done-count" style={{ fontSize: '2.4rem', fontWeight: 800, color: 'var(--navy)', lineHeight: 1 }}>{n(p.done)}</span>
          <span className="muted">/ {n(d.target)} soal dijawab &amp; dinilai</span>
        </div>
        <Bar value={p.done} max={d.target} label="Progres target harian" />
        <p className="muted small" style={{ marginTop: 8 }}>
          Paket hari ini berisi <b>{n(p.size)}</b> soal unik · {n(p.opened)} sudah dibuka · {n(p.remaining)} belum dinilai
          {p.awaitingGrade > 0 && <> · {n(p.awaitingGrade)} menunggu nilai mandiri</>}
        </p>
        {p.shortfall > 0 && (
          <Notice kind="warn">
            <b>Bank belum mencukupi target.</b> Paket hari ini hanya {n(p.size)} soal — kurang <b>{n(p.shortfall)}</b> dari {n(d.target)}. Soal tidak digandakan untuk menutup kekurangan. Tambahkan soal tervalidasi lewat Panel admin; soal yang disetujui hari ini otomatis ditambahkan ke akhir paket.
          </Notice>
        )}
        {p.size === 0 && (
          <Notice kind="err">
            <b>Tidak ada soal baru yang memenuhi syarat.</b> {d.bank.eligible === 0 ? 'Bank belum memiliki soal berstatus disetujui.' : 'Semua soal yang disetujui sudah pernah dibuka.'}
          </Notice>
        )}
        {finishedAll && <Notice kind="ok"><b>Paket hari ini selesai.</b> {p.shortfall > 0 ? 'Bank soal baru habis untuk hari ini.' : 'Target tercapai.'}</Notice>}
      </section>

      <div className="grid cols-4">
        <Stat label="Bank soal disetujui" value={n(d.bank.approved)} sub={<>{n(d.bank.needsReview)} perlu ditinjau · {n(d.bank.draft)} draft{d.bank.demo > 0 && <> · {n(d.bank.demo)} DEMO</>}</>} />
        <Stat label="Soal baru tersisa" value={n(d.bank.unseenTotal)} sub="belum pernah dibuka (termasuk paket hari ini)" />
        <Stat label="CBT hari ini" value={cbt.n ? pct(cbt.correct / cbt.n) : '–'} sub={<>{n(cbt.correct)} benar dari {n(cbt.n)} · nilai otomatis</>} />
        <Stat label="VIVA/OSCE/esai hari ini" value={self.n ? pct(self.avg) : '–'} sub={<>{n(self.n)} soal · nilai mandiri</>} />
      </div>

      <section className="card" aria-label="Sesi soal baru">
        {activeNew ? (
          <>
            <h2>Sesi aktif</h2>
            <p>
              <b>{activeNew.label}</b> · {activeNew.mode === 'exam' ? 'mode ujian' : 'mode latihan'} · {n(activeNew.answered)} dari {n(activeNew.total)} soal terisi
              {activeNew.packageDate !== d.date && <> · <span className="chip gold">paket {fmtDate(activeNew.packageDate)}</span></>}
            </p>
            <Bar value={activeNew.answered} max={activeNew.total} thin label="Progres sesi aktif" />
            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn primary" onClick={() => go(activeNew.id)}>Lanjutkan sesi</button>
              <span className="muted small">Selesaikan sesi ini untuk memulai sesi berikutnya dari paket yang sama.</span>
            </div>
          </>
        ) : (
          <>
            <h2>Mulai sesi soal baru</h2>
            {availableNow > 0 ? (
              <StartForm kind="new" sizes={d.sessionSizes} available={availableNow} onStarted={go} />
            ) : (
              <p className="muted">Tidak ada soal baru yang bisa dikerjakan saat ini.{p.awaitingGrade > 0 && ' Ada jawaban tertulis yang menunggu nilai mandiri — lihat Progres → Riwayat sesi.'}</p>
            )}
          </>
        )}
      </section>

      <section className="card" aria-label="Remedial">
        <div className="row between">
          <div>
            <h2 style={{ marginBottom: 4 }}>Remedial</h2>
            <p className="muted small" style={{ margin: 0 }}>
              {n(d.remedial.wrong)} salah · {n(d.remedial.bookmarked)} ditandai · {n(d.remedial.unanswered)} dibuka tanpa nilai — terpisah dari hitungan soal baru
            </p>
          </div>
          {activeRem ? <button className="btn" onClick={() => go(activeRem.id)}>Lanjutkan remedial</button> : <Link className="btn" to="/remedial">Buka remedial</Link>}
        </div>
      </section>

      <section className="card" aria-label="Cakupan materi">
        <h2>Cakupan materi di bank</h2>
        <p className="muted small">Jumlah soal yang memenuhi syarat paket per kategori. Kategori tanpa soal ditandai apa adanya.</p>
        <div className="grid cols-3">
          {d.categories.map((c: any) => (
            <div key={c.slug} className="row between" style={{ borderBottom: '1px solid var(--line)', padding: '6px 0' }}>
              <span>{c.name}</span>
              {c.eligible > 0 ? <span className="chip teal num">{n(c.eligible)} soal</span> : <span className="chip">belum ada soal</span>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { FORMAT_LABEL, fmtClock, pct } from '../api';
import { DemoChip, Notice, isTextEntry } from './ui';

export interface ItemData {
  question: { id: string; format: string; categoryName: string; topic: string; subtopic: string; bodyRegion: string; difficulty: string; demo: boolean; content: any };
  attempt: null | { response: { choice?: string; text?: string }; submitted: boolean; graded: boolean; autoGraded: boolean; isCorrect: boolean | null; score: number | null; grade: any };
  reveal: null | { content: any; reference: any };
  openedAt?: string | null;
  serverNow?: string;
}

interface Props {
  item: ItemData;
  /** practice: periksa per soal; exam: simpan saja; readonly: tinjauan tanpa perubahan jawaban */
  mode: 'practice' | 'exam' | 'readonly';
  onSave?: (response: object) => Promise<void>;
  onSubmit?: (response: object) => Promise<void>;
  onGrade?: (checked: number[]) => Promise<void>;
}


export function QuestionMeta({ q }: { q: ItemData['question'] }) {
  return (
    <div className="q-meta">
      <span className="chip teal">{FORMAT_LABEL[q.format]}</span>
      {q.demo && <DemoChip />}
      <span className="chip">{q.categoryName}</span>
      {q.topic && <span className="chip">{q.topic}</span>}
      {q.bodyRegion && <span className="chip">{q.bodyRegion}</span>}
      <span className="chip gold">{q.difficulty}</span>
      <span className="q-id" style={{ marginLeft: 'auto', alignSelf: 'center' }}>
        {q.id}
      </span>
    </div>
  );
}

export function ReferenceBox({ r }: { r: any }) {
  const pages = r.pdfPageStart ? (r.pdfPageEnd && r.pdfPageEnd !== r.pdfPageStart ? `${r.pdfPageStart}–${r.pdfPageEnd}` : `${r.pdfPageStart}`) : null;
  return (
    <div className="ref-box">
      <b>Rujukan:</b> {r.bookTitle || <i>nama buku belum diisi</i>}
      {r.edition && <>, edisi {r.edition}</>}
      {r.chapter && <>, bab: {r.chapter}</>}
      <br />
      Halaman PDF: {pages ?? <i>tidak tersedia</i>}
      {' · '}
      Halaman cetak: {r.printPage ? <>{r.printPage} {r.printPageVerified ? <span className="chip ok">terverifikasi</span> : <span className="chip gold">belum diverifikasi</span>}</> : <i>tidak dapat diverifikasi</i>}
      {r.fileUrl && (
        <>
          {' · '}
          <a href={r.fileUrl} target="_blank" rel="noreferrer">
            Buka PDF di halaman ini
          </a>
        </>
      )}
    </div>
  );
}

function StationTimer({ openedAt, serverNow, seconds, stopped }: { openedAt?: string | null; serverNow?: string; seconds: number; stopped: boolean }) {
  // Sisa waktu dihitung dari waktu soal pertama dibuka (tersimpan di server) sehingga bertahan saat muat ulang
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    if (!openedAt || !serverNow) return;
    const skew = Date.now() - new Date(serverNow).getTime();
    const tick = () => setLeft(seconds - (Date.now() - skew - new Date(openedAt).getTime()) / 1000);
    tick();
    if (stopped) return;
    const t = setInterval(tick, 500);
    return () => clearInterval(t);
  }, [openedAt, serverNow, seconds, stopped]);
  if (stopped) return <span className="chip">Waktu stasiun: {fmtClock(seconds)}</span>;
  return (
    <span className={`station-timer ${left <= 0 ? 'over' : ''}`} role="timer" aria-live="off">
      {left > 0 ? `Sisa waktu stasiun ${fmtClock(left)}` : `Waktu habis (+${fmtClock(-left)})`}
    </span>
  );
}

function SelfGrade({ item, onGrade, readonly }: { item: ItemData; onGrade?: (c: number[]) => Promise<void>; readonly: boolean }) {
  const isOsce = item.question.format === 'osce';
  const rows: { text: string; weight: number; critical?: boolean }[] = isOsce
    ? item.reveal!.content.checklist.map((c: any) => ({ text: c.item, weight: c.weight, critical: c.critical }))
    : item.reveal!.content.rubric.map((c: any) => ({ text: c.point, weight: c.weight }));
  const saved: number[] | null = item.attempt?.grade?.checked ?? null;
  const [checked, setChecked] = useState<number[]>(saved ?? []);
  const [busy, setBusy] = useState(false);
  const total = rows.reduce((a, b) => a + b.weight, 0);
  const got = checked.reduce((a, i) => a + rows[i].weight, 0);
  const missedCritical = rows.some((r, i) => r.critical && !checked.includes(i));
  const dirty = !saved || saved.join() !== [...checked].sort((a, b) => a - b).join();
  const toggle = (i: number) => setChecked((c) => (c.includes(i) ? c.filter((x) => x !== i) : [...c, i]));
  return (
    <div>
      <h3>{isOsce ? 'Checklist penilaian' : 'Rubrik penilaian'} <span className="chip gold">nilai mandiri</span></h3>
      {readonly && !item.attempt?.graded && <p className="muted small">Soal ini tidak dijawab sehingga tidak dinilai dan tidak dihitung selesai.</p>}
      <ul className="rubric">
        {rows.map((r, i) => (
          <li key={i}>
            <label className={r.critical ? 'critical' : ''}>
              <input type="checkbox" checked={checked.includes(i)} disabled={readonly} onChange={() => toggle(i)} />
              <span>
                {r.text}
                {r.critical && <> <span className="chip gold">critical step</span></>}
              </span>
              <span className="w">bobot {r.weight}</span>
            </label>
          </li>
        ))}
      </ul>
      {!readonly && (
        <div className="row between" style={{ marginTop: 12 }}>
          <div className="num">
            Nilai mandiri: <b>{got} / {total}</b> ({pct(total ? got / total : 0)})
            {isOsce && missedCritical && <> <span className="chip bad">critical step terlewat</span></>}
          </div>
          <button
            className="btn primary"
            disabled={busy || !dirty}
            onClick={async () => {
              setBusy(true);
              try {
                await onGrade?.(checked);
              } finally {
                setBusy(false);
              }
            }}
          >
            {saved ? (dirty ? 'Perbarui nilai' : 'Nilai tersimpan') : 'Simpan nilai'}
          </button>
        </div>
      )}
      {!readonly && !saved && <p className="muted small" style={{ marginTop: 6 }}>Soal baru dihitung selesai setelah nilai disimpan.</p>}
    </div>
  );
}

export function QuestionView({ item, mode, onSave, onSubmit, onGrade }: Props) {
  const q = item.question;
  const c = q.content;
  const a = item.attempt;
  const locked = mode === 'readonly' || !!a?.submitted;
  const [choice, setChoice] = useState(a?.response.choice ?? '');
  const [text, setText] = useState(a?.response.text ?? '');
  const [saveState, setSaveState] = useState<'' | 'saving' | 'saved' | 'error'>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dirty = useRef(false);
  const latest = useRef({ text, onSave });
  latest.current = { text, onSave };

  const doSave = async (response: object) => {
    if (!onSave) return;
    setSaveState('saving');
    try {
      await onSave(response);
      dirty.current = false;
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  };

  // Simpan otomatis jawaban tertulis (jeda 800 ms) dan saat berpindah soal
  useEffect(() => {
    if (q.format === 'cbt' || locked || !dirty.current) return;
    const t = setTimeout(() => void doSave({ text }), 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  useEffect(
    () => () => {
      if (dirty.current) void latest.current.onSave?.({ text: latest.current.text }).catch(() => {});
    },
    [],
  );

  const pick = (k: string) => {
    if (locked) return;
    setChoice(k);
    if (mode === 'exam' || mode === 'practice') void doSave({ choice: k });
  };
  const submit = async () => {
    if (!onSubmit || busy) return;
    setBusy(true);
    setError('');
    try {
      dirty.current = false;
      await onSubmit(q.format === 'cbt' ? { choice } : { text });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  // Pintasan keyboard CBT: A–E atau 1–5 memilih, Enter memeriksa
  useEffect(() => {
    if (q.format !== 'cbt' || locked) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTextEntry(e)) return;
      const keys: string[] = c.options.map((o: any) => o.key);
      const k = e.key.toUpperCase();
      const byNum = /^[1-9]$/.test(e.key) ? keys[Number(e.key) - 1] : undefined;
      if (keys.includes(k)) pick(k);
      else if (byNum) pick(byNum);
      else if (e.key === 'Enter' && mode === 'practice' && choice && (e.target as HTMLElement).tagName !== 'BUTTON') void submit();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const rv = item.reveal;
  const answer = rv?.content.answer;

  return (
    <div>
      <QuestionMeta q={q} />

      {q.format === 'cbt' && (
        <>
          <div className="q-stem">{c.stem}</div>
          <fieldset className="options">
            <legend className="sr-only">Pilih satu jawaban terbaik</legend>
            {c.options.map((o: any) => {
              const full = rv?.content.options.find((x: any) => x.key === o.key);
              const cls = rv ? (o.key === answer ? 'correct' : o.key === choice ? 'wrong' : '') : o.key === choice ? 'selected' : '';
              return (
                <label key={o.key} className={`option ${cls} ${locked ? 'locked' : ''}`}>
                  <input type="radio" name={`opt-${q.id}`} checked={choice === o.key} disabled={locked} onChange={() => pick(o.key)} />
                  <span className="key" aria-hidden="true">{o.key}</span>
                  <span>
                    <span className="sr-only">{o.key}. </span>
                    {o.text}
                    {rv && o.key === answer && <span className="rat"><b>Jawaban benar.</b> {full?.rationale}</span>}
                    {rv && o.key !== answer && full?.rationale && <span className="rat">{full.rationale}</span>}
                  </span>
                </label>
              );
            })}
          </fieldset>
          {mode === 'practice' && !locked && (
            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn primary" disabled={!choice || busy} onClick={submit}>
                Periksa jawaban
              </button>
              <span className="muted small">Pilih dengan <span className="kbd">A</span>–<span className="kbd">E</span>, periksa dengan <span className="kbd">Enter</span></span>
            </div>
          )}
        </>
      )}

      {q.format === 'osce' && (
        <>
          <div className="row between" style={{ marginBottom: 10 }}>
            <StationTimer openedAt={item.openedAt} serverNow={item.serverNow} seconds={c.timeSeconds} stopped={locked} />
            {!c.image && <span className="muted small">Stasiun tanpa gambar</span>}
          </div>
          <div className="osce-block"><h3>Instruksi peserta</h3>{c.instructions}</div>
          {c.scenario && <div className="osce-block"><h3>Skenario</h3>{c.scenario}</div>}
          {c.image && (
            <figure style={{ margin: '0 0 12px' }}>
              <img src={`/api/assets/${encodeURIComponent(c.image.asset)}`} alt={c.image.caption || 'Gambar stasiun'} style={{ maxWidth: '100%', borderRadius: 10, border: '1px solid var(--line)' }} />
              {c.image.caption && <figcaption className="muted small">{c.image.caption}</figcaption>}
            </figure>
          )}
          {c.tasks.length > 0 && (
            <div className="osce-block">
              <h3>Tugas</h3>
              <ol className="list-plain">{c.tasks.map((t: string, i: number) => <li key={i}>{t}</li>)}</ol>
            </div>
          )}
        </>
      )}
      {(q.format === 'viva' || q.format === 'essay') && <div className="q-stem">{c.stem}</div>}

      {q.format !== 'cbt' && (
        <>
          <label className="field">
            <span>{q.format === 'viva' ? 'Inti jawaban Anda' : q.format === 'osce' ? 'Catatan jawaban / langkah yang Anda lakukan' : 'Jawaban uraian Anda'}</span>
            <textarea
              value={text}
              readOnly={locked}
              rows={q.format === 'essay' ? 10 : 6}
              onChange={(e) => {
                dirty.current = true;
                setText(e.target.value);
              }}
              placeholder={locked ? '(tidak ada jawaban tertulis)' : 'Tulis jawaban di sini — tersimpan otomatis'}
            />
          </label>
          {mode === 'practice' && !locked && (
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn primary" disabled={busy} onClick={submit}>
                Kunci jawaban &amp; tampilkan {q.format === 'osce' ? 'checklist' : 'rubrik'}
              </button>
            </div>
          )}
          {mode === 'exam' && !locked && <p className="muted small" style={{ marginTop: 8 }}>Mode ujian: rubrik dan pembahasan tampil setelah sesi diselesaikan.</p>}
        </>
      )}

      {!locked && <div className="save-state" aria-live="polite">{saveState === 'saving' ? 'Menyimpan…' : saveState === 'saved' ? 'Tersimpan' : saveState === 'error' ? 'Gagal menyimpan — periksa koneksi; perubahan berikutnya akan dicoba lagi.' : ''}</div>}
      {error && <Notice kind="err">{error}</Notice>}

      {rv && (
        <section className="reveal" aria-label="Pembahasan">
          {q.format === 'cbt' && a?.graded && (
            <Notice kind={a.isCorrect ? 'ok' : 'err'}>
              <b>{a.isCorrect ? 'Benar' : 'Salah'}</b> — jawaban Anda {a.response.choice}, kunci {answer}. <span className="chip">nilai otomatis</span>
            </Notice>
          )}
          {q.format === 'cbt' && !a?.graded && <Notice kind="warn">Tidak dijawab — tidak dinilai dan tidak dihitung selesai. Kunci: {answer}.</Notice>}
          {q.format === 'essay' && rv.content.outline.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <h3>Kerangka jawaban ideal</h3>
              <ol className="list-plain">{rv.content.outline.map((t: string, i: number) => <li key={i}>{t}</li>)}</ol>
            </div>
          )}
          {q.format !== 'cbt' && <SelfGrade item={item} onGrade={onGrade} readonly={!a?.submitted || !onGrade} />}
          <div style={{ marginTop: 14 }}>
            <h3>Pembahasan</h3>
            <div style={{ whiteSpace: 'pre-wrap' }}>{rv.content.explanation || <i className="muted">Belum ada pembahasan.</i>}</div>
          </div>
          <ReferenceBox r={rv.reference} />
        </section>
      )}
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { DEMO_STATIONS } from '../data/demoStations';
import { deleteStations, getAllStations } from '../lib/db';
import { importPackage } from '../lib/importer';
import { topicLabel } from '../lib/topics';
import type { BankStation, ImportReport } from '../lib/types';
import ConfirmDialog from './ConfirmDialog';

const DRIVE_REFERENCE = 'https://drive.google.com/drive/folders/1BXbaGikNjOevN6VgQH1-jwf4cwbA90uw?usp=drive_link';

function Report({ r }: { r: ImportReport }) {
  const eligible = r.accepted.filter((a) => a.eligible);
  const notEligible = r.accepted.filter((a) => !a.eligible);
  return (
    <div className="card report" data-testid="import-report">
      <h3>Hasil impor{r.bankName ? ` — ${r.bankName}` : ''}</h3>
      {r.errors.map((e, i) => (
        <p key={i} className="error">
          {e}
        </p>
      ))}
      <p>
        <strong data-testid="report-eligible">{eligible.length}</strong> stasiun layak ·{' '}
        <strong data-testid="report-not-eligible">{notEligible.length}</strong> belum layak ·{' '}
        <strong data-testid="report-rejected">{r.rejected.length}</strong> ditolak
      </p>
      {notEligible.length > 0 && (
        <>
          <h4>Belum layak masuk paket</h4>
          <ul className="list">
            {notEligible.map((a) => (
              <li key={a.id}>
                <code>{a.id}</code>
                <ul>
                  {a.issues.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </>
      )}
      {r.rejected.length > 0 && (
        <>
          <h4>Ditolak</h4>
          <ul className="list">
            {r.rejected.map((a, i) => (
              <li key={i}>
                <code>{a.id}</code>
                <ul>
                  {a.reasons.map((x, j) => (
                    <li key={j}>{x}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </>
      )}
      {eligible.some((a) => a.issues.length) && (
        <>
          <h4>Peringatan</h4>
          <ul className="list">
            {eligible
              .filter((a) => a.issues.length)
              .map((a) => (
                <li key={a.id}>
                  <code>{a.id}</code>: {a.issues.join(' ')}
                </li>
              ))}
          </ul>
        </>
      )}
    </div>
  );
}

export default function BankPage() {
  const [stations, setStations] = useState<BankStation[] | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ ids: string[]; label: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = () => getAllStations().then((s) => setStations(s.sort((a, b) => a.id.localeCompare(b.id))));
  useEffect(() => {
    void reload();
  }, []);

  async function onFile(f: File) {
    setBusy(true);
    try {
      setReport(await importPackage(new Uint8Array(await f.arrayBuffer()), f.name));
      await reload();
    } finally {
      setBusy(false);
    }
  }

  const groups = useMemo(() => {
    const list = stations ?? [];
    const source = list.filter((s) => !s.demo);
    const demo = list.filter((s) => s.demo);
    const topics = new Map<string, number>();
    for (const s of source) if (s.eligible) topics.set(s.topic, (topics.get(s.topic) ?? 0) + 1);
    return { source, demo, topics };
  }, [stations]);

  const eligibleSource = groups.source.filter((s) => s.eligible).length;

  const row = (s: BankStation) => (
    <tr key={s.id} className={s.eligible ? '' : 'not-eligible'}>
      <td>
        <code>{s.id}</code>
      </td>
      <td>{topicLabel(s.topic)}</td>
      <td>{s.title}</td>
      <td>
        {s.eligible ? <span className="pill ok">Layak</span> : <span className="pill warn">Belum layak</span>}
        {s.issues.length > 0 && (
          <details>
            <summary className="small">{s.issues.length} catatan</summary>
            <ul className="small">
              {s.issues.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          </details>
        )}
      </td>
      <td className="small">
        {s.source.document}
        {s.source.scenario ? ` · skenario ${s.source.scenario}` : ''}
        {s.source.page ? ` · hlm ${s.source.page}` : ''}
      </td>
      <td>
        <button className="danger ghost small-btn" onClick={() => setConfirmDelete({ ids: [s.id], label: `stasiun ${s.id}` })}>
          Hapus
        </button>
      </td>
    </tr>
  );

  return (
    <section>
      <h1 className="page-title">Bank Kasus</h1>

      <div className="card">
        <h2>Impor bank</h2>
        <p>
          Pilih file <code>stations.json</code> atau ZIP berisi <code>stations.json</code> dan folder aset yang dirujuk dengan path relatif. Semua
          diproses lokal di browser; tidak ada yang diunggah.
        </p>
        <div className="actions">
          <button className="primary" disabled={busy} onClick={() => fileRef.current?.click()} data-testid="import-button">
            {busy ? 'Mengimpor…' : 'Pilih file JSON/ZIP'}
          </button>
          <a className="button" href="./examples/stations.template.json" download>
            Unduh template JSON
          </a>
          <a className="button" href="./examples/contoh-paket-demo.zip" download>
            Unduh contoh paket ZIP
          </a>
          <input
            ref={fileRef}
            data-testid="import-input"
            type="file"
            accept=".json,.zip,application/json,application/zip"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void onFile(f);
            }}
          />
        </div>
        <p className="muted small">
          Stasiun dengan ID yang sama akan diperbarui. Paket yang sudah dimulai tidak berubah karena memakai snapshot. Format lengkap: lihat{' '}
          <code>docs/FORMAT-BANK.md</code> di repositori.
        </p>
        <p className="muted small">
          Folder referensi pengguna (hanya rujukan, tidak dibaca aplikasi):{' '}
          <a href={DRIVE_REFERENCE} target="_blank" rel="noreferrer noopener">
            Google Drive
          </a>
          . Ubah dokumen dari folder itu ke format JSON/ZIP di atas, gunakan hanya gambar yang diizinkan dan sudah dideidentifikasi.
        </p>
      </div>

      {report && <Report r={report} />}

      <div className="card">
        <h2>Bank sumber</h2>
        <p data-testid="bank-count">
          {eligibleSource} stasiun layak dari {groups.source.length} stasiun sumber.
          {eligibleSource < 25 && groups.source.length > 0 && ' Paket harian akan berisi jumlah aktual (target 25) tanpa duplikasi.'}
        </p>
        {groups.topics.size > 0 && (
          <p className="small">
            {[...groups.topics.entries()].map(([t, n]) => (
              <span key={t} className="pill">
                {topicLabel(t)}: {n}
              </span>
            ))}
          </p>
        )}
        {groups.source.length > 0 ? (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Topik</th>
                    <th>Judul netral</th>
                    <th>Status</th>
                    <th>Sumber</th>
                    <th />
                  </tr>
                </thead>
                <tbody>{groups.source.map(row)}</tbody>
              </table>
            </div>
            <button className="danger ghost" onClick={() => setConfirmDelete({ ids: groups.source.map((s) => s.id), label: 'seluruh bank sumber' })}>
              Hapus seluruh bank sumber
            </button>
          </>
        ) : (
          <p className="muted">Belum ada stasiun sumber.</p>
        )}
      </div>

      <div className="card">
        <h2>Kasus demo</h2>
        <p className="muted small">Demo — bukan dari bank sumber. Hanya dipakai di Paket Demo, tidak pernah dicampur ke paket harian.</p>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Topik</th>
                <th>Judul netral</th>
                <th>Status</th>
                <th>Sumber</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {DEMO_STATIONS.filter((d) => !groups.demo.some((g) => g.id === d.id)).map((s) => (
                <tr key={s.id}>
                  <td>
                    <code>{s.id}</code>
                  </td>
                  <td>{topicLabel(s.topic)}</td>
                  <td>{s.title}</td>
                  <td>
                    <span className="pill ok">Layak</span>
                  </td>
                  <td className="small">Bawaan aplikasi</td>
                  <td />
                </tr>
              ))}
              {groups.demo.map(row)}
            </tbody>
          </table>
        </div>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title="Hapus dari bank?"
          message={`Hapus ${confirmDelete.label} dari bank lokal. Sesi yang sudah dimulai tetap utuh karena memakai snapshot.`}
          confirmLabel="Hapus"
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            const ids = confirmDelete.ids;
            setConfirmDelete(null);
            await deleteStations(ids);
            await reload();
          }}
        />
      )}
    </section>
  );
}

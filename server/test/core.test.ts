import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localDate } from '../src/clock.js';
import { setSetting } from '../src/db.js';
import { getOrCreatePackage, packageStats } from '../src/services/packages.js';
import * as S from '../src/services/sessions.js';
import { dashboard, exportBackup, importBackup, listBank, bankDetail } from '../src/services/progress.js';
import { getQuestion, importQuestions, parseQuestionInput, setStatus, updateQuestion } from '../src/services/questions.js';
import { seedDemo } from '../src/demo.js';
import { add, addCbts, at, cbtInput, freshDb, osceInput, vivaInput } from './helpers.js';

const itemsOf = (db: any, pkgId: string) => (db.prepare('SELECT question_id FROM daily_package_items WHERE package_id = ? ORDER BY position').all(pkgId) as any[]).map((r) => r.question_id);

/** Menjawab n soal pertama sesi (mode latihan) dengan pilihan tertentu. */
function answer(db: any, userId: number, sessionId: string, positions: number[], choice = 'A') {
  for (const p of positions) {
    S.openItem(db, userId, sessionId, p);
    S.submitItem(db, userId, sessionId, p, { choice });
  }
}

test('tanggal paket mengikuti WITA (UTC+8), bukan UTC', () => {
  assert.equal(localDate(new Date('2026-03-01T15:59:59Z'), 'Asia/Makassar'), '2026-03-01'); // 23.59 WITA
  assert.equal(localDate(new Date('2026-03-01T16:00:00Z'), 'Asia/Makassar'), '2026-03-02'); // 00.00 WITA
});

test('bank < 1.000: paket berisi jumlah sebenarnya, kekurangan dilaporkan, tanpa ID ganda', () => {
  const { db, userId } = freshDb();
  at('2026-03-01T02:00:00Z');
  addCbts(db, 1, 60);
  const pkg = getOrCreatePackage(db, userId);
  const ids = itemsOf(db, pkg.id);
  assert.equal(ids.length, 60);
  assert.equal(new Set(ids).size, 60);
  const st = packageStats(db, pkg);
  assert.deepEqual({ size: st.size, shortfall: st.shortfall, done: st.done }, { size: 60, shortfall: 940, done: 0 });
  // sesi 100 soal hanya mendapat 60 — tidak digandakan
  const s = S.startSession(db, userId, { kind: 'new', mode: 'practice', size: 100 });
  assert.equal(s.total, 60);
});

test('bank > 1.000: paket maksimal 1.000 soal unik dan urutannya tetap saat dimuat ulang', () => {
  const { db, userId } = freshDb();
  at('2026-03-01T02:00:00Z');
  addCbts(db, 1, 1200);
  const pkg = getOrCreatePackage(db, userId);
  const first = itemsOf(db, pkg.id);
  assert.equal(first.length, 1000);
  assert.equal(new Set(first).size, 1000);
  const again = getOrCreatePackage(db, userId);
  assert.equal(again.id, pkg.id);
  assert.deepEqual(itemsOf(db, again.id), first);
  assert.equal(packageStats(db, pkg).shortfall, 0);
  const s = S.startSession(db, userId, { kind: 'new', mode: 'practice', size: 1000 });
  assert.equal(s.total, 1000);
});

test('hanya soal disetujui (non-demo) yang masuk paket resmi; mode demo ditandai', () => {
  const { db, userId } = freshDb();
  at('2026-03-01T02:00:00Z');
  addCbts(db, 1, 5);
  addCbts(db, 6, 8, 'draft');
  addCbts(db, 9, 10, 'needs_review');
  seedDemo(db);
  let pkg = getOrCreatePackage(db, userId);
  assert.deepEqual(itemsOf(db, pkg.id).sort(), ['T-CBT-00001', 'T-CBT-00002', 'T-CBT-00003', 'T-CBT-00004', 'T-CBT-00005']);
  assert.equal(packageStats(db, pkg).containsDemo, false);
  // soal demo tidak bisa disetujui
  assert.ok(setStatus(db, 'DEMO-CBT-001', 'approved', null).problems.length > 0);
  assert.throws(() => db.prepare(`UPDATE questions SET status='approved' WHERE id='DEMO-CBT-001'`).run());
  setSetting(db, 'demo_mode', '1');
  pkg = getOrCreatePackage(db, userId);
  assert.equal(itemsOf(db, pkg.id).length, 5 + 66);
  assert.equal(packageStats(db, pkg).containsDemo, true);
});

test('beberapa sesi pada tanggal yang sama melanjutkan paket yang sama tanpa hitung ganda', () => {
  const { db, userId } = freshDb();
  at('2026-03-01T02:00:00Z');
  addCbts(db, 1, 100);
  const pkg = getOrCreatePackage(db, userId);
  const order = itemsOf(db, pkg.id);
  const s1 = S.startSession(db, userId, { kind: 'new', mode: 'practice', size: 10 });
  // hanya satu sesi soal baru yang boleh aktif
  assert.throws(() => S.startSession(db, userId, { kind: 'new', mode: 'practice', size: 10 }), /sesi aktif/);
  answer(db, userId, s1.id, [1, 2, 3, 4, 5, 6, 7]); // 7 dinilai, 3 tidak dijawab
  S.openItem(db, userId, s1.id, 8); // dibuka saja: tidak dihitung selesai
  S.finishSession(db, userId, s1.id);
  assert.equal(packageStats(db, pkg).done, 7);
  const s2 = S.startSession(db, userId, { kind: 'new', mode: 'practice', size: 25 });
  const s2ids = S.getSession(db, userId, s2.id).items.map((i) => i.questionId);
  // melanjutkan dari soal paket yang belum dinilai, sesuai urutan paket
  assert.deepEqual(s2ids, order.slice(7, 32));
  answer(db, userId, s2.id, [1, 2, 3]);
  assert.equal(packageStats(db, pkg).done, 10);
  assert.equal(dashboard(db, userId).package.done, 10);
});

test('jawaban yang sama tidak dihitung dua kali', () => {
  const { db, userId } = freshDb();
  at('2026-03-01T02:00:00Z');
  addCbts(db, 1, 20);
  const s = S.startSession(db, userId, { kind: 'new', mode: 'practice', size: 10 });
  S.openItem(db, userId, s.id, 1);
  const r1 = S.submitItem(db, userId, s.id, 1, { choice: 'B' });
  const r2 = S.submitItem(db, userId, s.id, 1, { choice: 'A' }); // kirim ulang: diabaikan, jawaban pertama tetap
  assert.equal(r1.attempt!.isCorrect, false);
  assert.equal(r2.attempt!.response.choice, 'B');
  assert.equal(r2.attempt!.isCorrect, false);
  assert.throws(() => S.saveResponse(db, userId, s.id, 1, { choice: 'A' }), /dikunci/);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM attempts').get() as any).n, 1);
  assert.equal(packageStats(db, getOrCreatePackage(db, userId)).done, 1);
  // indeks unik database menolak percobaan "soal baru" kedua untuk soal yang sama
  const a = db.prepare('SELECT * FROM attempts').get() as any;
  assert.throws(() =>
    db.prepare(`INSERT INTO attempts (id, user_id, question_id, session_id, kind, format, question_version, updated_at) VALUES ('x', ?, ?, ?, 'new', 'cbt', 1, 'now')`).run(userId, a.question_id, 'other'),
  );
});

test('muat ulang mempertahankan sesi aktif, posisi, draf jawaban, dan bookmark', () => {
  const { db, userId } = freshDb();
  at('2026-03-01T02:00:00Z');
  addCbts(db, 1, 20);
  add(db, vivaInput('T-VIVA-1'));
  const s = S.startSession(db, userId, { kind: 'new', mode: 'exam', size: 25 });
  const sess = S.getSession(db, userId, s.id);
  const vivaPos = sess.items.find((i) => i.format === 'viva')!.position;
  const cbtPos = sess.items.find((i) => i.format === 'cbt')!.position;
  S.openItem(db, userId, s.id, cbtPos);
  S.saveResponse(db, userId, s.id, cbtPos, { choice: 'C' }, 42);
  S.openItem(db, userId, s.id, vivaPos);
  S.saveResponse(db, userId, s.id, vivaPos, { text: 'jawaban tertulis saya' }, 90);
  S.setBookmark(db, userId, sess.items[cbtPos - 1].questionId, true);
  // "refresh": semua dibaca ulang dari database
  const active = S.activeSessions(db, userId) as any[];
  assert.equal(active.length, 1);
  assert.equal(active[0].id, s.id);
  const re = S.getSession(db, userId, s.id);
  assert.equal(re.elapsedSeconds, 90);
  assert.equal(re.currentIndex, vivaPos - 1);
  assert.deepEqual(re.items.map((i) => i.questionId), sess.items.map((i) => i.questionId));
  assert.equal(S.openItem(db, userId, s.id, cbtPos).attempt!.response.choice, 'C');
  assert.equal(S.openItem(db, userId, s.id, cbtPos).bookmarked, true);
  assert.equal(S.openItem(db, userId, s.id, vivaPos).attempt!.response.text, 'jawaban tertulis saya');
});

test('mode ujian: kunci tersembunyi sampai sesi selesai; yang tidak dijawab tidak dihitung', () => {
  const { db, userId } = freshDb();
  at('2026-03-01T02:00:00Z');
  addCbts(db, 1, 10);
  const s = S.startSession(db, userId, { kind: 'new', mode: 'exam', size: 10 });
  const v = S.openItem(db, userId, s.id, 1);
  assert.equal(v.reveal, null);
  assert.equal((v.question.content as any).answer, undefined);
  assert.throws(() => S.submitItem(db, userId, s.id, 1, { choice: 'A' }), /mode ujian/);
  S.saveResponse(db, userId, s.id, 1, { choice: 'A' });
  S.saveResponse(db, userId, s.id, 1, { choice: 'B' }); // boleh mengganti sebelum selesai
  S.openItem(db, userId, s.id, 2);
  S.saveResponse(db, userId, s.id, 2, { choice: 'A' });
  S.openItem(db, userId, s.id, 3); // dibuka, tidak dijawab
  assert.equal(S.openItem(db, userId, s.id, 1).attempt!.isCorrect, null);
  assert.equal(packageStats(db, getOrCreatePackage(db, userId)).done, 0);
  const sum = S.finishSession(db, userId, s.id);
  assert.deepEqual(sum.cbt, { n: 2, correct: 1 });
  assert.equal(sum.unanswered, 8);
  assert.equal(packageStats(db, getOrCreatePackage(db, userId)).done, 2);
  const after = S.openItem(db, userId, s.id, 1);
  assert.equal(after.reveal!.content.answer, 'A');
  assert.equal(after.attempt!.isCorrect, false);
  assert.throws(() => S.saveResponse(db, userId, s.id, 3, { choice: 'A' }), /selesai/);
});

test('nilai mandiri VIVA/OSCE terpisah dari nilai otomatis; critical step terlewat = belum lulus', () => {
  const { db, userId } = freshDb();
  at('2026-03-01T02:00:00Z');
  add(db, vivaInput('T-VIVA-1'));
  add(db, osceInput('T-OSCE-1'));
  add(db, cbtInput(1));
  const s = S.startSession(db, userId, { kind: 'new', mode: 'practice', size: 10 });
  const items = S.getSession(db, userId, s.id).items;
  const p = (f: string) => items.find((i) => i.format === f)!.position;
  const viva = S.openItem(db, userId, s.id, p('viva'));
  assert.equal(viva.reveal, null); // rubrik belum terlihat
  assert.throws(() => S.selfGrade(db, userId, s.id, p('viva'), [0]), /Kunci jawaban/);
  const locked = S.submitItem(db, userId, s.id, p('viva'), { text: 'inti jawaban' });
  assert.equal(locked.reveal!.content.rubric.length, 2);
  assert.equal(packageStats(db, getOrCreatePackage(db, userId)).done, 0); // terkunci tapi belum dinilai
  const g = S.selfGrade(db, userId, s.id, p('viva'), [0]);
  assert.equal(g.attempt!.score, 0.75);
  assert.equal(g.attempt!.autoGraded, false);
  S.openItem(db, userId, s.id, p('osce'));
  S.submitItem(db, userId, s.id, p('osce'), { text: 'catatan' });
  const o = S.selfGrade(db, userId, s.id, p('osce'), [1]); // 75% tetapi critical step terlewat
  assert.equal(o.attempt!.score, 0.75);
  assert.equal(o.attempt!.isCorrect, false);
  assert.deepEqual(o.attempt!.grade.criticalMissed, [0]);
  answer(db, userId, s.id, [p('cbt')]);
  const today = dashboard(db, userId).today.new;
  assert.deepEqual(today.cbt, { n: 1, correct: 1 });
  assert.equal(today.self.n, 2);
  assert.equal(today.self.avg, 0.75);
});

test('pergantian tanggal WITA: paket baru tanpa soal yang sudah dibuka; paket lama utuh', () => {
  const { db, userId } = freshDb();
  at('2026-03-01T15:30:00Z'); // 23.30 WITA, 1 Maret
  addCbts(db, 1, 30);
  const day1 = getOrCreatePackage(db, userId);
  assert.equal(day1.date, '2026-03-01');
  const s = S.startSession(db, userId, { kind: 'new', mode: 'practice', size: 10 });
  const opened = S.getSession(db, userId, s.id).items.map((i) => i.questionId);
  answer(db, userId, s.id, [1, 2, 3, 4]);
  S.openItem(db, userId, s.id, 5); // dibuka tanpa dijawab
  S.finishSession(db, userId, s.id);
  at('2026-03-01T15:59:00Z');
  assert.equal(getOrCreatePackage(db, userId).id, day1.id); // masih 1 Maret WITA
  at('2026-03-01T16:01:00Z'); // 00.01 WITA, 2 Maret — paket dibuat saat pertama diakses
  const day2 = getOrCreatePackage(db, userId);
  assert.equal(day2.date, '2026-03-02');
  assert.notEqual(day2.id, day1.id);
  const d2 = itemsOf(db, day2.id);
  for (const id of opened.slice(0, 5)) assert.ok(!d2.includes(id), `${id} sudah dibuka, tidak boleh muncul lagi`);
  assert.equal(d2.length, 25); // 30 - 5 yang sudah dibuka
  assert.equal(packageStats(db, day2).done, 0);
  assert.equal(packageStats(db, day1).done, 4);
  assert.equal(itemsOf(db, day1.id).length, 30); // paket lama tidak diubah
});

test('remedial tidak menambah jumlah soal baru yang selesai', () => {
  const { db, userId } = freshDb();
  at('2026-03-01T02:00:00Z');
  addCbts(db, 1, 20);
  const s = S.startSession(db, userId, { kind: 'new', mode: 'practice', size: 10 });
  answer(db, userId, s.id, [1, 2, 3], 'B'); // salah
  answer(db, userId, s.id, [4, 5], 'A'); // benar
  S.finishSession(db, userId, s.id);
  const pkg = getOrCreatePackage(db, userId);
  assert.equal(packageStats(db, pkg).done, 5);
  assert.equal(S.remedialCounts(db, userId).wrong, 3);
  const r = S.startSession(db, userId, { kind: 'remedial', mode: 'practice', size: 10, remedialSource: 'wrong' });
  assert.equal(r.total, 3);
  answer(db, userId, r.id, [1, 2], 'A');
  S.finishSession(db, userId, r.id);
  assert.equal(packageStats(db, pkg).done, 5); // tetap
  const d = dashboard(db, userId);
  assert.equal(d.package.done, 5);
  assert.deepEqual(d.today.new.cbt, { n: 5, correct: 2 });
  assert.equal(S.remedialCounts(db, userId).wrong, 1); // dua sudah diperbaiki
  assert.equal((db.prepare(`SELECT COUNT(*) n FROM question_exposures`).get() as any).n, 5); // remedial tidak menambah "dibuka"
  // remedial boleh diulang
  const r2 = S.startSession(db, userId, { kind: 'remedial', mode: 'practice', size: 10, remedialSource: 'wrong' });
  assert.equal(r2.total, 1);
});

test('menambah soal tervalidasi dan memperbaiki soal tidak merusak progres', () => {
  const { db, userId, adminId } = freshDb();
  at('2026-03-01T02:00:00Z');
  addCbts(db, 1, 10);
  const pkg = getOrCreatePackage(db, userId);
  const before = itemsOf(db, pkg.id);
  const s = S.startSession(db, userId, { kind: 'new', mode: 'practice', size: 10 });
  answer(db, userId, s.id, [1, 2, 3]);
  const answeredId = S.getSession(db, userId, s.id).items[0].questionId;
  // tambah soal baru yang disetujui pada hari yang sama: ditambahkan di akhir paket
  addCbts(db, 11, 15);
  const after = itemsOf(db, getOrCreatePackage(db, userId).id);
  assert.deepEqual(after.slice(0, 10), before);
  assert.equal(after.length, 15);
  assert.equal(new Set(after).size, 15);
  assert.equal(packageStats(db, pkg).done, 3);
  // perbaiki soal yang sudah dijawab: versi naik, riwayat tersimpan, percobaan tetap ada
  const q = getQuestion(db, answeredId)!;
  const edited = parseQuestionInput({ ...q, content: { ...q.content, stem: 'Soal uji (diperbaiki)' } });
  assert.ok(edited.ok);
  const saved = updateQuestion(db, answeredId, (edited as any).value, adminId, 'approved', 'perbaikan redaksi');
  assert.equal(saved.version, 2);
  assert.equal(saved.status, 'approved');
  assert.equal((db.prepare('SELECT COUNT(*) n FROM question_versions WHERE question_id = ?').get(answeredId) as any).n, 2);
  const att = db.prepare('SELECT * FROM attempts WHERE question_id = ?').get(answeredId) as any;
  assert.equal(att.question_version, 1);
  assert.ok(att.graded_at);
  assert.equal(packageStats(db, pkg).done, 3);
  // soal yang ditarik (bukan disetujui lagi) tidak disajikan, tetapi yang sudah dinilai tetap terhitung
  const pendingId = S.getSession(db, userId, s.id).items[5].questionId;
  setStatus(db, pendingId, 'needs_review', adminId);
  setStatus(db, answeredId, 'needs_review', adminId);
  const st = packageStats(db, pkg);
  assert.equal(st.done, 3);
  assert.equal(st.size, 14);
});

test('impor: validasi, penurunan status, ID ganda, pembaruan sebagai versi baru', () => {
  const { db, adminId } = freshDb();
  at('2026-03-01T02:00:00Z');
  const noRef = cbtInput(3, { reference: { bookTitle: '', edition: '', chapter: '' }, status: 'approved' });
  const r = importQuestions(db, [
    cbtInput(1, { status: 'approved' }),
    cbtInput(1), // ID ganda dalam berkas
    { format: 'cbt', category: 'trauma', content: { stem: 'x' } }, // struktur tidak valid
    cbtInput(2, { status: 'draft', category: 'Kategori Baru' }),
    noRef,
  ], adminId);
  assert.deepEqual({ c: r.created, r: r.rejected }, { c: 3, r: 2 });
  assert.equal(getQuestion(db, 'T-CBT-00001')!.status, 'needs_review'); // "approved" dari berkas tidak dipercaya begitu saja
  assert.equal(getQuestion(db, 'T-CBT-00002')!.category, 'kategori-baru');
  // dengan trustApproved, soal tanpa rujukan tetap tidak bisa disetujui
  const r2 = importQuestions(db, [cbtInput(4, { status: 'approved' }), { ...noRef, id: 'T-CBT-00005' }], adminId, { trustApproved: true });
  assert.equal(r2.created, 2);
  assert.equal(getQuestion(db, 'T-CBT-00004')!.status, 'approved');
  const bad = getQuestion(db, 'T-CBT-00005')!;
  assert.equal(bad.status, 'needs_review');
  assert.match(bad.reviewNote, /Nama buku/);
  // impor ulang: tidak berubah -> unchanged; berubah -> versi baru
  const r3 = importQuestions(db, [cbtInput(4), cbtInput(2, { topic: 'Topik lain', category: 'Kategori Baru' })], adminId);
  assert.deepEqual({ u: r3.updated, n: r3.unchanged }, { u: 1, n: 1 });
  assert.equal(getQuestion(db, 'T-CBT-00002')!.version, 2);
  assert.equal(getQuestion(db, 'T-CBT-00004')!.status, 'approved');
});

test('bank soal menyembunyikan isi soal yang belum dibuka', () => {
  const { db, userId } = freshDb();
  at('2026-03-01T02:00:00Z');
  addCbts(db, 1, 30);
  const s = S.startSession(db, userId, { kind: 'new', mode: 'practice', size: 10 });
  answer(db, userId, s.id, [1]);
  const openedId = S.getSession(db, userId, s.id).items[0].questionId;
  const list = listBank(db, userId, { pageSize: 100 });
  assert.equal(list.total, 30);
  assert.equal(list.items.filter((i) => i.stem !== null).length, 1);
  assert.equal(listBank(db, userId, { progress: 'correct' }).total, 1);
  assert.equal(listBank(db, userId, { progress: 'unseen' }).total, 29);
  assert.equal(listBank(db, userId, { search: 'Soal uji' }).total, 1); // isi soal belum dibuka tidak bisa dicari
  const unseen = list.items.find((i) => i.stem === null)!;
  assert.equal(bankDetail(db, userId, unseen.id, 'learner').hidden, true);
  assert.equal(bankDetail(db, userId, openedId, 'learner').reveal!.content.answer, 'A');
  assert.equal(listBank(db, userId, { page: 2, pageSize: 20 }).items.length, 10);
});

test('cadangan progres: ekspor lalu impor memulihkan keadaan yang sama', () => {
  const { db, userId } = freshDb();
  at('2026-03-01T02:00:00Z');
  addCbts(db, 1, 20);
  const s = S.startSession(db, userId, { kind: 'new', mode: 'practice', size: 10 });
  answer(db, userId, s.id, [1, 2, 3], 'B');
  S.setBookmark(db, userId, 'T-CBT-00001', true);
  const backup = JSON.parse(JSON.stringify(exportBackup(db, userId)));
  const before = dashboard(db, userId);
  // rusak progres, lalu pulihkan
  answer(db, userId, s.id, [4, 5]);
  S.finishSession(db, userId, s.id);
  const res = importBackup(db, userId, backup);
  assert.equal(res.restored.attempts, 3);
  assert.deepEqual(res.skippedQuestionIds, []);
  const afterRestore = dashboard(db, userId);
  assert.deepEqual(afterRestore.package, before.package);
  assert.equal((afterRestore.activeSessions as any[])[0].id, s.id);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM bookmarks').get() as any).n, 1);
  assert.throws(() => importBackup(db, userId, { foo: 1 }), /bukan cadangan/);
});

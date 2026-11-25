import fs from 'node:fs';
import { openDb, setSetting } from '../db.js';
import { buildDemoQuestions, seedDemo } from '../demo.js';

// `npm run seed:demo`            -> memasukkan soal DEMO dan menyalakan mode demo
// `npm run seed:demo -- --file`  -> hanya menulis data-examples/demo-bank.json
if (process.argv.includes('--file')) {
  fs.writeFileSync('data-examples/demo-bank.json', JSON.stringify({ _catatan: 'DATA DEMO — bukan soal terverifikasi dan bukan materi medis.', questions: buildDemoQuestions() }, null, 2));
  console.log('data-examples/demo-bank.json ditulis.');
} else {
  const db = openDb();
  const r = seedDemo(db);
  setSetting(db, 'demo_mode', '1');
  console.log(`Soal DEMO: ${r.created} dibuat, ${r.updated} diperbarui, ${r.unchanged} tidak berubah, ${r.rejected} ditolak.`);
  console.log('Mode demo DINYALAKAN. Matikan di Panel Admin > Pengaturan sebelum memakai bank resmi.');
  db.close();
}

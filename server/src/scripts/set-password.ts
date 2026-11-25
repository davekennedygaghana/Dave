import { openDb } from '../db.js';
import { setPassword } from '../auth.js';

const [username, password] = process.argv.slice(2);
if (!username || !password) {
  console.error('Pemakaian: npm run set-password -- <username> <sandi-baru>');
  process.exit(1);
}
const db = openDb();
try {
  console.log(setPassword(db, username, password) ? `Sandi "${username}" diperbarui; semua sesi masuknya dikeluarkan.` : `Pengguna "${username}" tidak ditemukan.`);
} catch (e: any) {
  console.error(e.message);
  process.exitCode = 1;
}
db.close();

// Uji asap lintas-browser (desktop + HP) terhadap server yang sedang berjalan.
// Pemakaian: BASE_URL=http://localhost:3000 E2E_USER=admin E2E_PASS=... node e2e/smoke.mjs
// Prasyarat: bank memiliki soal layak-paket (mis. `npm run seed:demo`) dan pengguna belum punya sesi aktif.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Playwright tidak termasuk dependensi proyek: pasang dengan `npm i -D playwright && npx playwright install chromium`
const { chromium, devices } = createRequire(import.meta.url)('playwright');

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const USER = process.env.E2E_USER ?? 'admin';
const PASS = process.env.E2E_PASS;
if (!PASS) throw new Error('Set E2E_PASS');
const OUT = new URL('./out/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const step = async (name, fn) => {
  try {
    await fn();
    results.push(`ok   - ${name}`);
  } catch (e) {
    results.push(`FAIL - ${name}: ${e.message.replace(/\s+/g, ' ').slice(0, 400)}`);
    process.exitCode = 1;
  }
};
const login = async (page) => {
  await page.goto(BASE);
  await page.getByLabel('Nama pengguna').fill(USER);
  await page.getByLabel('Sandi').fill(PASS);
  await page.getByRole('button', { name: 'Masuk' }).click();
  await page.getByRole('heading', { name: 'Dashboard' }).waitFor();
};
const noOverflow = async (page) => {
  const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(o <= 1, `halaman meluber horizontal ${o}px`);
};
const qid = (page) => page.locator('.q-card .q-id').first().innerText();
const errors = [];

const browser = await chromium.launch();

// ---------- Desktop ----------
const desk = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 });
const page = await desk.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));

let firstId, secondId;
await step('masuk dan dashboard menampilkan target serta kekurangan bank secara jujur', async () => {
  await login(page);
  await page.getByRole('heading', { name: /Target hari ini: 1\.000 soal/ }).waitFor();
  await page.getByText('Bank belum mencukupi target.').waitFor();
  assert.ok(await page.locator('.sidebar').isVisible());
  await page.screenshot({ path: `${OUT}desktop-dashboard.png`, fullPage: true });
});

await step('mulai sesi 10 soal (latihan), jawab dengan keyboard, pembahasan tampil', async () => {
  await page.getByRole('radio', { name: '10', exact: true }).check();
  await page.getByRole('button', { name: /Mulai 10 soal/ }).click();
  await page.getByText('Soal 1 dari 10').waitFor();
  firstId = await qid(page);
  await page.keyboard.press('a');
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: 'Pembahasan' }).waitFor();
  await page.getByText('Rujukan:').waitFor();
  await page.getByText('nilai otomatis').waitFor();
  await page.screenshot({ path: `${OUT}desktop-exam-reveal.png`, fullPage: true });
});

await step('muat ulang mempertahankan sesi, posisi, dan pilihan yang belum diperiksa', async () => {
  await page.keyboard.press('ArrowRight');
  await page.getByText('Soal 2 dari 10').waitFor();
  secondId = await qid(page);
  assert.notEqual(secondId, firstId);
  await page.locator('.option').nth(2).click();
  await page.getByText('Tersimpan', { exact: true }).waitFor();
  await page.keyboard.press('t'); // T = tandai (B dipakai untuk pilihan B)
  await page.getByRole('button', { name: 'Ditandai' }).waitFor();
  await page.reload();
  await page.getByText('Soal 2 dari 10').waitFor();
  assert.equal(await qid(page), secondId);
  assert.ok(await page.locator('.option').nth(2).locator('input').isChecked(), 'pilihan hilang setelah muat ulang');
  await page.getByRole('button', { name: 'Ditandai' }).waitFor();
  // kembali ke soal 1: tetap terkunci dan pembahasannya masih ada
  await page.keyboard.press('ArrowLeft');
  await page.getByText('Soal 1 dari 10').waitFor();
  assert.equal(await qid(page), firstId);
  await page.getByRole('heading', { name: 'Pembahasan' }).waitFor();
});

await step('menutup tab lalu membuka lagi: dashboard menawarkan "Lanjutkan sesi"', async () => {
  const p2 = await desk.newPage();
  await p2.goto(BASE);
  await p2.getByRole('button', { name: 'Lanjutkan sesi' }).click();
  await p2.getByText(/Soal \d+ dari 10/).waitFor();
  await p2.close();
});

await step('menyelesaikan sesi: hanya soal dinilai yang dihitung', async () => {
  await page.getByRole('button', { name: 'Selesai', exact: true }).click();
  await page.getByText(/soal belum dijawab/).waitFor();
  await page.getByRole('button', { name: 'Ya, selesaikan' }).click();
  await page.getByRole('heading', { name: 'Hasil sesi' }).waitFor();
  await page.getByRole('button', { name: 'Kembali ke dashboard' }).click();
  await page.getByText('/ 1.000 soal dijawab & dinilai').waitFor();
  const done = await page.getByTestId('done-count').innerText();
  assert.equal(done.trim(), '1');
});

await step('sesi berikutnya melanjutkan paket yang sama tanpa mengulang soal yang sudah dinilai', async () => {
  await page.getByRole('radio', { name: '10', exact: true }).check();
  await page.getByRole('button', { name: /Mulai 10 soal/ }).click();
  await page.getByText('Soal 1 dari 10').waitFor();
  // soal 2 sesi lama (belum dinilai) kembali menjadi soal pertama; soal 1 lama tidak muncul lagi
  assert.equal(await qid(page), secondId);
  await page.getByRole('button', { name: 'Buka daftar nomor soal' }).click();
  const labels = await page.locator('.navigator button').count();
  assert.equal(labels, 10);
  await page.keyboard.press('Escape');
  const ids = new Set();
  for (let i = 1; i <= 10; i++) {
    await page.getByText(`Soal ${i} dari 10`).waitFor();
    await page.locator('.q-card .q-id').first().waitFor();
    ids.add(await qid(page));
    if (i < 10) await page.keyboard.press('ArrowRight');
  }
  assert.equal(ids.size, 10);
  assert.ok(!ids.has(firstId), 'soal yang sudah dinilai muncul lagi');
});

await step('bank soal, progres, referensi, dan panel admin terbuka tanpa galat', async () => {
  await page.goto(`${BASE}/bank`);
  await page.getByText('Belum dibuka — isi disembunyikan').first().waitFor();
  await page.screenshot({ path: `${OUT}desktop-bank.png` });
  await page.goto(`${BASE}/progres`);
  await page.getByRole('heading', { name: 'Riwayat harian' }).waitFor();
  await page.getByRole('link', { name: 'Ekspor cadangan (.json)' }).waitFor();
  await page.screenshot({ path: `${OUT}desktop-progress.png`, fullPage: true });
  await page.goto(`${BASE}/referensi`);
  await page.getByRole('heading', { name: 'Referensi' }).waitFor();
  await page.goto(`${BASE}/admin`);
  await page.getByRole('tab', { name: 'Tinjau & setujui' }).waitFor();
  await page.getByLabel('Status').selectOption('');
  await page.getByRole('button', { name: 'Tinjau', exact: true }).first().click();
  await page.getByRole('heading', { name: 'Riwayat versi' }).waitFor();
  await page.screenshot({ path: `${OUT}desktop-admin-editor.png` });
  await page.keyboard.press('Escape');
  for (const t of ['Impor bank soal', 'Sumber referensi', 'Draft AI', 'Pengaturan']) {
    await page.getByRole('tab', { name: t }).click();
    await page.locator('[role=tabpanel] .card').first().waitFor();
  }
});

// ---------- HP ----------
const phone = await browser.newContext({ ...devices['iPhone 13'] });
const m = await phone.newPage();
m.on('pageerror', (e) => errors.push(`pageerror(hp): ${e.message}`));

await step('HP: navigasi bawah, tanpa luberan horizontal, tombol ≥ 44px', async () => {
  await login(m);
  assert.ok(await m.locator('.bottomnav').isVisible());
  assert.ok(!(await m.locator('.sidebar').isVisible()));
  await noOverflow(m);
  await m.screenshot({ path: `${OUT}mobile-dashboard.png`, fullPage: true });
  await m.getByRole('button', { name: 'Lanjutkan sesi' }).tap();
  await m.getByText(/Soal \d+ dari 10/).waitFor();
  await m.locator('.option').first().waitFor();
  await noOverflow(m);
  const small = await m.evaluate(() =>
    [...document.querySelectorAll('.option, .exam-nav .btn, .exam-head .btn')].filter((e) => e.getBoundingClientRect().height < 36).map((e) => e.textContent.trim().slice(0, 20)),
  );
  assert.deepEqual(small, []);
  const optH = await m.locator('.option').first().evaluate((e) => e.getBoundingClientRect().height);
  assert.ok(optH >= 44, `tinggi opsi ${optH}`);
  await m.locator('.option').nth(1).tap();
  await m.getByRole('button', { name: 'Periksa jawaban' }).tap();
  await m.getByRole('heading', { name: 'Pembahasan' }).waitFor();
  await noOverflow(m);
  await m.screenshot({ path: `${OUT}mobile-exam.png`, fullPage: true });
  for (const path of ['/bank', '/progres', '/remedial', '/referensi', '/admin']) {
    await m.goto(BASE + path);
    await m.locator('h1').waitFor();
    await m.waitForLoadState('networkidle');
    await noOverflow(m);
  }
  await m.goto(`${BASE}/bank`);
  await m.screenshot({ path: `${OUT}mobile-bank.png` });
});

await browser.close();
if (errors.length) {
  results.push(`FAIL - galat konsol/halaman: ${errors.slice(0, 5).join(' | ')}`);
  process.exitCode = 1;
}
console.log(results.join('\n'));

import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { bankFile, WEIGHT_PER_STATION } from './fixtures';

const T_1000_WITA = new Date('2026-11-25T02:00:00Z'); // Rabu 25 Nov 2026, 10.00 WITA

async function importBank(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
  await page.goto('./#/bank');
  await page.getByTestId('import-input').setInputFiles(file);
  await expect(page.getByTestId('import-report')).toBeVisible();
}

async function lock(page: Page, which: 'clinical' | 'followup') {
  await page.getByTestId(which === 'clinical' ? 'submit-clinical' : 'submit-followup').click();
  await page.getByTestId('confirm-lock').click();
}

const stat = (page: Page, id: string) => page.getByTestId(id).locator('strong');

async function stationTitles(page: Page) {
  await expect(page.getByTestId('station').or(page.getByTestId('summary'))).toBeVisible();
  const chips = page.locator('.station-strip .chip:not(.summary)');
  const n = await chips.count();
  const titles: string[] = [];
  for (let i = 0; i < n; i++) {
    await chips.nth(i).click();
    titles.push((await page.getByTestId('station-title').textContent()) ?? '');
  }
  await chips.first().click();
  return titles;
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(T_1000_WITA);
});

test('alur lengkap demo: kunci tersembunyi sampai respons kedua, refresh tidak menghapus progres', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Belajar satu stasiun, lanjut saat Anda siap.' })).toBeVisible();
  await page.getByRole('button', { name: 'Coba Paket Demo' }).click();
  await expect(page.getByText('Demo — bukan dari bank sumber').first()).toBeVisible();
  await expect(stat(page, 'stat-responses')).toHaveText('0/6');
  await expect(stat(page, 'stat-station')).toHaveText('1/3');

  const order = await stationTitles(page);
  expect(new Set(order).size).toBe(3);
  const body = () => page.locator('body').innerText();

  // Tahap 1: tidak ada kunci/pembahasan/checklist di DOM
  await expect(page.getByTestId('review')).toHaveCount(0);
  expect(await page.content()).not.toContain('Pembahasan');
  await page.locator('#ans-clinical').fill('Jawaban klinis uji');
  await page.waitForTimeout(700); // autosave debounce
  await page.reload();
  await expect(page.locator('#ans-clinical')).toHaveValue('Jawaban klinis uji');
  await expect(stat(page, 'stat-responses')).toHaveText('0/6'); // draft belum dihitung
  expect(await stationTitles(page)).toEqual(order);

  await lock(page, 'clinical');
  await expect(stat(page, 'stat-responses')).toHaveText('1/6');
  await expect(page.getByText('Jawaban klinis Anda (terkunci)')).toBeVisible();
  await expect(page.locator('#ans-clinical')).toHaveCount(0);
  // Tahap 2: kunci tetap tersembunyi
  await expect(page.getByTestId('review')).toHaveCount(0);
  expect(await page.content()).not.toMatch(/data-testid="key-/);
  await page.locator('#ans-followup').fill('Jawaban lanjutan uji');
  await page.reload();
  await expect(page.locator('#ans-followup')).toHaveValue('Jawaban lanjutan uji');
  await expect(page.getByTestId('review')).toHaveCount(0);

  await lock(page, 'followup');
  await expect(page.getByTestId('review')).toBeVisible();
  await expect(page.getByTestId('key-clinical')).toBeVisible();
  await expect(stat(page, 'stat-responses')).toHaveText('2/6');
  expect(await body()).toContain('Jawaban klinis uji');

  // Skor dari butir yang dicentang; penyebut dari rubrik paket (demo: 30 + 31 + 30... dihitung di UI)
  const maxText = (await stat(page, 'stat-score').textContent())!;
  const max = Number(maxText.split('/')[1]);
  expect(max).toBeGreaterThan(0);
  const first = page.getByTestId('checklist-clinical').locator('input[type=checkbox]').first();
  await first.check();
  await expect(stat(page, 'stat-score')).not.toHaveText(`0/${max}`);
  const scored = (await stat(page, 'stat-score').textContent())!;
  await page.reload();
  await expect(stat(page, 'stat-score')).toHaveText(scored);
  await expect(page.getByTestId('checklist-clinical').locator('input[type=checkbox]').first()).toBeChecked();

  await expect(stat(page, 'stat-reviewed')).toHaveText('0/3');
  await page.getByTestId('finish-review').click();
  await expect(stat(page, 'stat-reviewed')).toHaveText('1/3');
  await expect(stat(page, 'stat-station')).toHaveText('2/3');
  expect(await stationTitles(page)).toEqual(order);
});

test('bank kecil: jumlah aktual tanpa duplikasi, penyebut skor benar', async ({ page }) => {
  await importBank(page, bankFile(7));
  await expect(page.getByTestId('report-eligible')).toHaveText('7');
  await page.getByRole('button', { name: 'Latihan Hari Ini' }).first().click();
  await expect(stat(page, 'stat-station')).toHaveText('1/7');
  await expect(stat(page, 'stat-responses')).toHaveText('0/14');
  await expect(stat(page, 'stat-score')).toHaveText(`0/${7 * WEIGHT_PER_STATION}`);
  await expect(page.getByTestId('short-pack')).toContainText('Paket berisi 7 stasiun');
  const titles = await stationTitles(page);
  expect(titles).toHaveLength(7);
  expect(new Set(titles).size).toBe(7);
  // Demo tidak tercampur
  expect(titles.some((t) => t.includes('Demo'))).toBe(false);
});

test('25 stasiun dari bank besar; impor baru tidak mengubah paket yang sudah dimulai', async ({ page }) => {
  await importBank(page, bankFile(40));
  await page.goto('./#/latihan');
  await expect(stat(page, 'stat-station')).toHaveText('1/25');
  await expect(stat(page, 'stat-responses')).toHaveText('0/50');
  await expect(stat(page, 'stat-score')).toHaveText(`0/${25 * WEIGHT_PER_STATION}`);
  const before = await stationTitles(page);
  expect(new Set(before).size).toBe(25);
  await importBank(page, bankFile(30, 'baru'));
  await page.goto('./#/latihan');
  await expect(page.getByText('Bank kini berisi 70 stasiun layak')).toBeVisible();
  expect(await stationTitles(page)).toEqual(before);
});

test('paket berganti tepat 09.00 WITA dan sesi lama bisa dilanjutkan', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-26T00:59:00Z')); // 08.59 WITA, Kamis 26 Nov
  await importBank(page, bankFile(30));
  await page.goto('./#/latihan');
  await expect(page.getByText('Paket Rabu, 25 November 2026')).toBeVisible();
  await page.locator('#ans-clinical').fill('jawaban sesi lama');
  await lock(page, 'clinical');
  await expect(stat(page, 'stat-responses')).toHaveText('1/50');

  await page.clock.setFixedTime(new Date('2026-11-26T01:00:00Z')); // 09.00 WITA
  await page.reload();
  await expect(page.getByText('Paket Kamis, 26 November 2026')).toBeVisible();
  await expect(stat(page, 'stat-responses')).toHaveText('0/50');
  await page.getByRole('button', { name: /Lanjutkan Rabu, 25 November 2026/ }).click();
  await expect(page.getByText('Paket Rabu, 25 November 2026')).toBeVisible();
  await expect(stat(page, 'stat-responses')).toHaveText('1/50');
  await expect(page.getByText('jawaban sesi lama')).toBeVisible();

  await page.goto('./#/riwayat');
  await expect(page.getByTestId('history-item')).toHaveCount(2);
});

test('mulai ulang sesi butuh konfirmasi dan hanya menghapus sesi terpilih', async ({ page }) => {
  await importBank(page, bankFile(5));
  await page.goto('./#/latihan');
  const order = await stationTitles(page);
  await page.locator('#ans-clinical').fill('akan dihapus');
  await lock(page, 'clinical');
  await page.getByRole('button', { name: 'Mulai ulang sesi hari ini' }).click();
  await page.getByRole('button', { name: 'Batal' }).click();
  await expect(stat(page, 'stat-responses')).toHaveText('1/10');
  await page.getByRole('button', { name: 'Mulai ulang sesi hari ini' }).click();
  await page.getByRole('button', { name: 'Ya, hapus progres sesi ini' }).click();
  await expect(stat(page, 'stat-responses')).toHaveText('0/10');
  await expect(page.locator('#ans-clinical')).toHaveValue('');
  await page.reload();
  await expect(stat(page, 'stat-responses')).toHaveText('0/10');
  expect(await stationTitles(page)).toEqual(order);
});

test('impor ZIP: aset hilang ditandai belum layak; penampil gambar dengan label netral, zoom, fullscreen', async ({ page }) => {
  const zip = readFileSync('public/examples/contoh-paket-demo.zip');
  await importBank(page, { name: 'contoh.zip', mimeType: 'application/zip', buffer: zip });
  await expect(page.getByTestId('report-eligible')).toHaveText('1');
  await expect(page.getByTestId('report-not-eligible')).toHaveText('1');
  await expect(page.getByTestId('import-report')).toContainText('tidak ditemukan');

  await page.goto('./#/latihan');
  await page.getByRole('button', { name: 'Coba Paket Demo' }).click();
  // Paket demo = 3 bawaan + 1 dari ZIP yang layak (yang asetnya hilang tidak masuk)
  await expect(stat(page, 'stat-station')).toHaveText('1/4');
  const titles = await stationTitles(page);
  expect(titles.some((t) => t.includes('aset hilang'))).toBe(false);
  const idx = titles.findIndex((t) => t.includes('Demo D'));
  await page.locator('.station-strip .chip').nth(idx).click();
  await expect(page.getByTestId('submit-clinical')).toHaveText(/lanjut ke imaging/);
  await lock(page, 'clinical');
  await expect(page.getByTestId('image-label')).toHaveText('Gambar A — Uji A');
  await expect(page.getByTestId('image-caption')).toHaveCount(0);
  const img = page.locator('.zoom-box img');
  await expect(img).toHaveAttribute('src', /^blob:/);
  expect(await page.content()).not.toContain('uji-A.svg');
  await page.getByRole('button', { name: 'Perbesar' }).click();
  await expect(page.locator('.zoom-controls')).toContainText('140%');
  await page.getByRole('button', { name: 'Gambar berikutnya' }).click();
  await expect(page.getByTestId('image-label')).toHaveText('Gambar B — Uji B');
  await page.getByRole('button', { name: 'Layar penuh' }).click();
  await expect(page.locator('.fullscreen')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.fullscreen')).toHaveCount(0);
  await lock(page, 'followup');
  await expect(page.getByTestId('image-caption')).toBeVisible();
});

test('impor JSON tidak valid ditolak dengan alasan', async ({ page }) => {
  await importBank(page, { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('[{"id":"tanpa-isi"}]') });
  await expect(page.getByTestId('report-rejected')).toHaveText('1');
  await expect(page.getByTestId('import-report')).toContainText('"vignette" wajib diisi');
});

test('cadangan: ekspor lalu impor ke browser baru', async ({ page, browser }) => {
  await importBank(page, bankFile(3));
  await page.goto('./#/latihan');
  await page.locator('#ans-clinical').fill('isi cadangan');
  await lock(page, 'clinical');
  await page.goto('./#/riwayat');
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Ekspor cadangan' }).click();
  const file = await (await dl).path();

  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await p2.clock.setFixedTime(T_1000_WITA);
  await p2.goto('./#/riwayat');
  await p2.locator('input[type=file]').setInputFiles(file);
  await expect(p2.getByText(/Dipulihkan: 1 sesi/)).toBeVisible();
  await p2.getByRole('button', { name: 'Lanjutkan' }).click();
  await expect(p2.getByText('isi cadangan')).toBeVisible();
  await ctx.close();
});

test('offline: setelah dimuat sekali, aplikasi dan progres tetap tersedia', async ({ page, context }) => {
  await importBank(page, bankFile(4));
  await page.goto('./#/latihan');
  await page.locator('#ans-clinical').fill('draft offline');
  await page.waitForTimeout(700);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload(); // halaman kini dikendalikan service worker
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText('Offline')).toBeVisible();
  await expect(page.locator('#ans-clinical')).toHaveValue('draft offline');
  await lock(page, 'clinical');
  await expect(stat(page, 'stat-responses')).toHaveText('1/8');
  await page.goto('./#/riwayat');
  await expect(page.getByTestId('history-item')).toHaveCount(1);
  await context.setOffline(false);
});

import { expect, test } from '@playwright/test';

test('tata letak iPhone: navigasi bawah, vignette & tombol lanjut terlihat, tanpa scroll horizontal', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-25T02:00:00Z'));
  await page.goto('./');
  await page.getByRole('button', { name: 'Coba Paket Demo' }).click();
  await expect(page.locator('.nav-bottom')).toBeVisible();
  await expect(page.locator('.nav-top')).toBeHidden();
  await expect(page.getByText('Vignette')).toBeVisible();
  await expect(page.getByTestId('submit-clinical')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({ path: 'test-results/iphone-latihan.png', fullPage: false });
});

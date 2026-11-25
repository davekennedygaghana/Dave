// Render public/icons/icon.svg menjadi PNG (192, 512, maskable, apple-touch) memakai Chromium/Playwright.
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const svg = readFileSync('public/icons/icon.svg', 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
const targets = [
  { file: 'public/icons/icon-192.png', size: 192, pad: 0 },
  { file: 'public/icons/icon-512.png', size: 512, pad: 0 },
  { file: 'public/icons/icon-maskable-512.png', size: 512, pad: 0.12, bg: '#0f4c5c' },
  { file: 'public/icons/apple-touch-icon.png', size: 180, pad: 0.06, bg: '#0f4c5c' },
];
for (const t of targets) {
  await page.setViewportSize({ width: t.size, height: t.size });
  const inner = Math.round(t.size * (1 - 2 * t.pad));
  await page.setContent(
    `<html><body style="margin:0;background:${t.bg ?? 'transparent'};display:flex;align-items:center;justify-content:center;width:${t.size}px;height:${t.size}px">
     <div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body></html>`,
  );
  await page.screenshot({ path: t.file, omitBackground: !t.bg });
  console.log('ditulis', t.file);
}
await browser.close();

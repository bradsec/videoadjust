// Renders scripts/og-image.html to public/og-image.png (1200x630) for link previews.
// Usage: node scripts/render-og.mjs
import { chromium } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pageUrl = pathToFileURL(path.join(root, 'scripts/og-image.html')).href;
const out = path.join(root, 'public/og-image.png');

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.goto(pageUrl);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: out });
  console.log(path.relative(root, out));
} finally {
  await browser.close();
}

// Renders docs/mockups/overhaul.html to PNGs for owner review.
// Usage: node scripts/render-overhaul.mjs
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'docs/mockups/overhaul');
const pageUrl = pathToFileURL(path.join(root, 'docs/mockups/overhaul.html')).href;
mkdirSync(outDir, { recursive: true });

const devices = {
  phone: { width: 390, height: 844, scale: 2 },
  tablet: { width: 820, height: 1180, scale: 2 },
  desktop: { width: 1440, height: 900, scale: 1 },
};

// Dark is the default theme. Desktop Prepare shots open Adjust with one
// override so the owner sees the changed-setting and reset pattern.
const shots = [
  ...['drop', 'prepare', 'prepare-audio', 'progress', 'result', 'result-audio'].map((screen) => ({
    device: 'phone',
    screen,
  })),
  { device: 'tablet', screen: 'prepare' },
  { device: 'desktop', screen: 'drop' },
  { device: 'desktop', screen: 'prepare' },
  { device: 'desktop', screen: 'result' },
  { device: 'phone', screen: 'prepare', theme: 'light' },
  { device: 'desktop', screen: 'prepare', theme: 'light' },
];

const browser = await chromium.launch();
try {
  for (const { device, screen, theme = 'dark' } of shots) {
    const d = devices[device];
    const context = await browser.newContext({
      viewport: { width: d.width, height: d.height },
      deviceScaleFactor: d.scale,
      colorScheme: theme,
    });
    const page = await context.newPage();
    await page.goto(pageUrl);
    const adjusted = device === 'desktop' && screen.startsWith('prepare');
    await page.evaluate(
      ({ screen, theme, adjusted }) => {
        const html = document.documentElement;
        html.dataset.screen = screen;
        html.dataset.shot = '';
        if (theme === 'light') html.dataset.theme = 'light';
        if (adjusted) {
          html.dataset.variant = 'adjusted';
          document.querySelector(`#${screen} details.adjust`).open = true;
        }
      },
      { screen, theme, adjusted },
    );
    const name = `${device}-${screen}${theme === 'light' ? '-light' : ''}.png`;
    await page.screenshot({ path: path.join(outDir, name), fullPage: true });
    console.log(name);
    await context.close();
  }
} finally {
  await browser.close();
}

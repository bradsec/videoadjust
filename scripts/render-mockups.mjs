// Renders docs/mockups/mockup.html to PNGs for owner review.
// Usage: node scripts/render-mockups.mjs
import { chromium } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'docs/mockups');
const pageUrl = pathToFileURL(path.join(outDir, 'mockup.html')).href;

const devices = {
  phone: { width: 390, height: 844, scale: 2 },
  tablet: { width: 820, height: 1180, scale: 2 },
  desktop: { width: 1440, height: 900, scale: 1 },
};

// Desktop shows each Prepare screen with Adjust open and one override, so
// the owner sees the override and reset pattern; narrower screens keep it
// collapsed. The no-audio variant shows the Extract audio tab disabled.
const shots = [
  ...['phone', 'tablet', 'desktop'].flatMap((device) =>
    ['drop', 'prepare', 'result', 'prepare-audio', 'result-audio'].map((screen) => ({
      device,
      screen,
    })),
  ),
  { device: 'phone', screen: 'prepare', theme: 'dark' },
  { device: 'desktop', screen: 'prepare', theme: 'dark' },
  { device: 'phone', screen: 'prepare-audio', theme: 'dark' },
  { device: 'phone', screen: 'prepare', variant: 'no-audio' },
  { device: 'phone', screen: 'progress' },
  { device: 'phone', screen: 'notices' },
];

const browser = await chromium.launch();
try {
  for (const { device, screen, theme = 'light', variant } of shots) {
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
      ({ screen, adjusted, variant }) => {
        document.documentElement.dataset.screen = screen;
        if (variant) document.documentElement.dataset.variant = variant;
        if (adjusted) {
          document.documentElement.dataset.variant = 'adjusted';
          document.querySelector(`#${screen} details.adjust`).open = true;
        }
      },
      { screen, adjusted, variant },
    );
    const name = `${device}-${screen}${variant ? `-${variant}` : ''}${theme === 'dark' ? '-dark' : ''}.png`;
    await page.screenshot({ path: path.join(outDir, name), fullPage: true });
    console.log(name);
    await context.close();
  }
} finally {
  await browser.close();
}

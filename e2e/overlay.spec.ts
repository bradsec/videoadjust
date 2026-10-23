import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { ConvertResult, GifResult } from './harness';
import type { GifSettings } from '../src/core/gifExport';
import type { Overlays } from '../src/core/overlays';
import type { Settings } from '../src/core/types';

const fixture = new URL('../tests/fixtures/crop-bands.mp4', import.meta.url).pathname;

// A magenta box in the top-left corner; the fixture has only red, green and blue bands.
function boxOverlay(): Overlays {
  return {
    text: {
      enabled: true,
      content: 'Hi',
      font: 'Inter',
      weight: 700,
      color: '#ffffff',
      fontSize: 0.2,
      boxWidth: 0.4,
      maxHeight: 0.4,
      autoFit: false,
      align: 'center',
      legibility: 'box',
      legibilityColor: '#ff00ff',
      legibilityOpacity: 1,
      anchor: 'top-left',
      margin: 0.05,
      position: null,
      opacity: 1,
    },
    image: {
      enabled: false,
      scale: 0.25,
      anchor: 'top-right',
      margin: 0.04,
      position: null,
      opacity: 1,
    },
  };
}

// Just inside the box corner, and two points well outside it.
const points: [number, number][] = [
  [0.07, 0.07],
  [0.5, 0.9],
  [0.9, 0.9],
];

const magenta = ([r, g, b]: number[]) => r! > 180 && b! > 180 && g! < 90;

const base: Settings = {
  container: 'mp4',
  passthrough: false,
  trim: { start: 0, end: 1 },
  video: { codec: 'avc', width: 640, height: 360, fps: 30, bitrate: 800_000 },
  audio: null,
};

async function load(page: Page) {
  await page.goto('/e2e/harness.html');
  await page.setInputFiles('#file', fixture);
}

function ok<T extends ConvertResult | GifResult>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error(`${r.error.name}: ${r.error.message}`);
  return r as Extract<T, { ok: true }>;
}

test('burns a text overlay into a Shrink export at its anchor only', async ({ page }) => {
  await load(page);
  const result = ok(
    await page.evaluate(([s, p]) => window.vrHarness.convertToMemory(s, 'never', true, p), [
      { ...base, overlays: boxOverlay() },
      points,
    ] as const),
  );
  const [corner, middle, right] = result.pixelSamples!;
  expect(magenta(corner!)).toBe(true);
  expect(magenta(middle!)).toBe(false);
  expect(magenta(right!)).toBe(false);
});

test('places overlays in output space after rotation and crop', async ({ page }) => {
  await load(page);
  const result = ok(
    await page.evaluate(([s, p]) => window.vrHarness.convertToMemory(s, 'never', true, p), [
      {
        ...base,
        video: { ...base.video!, width: 360, height: 360 },
        transform: { rotate: 90, flip: true, crop: 'square' },
        overlays: boxOverlay(),
      },
      points,
    ] as const),
  );
  expect(result.output.video).toMatchObject({ displayWidth: 360, displayHeight: 360 });
  const [corner, middle] = result.pixelSamples!;
  expect(magenta(corner!)).toBe(true);
  expect(magenta(middle!)).toBe(false);
});

test('burns the same overlay into a GIF', async ({ page }) => {
  await load(page);
  const settings: GifSettings = {
    trim: { start: 0, end: 1 },
    size: 320,
    fps: 5,
    loop: 'forever',
    colors: 128,
    compression: 'balanced',
  };
  const result = ok(
    await page.evaluate(([s, o, p]) => window.vrHarness.exportGif(s, undefined, o, p), [
      settings,
      boxOverlay(),
      points,
    ] as const),
  );
  const [corner, middle, right] = result.pixelSamples;
  expect(magenta(corner!)).toBe(true);
  expect(magenta(middle!)).toBe(false);
  expect(magenta(right!)).toBe(false);
});

// The editor draws asynchronously after fonts load, so wait until the box stops moving.
async function settledBox(locator: Locator) {
  let previous = '';
  await expect
    .poll(
      async () => {
        const next = JSON.stringify(await locator.boundingBox());
        const same = next === previous;
        previous = next;
        return same;
      },
      { intervals: [150] },
    )
    .toBe(true);
  return JSON.parse(previous) as { x: number; y: number; width: number; height: number };
}

test(
  'overlay controls enable text, and the editor shows and moves it',
  { tag: '@mobile' },
  async ({ page }) => {
    await page.goto('/');
    await page.setInputFiles(
      '#file',
      new URL('../tests/fixtures/land-1080p30-aac.mp4', import.meta.url).pathname,
    );
    const card = page.getByRole('region', { name: 'Export summary' });
    await expect(card).toBeVisible();
    await page.locator('.overlay-adjust > summary').click();
    // Nothing to move yet, so the editor is not offered.
    await expect(page.getByRole('button', { name: 'Position overlay' })).toBeHidden();
    await page.getByLabel('Text overlay', { exact: true }).check();
    await expect(page.getByRole('button', { name: 'Position overlay' })).toBeHidden();
    await page.getByLabel('Overlay text', { exact: true }).fill('Hello there');
    await page.getByLabel('Overlay text', { exact: true }).blur();
    await expect(card).toContainText('1 change');
    await page.getByRole('button', { name: 'Position overlay' }).click();
    const selection = page.getByRole('button', { name: 'Move text overlay' });
    await expect(selection).toBeVisible();
    const before = await settledBox(selection);
    await selection.focus();
    await page.keyboard.press('Shift+ArrowLeft');
    await expect.poll(async () => (await selection.boundingBox())!.x).toBeLessThan(before.x);
    const box = await settledBox(selection);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 40);
    await page.mouse.up();
    await expect.poll(async () => (await selection.boundingBox())!.y).toBeLessThan(box.y);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  },
);

test('an uploaded SVG overlay shows in the editor and survives a GIF export', async ({ page }) => {
  test.setTimeout(90_000);
  // Keep the result in memory; Chromium would otherwise open a save picker.
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
    delete (Window.prototype as unknown as Record<string, unknown>).showSaveFilePicker;
  });
  await page.goto('/');
  await page.setInputFiles(
    '#file',
    new URL('../tests/fixtures/crop-bands.mp4', import.meta.url).pathname,
  );
  await page.locator('.overlay-adjust > summary').click();
  await page.getByLabel('Image overlay', { exact: true }).check();
  await page.getByLabel('Overlay image', { exact: true }).setInputFiles({
    name: 'logo.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#ff00ff"/></svg>',
    ),
  });
  await page.getByRole('button', { name: 'Position overlay' }).click();
  await expect(page.getByRole('button', { name: 'Move image overlay' })).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).last().click();
  await page.getByRole('tab', { name: 'GIF' }).click();
  await page.getByRole('tabpanel').getByRole('button', { name: 'Export GIF' }).click();
  await expect(page.getByRole('img', { name: /GIF preview/i })).toBeVisible({ timeout: 60_000 });
});

test('a user font is validated, used, kept across a reload, and removable', async ({ page }) => {
  const fontFile = new URL(
    '../node_modules/@fontsource/caveat/files/caveat-latin-400-normal.woff2',
    import.meta.url,
  ).pathname;
  await page.goto('/');
  await page.setInputFiles('#file', fixture);
  await page.locator('.overlay-adjust > summary').click();
  await page.getByLabel('Text overlay', { exact: true }).check();
  const add = page.getByLabel('Add your font', { exact: true });
  await add.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('x') });
  await expect(page.getByText('Choose a TTF, OTF, WOFF or WOFF2 font file.')).toBeVisible();
  await add.setInputFiles({ name: 'broken.ttf', mimeType: 'font/ttf', buffer: Buffer.from('x') });
  await expect(page.getByText('This file is not a font the browser can use.')).toBeVisible();
  await add.setInputFiles({
    name: 'My Hand.woff2',
    mimeType: 'font/woff2',
    buffer: readFileSync(fontFile),
  });
  const font = page.getByLabel('Text font', { exact: true });
  await expect(font.locator('option:checked')).toHaveText('My Hand (your font)');

  await page.reload();
  await page.setInputFiles('#file', fixture);
  await page.locator('.overlay-adjust > summary').click();
  await page.getByLabel('Text overlay', { exact: true }).check();
  await expect(font.locator('option', { hasText: 'My Hand (your font)' })).toHaveCount(1);
  await font.selectOption({ label: 'My Hand (your font)' });
  await page.getByRole('button', { name: 'Remove this font' }).click();
  await expect(font.locator('option', { hasText: 'My Hand (your font)' })).toHaveCount(0);
  await expect(font).toHaveValue('Inter');
});

test('the text effect can be turned off', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('#file', fixture);
  await page.locator('.overlay-adjust > summary').click();
  await page.getByLabel('Text overlay', { exact: true }).check();
  const effect = page.getByLabel('Text effect', { exact: true });
  await expect(effect).toHaveValue('outline');
  await expect(page.getByLabel('Effect colour', { exact: true })).toBeVisible();
  await effect.selectOption({ label: 'No effect' });
  await expect(page.getByLabel('Effect colour', { exact: true })).toBeHidden();
});

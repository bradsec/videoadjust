import { expect, test } from '@playwright/test';
import type { GifResult } from './harness';
import type { GifSettings } from '../src/core/gifExport';

const fixture = new URL('../tests/fixtures/crop-bands.mp4', import.meta.url).pathname;

function ok(result: GifResult): Extract<GifResult, { ok: true }> {
  if (!result.ok) throw new Error(`${result.error.name}: ${result.error.message}`);
  return result;
}

test('encodes a cropped GIF with the requested size, frames, and centre colour', async ({
  page,
}) => {
  await page.goto('/e2e/harness.html');
  await page.setInputFiles('#file', fixture);
  const settings: GifSettings = {
    trim: { start: 0, end: 1 },
    size: 320,
    fps: 5,
    loop: 'forever',
    colors: 256,
    compression: 'balanced',
  };
  const result = ok(
    await page.evaluate(
      (value) => window.vrHarness.exportGif(value, { rotate: 0, flip: false, crop: 'square' }),
      settings,
    ),
  );
  expect(result).toMatchObject({ width: 320, height: 320, frames: 5, lastProgress: 1 });
  expect(result.outputBytes).toBeGreaterThan(0);
  expect(result.pixelSamples).toHaveLength(3);
  for (const [red, green, blue] of result.pixelSamples) {
    expect(green).toBeGreaterThan(red + 35);
    expect(green).toBeGreaterThan(blue + 35);
  }
});

test('GIF tab shows settings and exports an image result', { tag: '@mobile' }, async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    const windowWithPicker = window as unknown as Record<string, unknown>;
    delete windowWithPicker.showSaveFilePicker;
    delete (Window.prototype as unknown as Record<string, unknown>).showSaveFilePicker;
  });
  await page.goto('/');
  await page.setInputFiles('#file', fixture);
  const tab = page.getByRole('tab', { name: 'GIF' });
  await expect(tab).toBeVisible();
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  const panel = page.getByRole('tabpanel');
  await expect(panel.getByRole('button', { name: 'Export GIF' })).toBeVisible();
  await panel.locator('summary').click();
  const size = panel.getByLabel('Size', { exact: true });
  const fps = panel.getByLabel('Frame rate', { exact: true });
  await expect(size).toBeVisible();
  await expect(fps).toBeVisible();
  await size.selectOption('320');
  await fps.selectOption('5');
  await panel.getByRole('button', { name: 'Export GIF' }).click();
  const result = page.getByRole('img', { name: /GIF preview/i });
  await expect(result).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('link', { name: /Download .*\.gif/i })).toBeVisible();
});

test(
  'a blocked GIF export says why beside the docked action',
  { tag: '@mobile' },
  async ({ page, isMobile }) => {
    await page.goto('/');
    await page.setInputFiles(
      '#file',
      new URL('../tests/fixtures/long-31s.mp4', import.meta.url).pathname,
    );
    await page.getByRole('tab', { name: 'GIF' }).click();
    const panel = page.getByRole('tabpanel');
    await expect(panel.getByRole('button', { name: 'Export GIF' })).toBeDisabled();
    const warning = panel.locator('.export-warning');
    await expect(warning).toContainText('at most 30 seconds');
    const note = panel.locator('.dock-note');
    if (!isMobile) return;
    await expect(note).toBeVisible();
    await note.getByRole('button', { name: 'See why' }).click();
    await expect(warning).toBeFocused();
    await expect(warning).toBeInViewport();
  },
);

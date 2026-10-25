import AxeBuilder from '@axe-core/playwright';
import { openSection } from './sections';
import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const fixture = new URL('../tests/fixtures/land-1080p30-aac.mp4', import.meta.url).pathname;

test.setTimeout(120_000);

async function load(page: Page) {
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
    delete (Window.prototype as unknown as Record<string, unknown>).showSaveFilePicker;
  });
  await page.goto('/');
  await page.setInputFiles('#file', fixture);
  await expect(page.getByRole('tablist', { name: 'Tool' })).toBeVisible();
}

async function openShrinkAdjust(page: Page) {
  const shrink = page.getByRole('region', { name: 'Export summary' });
  const reencode = shrink.getByRole('checkbox', { name: 'Re-encode anyway' });
  if (await reencode.isVisible()) await reencode.check();
  await shrink.locator('summary').click();
  return shrink;
}

test('preview applies gain and loudness normalization', async ({ page }) => {
  await page.addInitScript(() => {
    const original = AudioParam.prototype.setTargetAtTime;
    AudioParam.prototype.setTargetAtTime = function (value, startTime, timeConstant) {
      (window as Window & { lastPreviewGain?: number }).lastPreviewGain = value;
      return original.call(this, value, startTime, timeConstant);
    };
  });
  await load(page);
  await openShrinkAdjust(page);
  await openSection(page, 'audio');
  const gain = page.getByLabel('Gain (dB)', { exact: true });
  await gain.fill('-6');
  await gain.blur();
  await expect
    .poll(() =>
      page.locator('.preview-video').evaluate((video: HTMLVideoElement) => video.readyState),
    )
    .toBeGreaterThanOrEqual(2);
  await page.locator('body').evaluate((body) => {
    body.tabIndex = -1;
    body.focus();
  });
  await page.keyboard.press('Space');
  const recordedGain = () =>
    page.evaluate(() => (window as Window & { lastPreviewGain?: number }).lastPreviewGain);
  const expectedGain = 10 ** (-6 / 20);
  await expect.poll(recordedGain, { timeout: 15_000 }).toBeCloseTo(expectedGain, 3);

  await page.getByLabel('Normalize loudness').selectOption('-16');
  await expect
    .poll(
      async () => {
        const value = await recordedGain();
        return (
          value !== undefined && Number.isFinite(value) && Math.abs(value - expectedGain) > 0.01
        );
      },
      { timeout: 30_000 },
    )
    .toBe(true);
});

test('Shrink exports with gain, fades and normalization', async ({ page }) => {
  await load(page);
  const shrink = await openShrinkAdjust(page);
  await openSection(page, 'audio');
  const gain = page.getByLabel('Gain (dB)', { exact: true });
  await gain.fill('-6');
  await gain.blur();
  const fadeIn = page.getByLabel('Fade in (seconds)', { exact: true });
  await fadeIn.fill('0.5');
  await fadeIn.blur();
  const fadeOut = page.getByLabel('Fade out (seconds)', { exact: true });
  await fadeOut.fill('0.5');
  await fadeOut.blur();
  await page.getByLabel('Normalize loudness').selectOption('-16');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await shrink.getByRole('button', { name: /^Export/ }).click();
  await expect(page.getByRole('link', { name: /Download .*\.mp4/i })).toBeVisible({
    timeout: 90_000,
  });
});

test('Extract audio exports WAV with processing', async ({ page }) => {
  await load(page);
  await page.getByRole('tab', { name: 'Extract audio' }).click();
  const audio = page.getByRole('region', { name: 'Audio summary' });
  await audio.locator('summary').click();
  await audio.getByRole('radio', { name: /WAV/ }).check();
  await openSection(page, 'audio');
  const fadeIn = page.getByLabel('Fade in (seconds)', { exact: true });
  await fadeIn.fill('0.5');
  await fadeIn.blur();
  await page.getByLabel('Normalize loudness').selectOption('-23');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await audio.getByRole('button', { name: 'Extract audio' }).click();
  await expect(page.getByRole('link', { name: /Download .*\.wav/i })).toBeVisible({
    timeout: 90_000,
  });
});

test('Reset audio processing restores neutral gain', async ({ page }) => {
  await load(page);
  await openShrinkAdjust(page);
  await openSection(page, 'audio');
  const gain = page.getByLabel('Gain (dB)', { exact: true });
  const reset = page.getByRole('button', { name: 'Reset audio processing' });
  await expect(reset).toBeHidden();
  await gain.fill('-6');
  await gain.blur();
  await expect(reset).toBeVisible();
  await reset.click();
  await expect(reset).toBeHidden();
  await expect(gain).toHaveValue('0');
});

test('colour correction changes the preview with Style None and resets', async ({ page }) => {
  await load(page);
  await page.locator('.style-adjust > summary').click();
  const style = page.getByLabel('Video style', { exact: true });
  await expect(style).toBeEnabled();
  await style.selectOption('none');
  await expect
    .poll(() =>
      page.locator('.preview-video').evaluate((video: HTMLVideoElement) => video.readyState),
    )
    .toBeGreaterThanOrEqual(2);
  const frame = page.locator('.live-preview-frame');
  const before = await frame.screenshot();
  await openSection(page, 'colour');
  const exposure = page.getByLabel('Exposure (stops)', { exact: true });
  await exposure.evaluate((input: HTMLInputElement) => {
    input.value = '1';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(exposure).toHaveValue('1');
  await expect(style).toHaveValue('none');
  await expect(page.locator('.live-preview-style')).toBeVisible();
  await expect.poll(async () => !(await frame.screenshot()).equals(before)).toBe(true);
  const reset = page.getByRole('button', { name: 'Reset colour correction' });
  await expect(reset).toBeVisible();
  await reset.click();
  await expect(reset).toBeHidden();
  await expect(exposure).toHaveValue('0');
  await expect(page.getByLabel('Contrast', { exact: true })).toHaveValue('1');
  await expect(page.getByLabel('Saturation', { exact: true })).toHaveValue('1');
  await expect(page.getByLabel('Temperature', { exact: true })).toHaveValue('0');
});

test('Trim precision Exact exports MP4', async ({ page }) => {
  await load(page);
  const shrink = await openShrinkAdjust(page);
  await shrink.getByLabel('Trim precision', { exact: true }).selectOption('exact');
  await expect(shrink.getByLabel('Trim precision', { exact: true })).toHaveValue('exact');
  await shrink.getByRole('button', { name: /^Export/ }).click();
  await expect(page.getByRole('link', { name: /Download .*\.mp4/i })).toBeVisible({
    timeout: 90_000,
  });
});

test('Save current frame downloads valid PNG and JPEG files', async ({ page }) => {
  await load(page);
  await expect
    .poll(() =>
      page.locator('.preview-video').evaluate((video: HTMLVideoElement) => video.readyState),
    )
    .toBeGreaterThanOrEqual(2);
  const edit = page.getByRole('region', { name: 'Edit', exact: true });
  const pngDownload = page.waitForEvent('download');
  await edit.getByRole('button', { name: 'Save frame as PNG' }).click();
  const png = await pngDownload;
  expect(png.suggestedFilename()).toMatch(/-frame-\d+\.\d{3}\.png$/);
  const pngPath = await png.path();
  expect(pngPath).not.toBeNull();
  const pngBytes = await readFile(pngPath!);
  expect([...pngBytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(pngBytes.toString('ascii', 12, 16)).toBe('IHDR');
  expect(pngBytes.readUInt32BE(16)).toBeGreaterThan(0);
  expect(pngBytes.readUInt32BE(20)).toBeGreaterThan(0);
  // The confirmation floats as a toast: announced politely, focus stays on the button.
  const toast = page.locator('.toasts .toast', { hasText: /\.png saved\.$/ });
  await expect(toast).toBeVisible();
  await expect(page.locator('.toasts')).toHaveAttribute('aria-live', 'polite');
  await expect(edit.getByRole('button', { name: 'Save frame as PNG' })).toBeFocused();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await toast.getByRole('button', { name: 'Dismiss notification' }).click();
  await expect(toast).toHaveCount(0);

  const jpegDownload = page.waitForEvent('download');
  await edit.getByRole('button', { name: 'Save frame as JPEG' }).click();
  const jpeg = await jpegDownload;
  expect(jpeg.suggestedFilename()).toMatch(/-frame-\d+\.\d{3}\.jpg$/);
  const jpegPath = await jpeg.path();
  expect(jpegPath).not.toBeNull();
  const jpegBytes = await readFile(jpegPath!);
  expect([...jpegBytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
});

test('result warns when the style renderer becomes unavailable during export', async ({ page }) => {
  // The preview and capability probe render on <canvas>; only export uses OffscreenCanvas.
  await page.addInitScript(() => {
    const original = OffscreenCanvas.prototype.getContext;
    OffscreenCanvas.prototype.getContext = function (
      this: OffscreenCanvas,
      type: string,
      ...rest: unknown[]
    ) {
      if (type === 'webgl2') return null;
      return (original as (...args: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof original;
  });
  await load(page);
  await page.locator('.style-adjust > summary').click();
  const style = page.getByLabel('Video style', { exact: true });
  await expect(style).toBeEnabled();
  await style.selectOption('mono');
  await page
    .getByRole('region', { name: 'Export summary' })
    .getByRole('button', { name: /^Export/ })
    .click();
  await expect(page.getByRole('link', { name: /Download .*\.mp4/i })).toBeVisible({
    timeout: 90_000,
  });
  await expect(
    page.getByText(
      'The export was saved without the selected style or colour correction because the graphics renderer became unavailable.',
    ),
  ).toHaveCount(1);
});

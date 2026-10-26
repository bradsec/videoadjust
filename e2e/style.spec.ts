import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const fixture = new URL('../tests/fixtures/crop-bands.mp4', import.meta.url).pathname;

async function rgbGrids(page: Page, first: Buffer, second: Buffer): Promise<number[][]> {
  return page.evaluate(
    async ([a, b]) => {
      const grids = await Promise.all(
        [a, b].map(async (b64) => {
          const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
          const canvas = new OffscreenCanvas(12, 12);
          const context = canvas.getContext('2d')!;
          context.drawImage(bitmap, 0, 0, 12, 12);
          bitmap.close();
          const pixels = context.getImageData(0, 0, 12, 12).data;
          return Array.from(
            { length: 3 * 144 },
            (_, i) => pixels[(i % 144) * 4 + Math.floor(i / 144)],
          );
        }),
      );
      return grids;
    },
    [first, second].map((png) => png.toString('base64')),
  );
}

test('canvas preview keeps CSS video framing through rotation, mirroring, crop and metadata', async ({
  page,
}) => {
  test.setTimeout(90_000);
  for (const { file, rotation, mirror, crop } of [
    { file: 'crop-bands.mp4', rotation: '90', mirror: true, crop: null },
    { file: 'portrait-rot90.mp4', rotation: null, mirror: true, crop: null },
    { file: 'crop-bands.mp4', rotation: '180', mirror: true, crop: null },
    { file: 'crop-bands.mp4', rotation: '90', mirror: false, crop: 'square' },
  ]) {
    await page.goto('/');
    await page.setInputFiles(
      '#file',
      new URL(`../tests/fixtures/${file}`, import.meta.url).pathname,
    );
    await expect(page.getByRole('region', { name: 'Export summary' })).toBeVisible();
    const video = page.locator('.preview-video');
    await expect
      .poll(() => video.evaluate((node: HTMLVideoElement) => node.readyState))
      .toBeGreaterThanOrEqual(2);
    if (rotation || mirror || crop) {
      await page.getByRole('button', { name: 'Crop and rotate' }).click();
      if (rotation) await page.getByLabel('Editor rotation').selectOption(rotation);
      if (mirror) await page.getByLabel('Editor mirror').check();
      if (crop) await page.getByLabel('Crop aspect ratio').selectOption(crop);
      await page
        .getByRole('region', { name: 'Crop and rotate editor' })
        .getByRole('button', { name: 'Done' })
        .click();
    }
    await video.evaluate(
      (node: HTMLVideoElement) =>
        new Promise<void>((resolve) => {
          node.pause();
          node.addEventListener('seeked', () => resolve(), { once: true });
          node.currentTime = 0.5;
        }),
    );
    await expect
      .poll(() => video.evaluate((node: HTMLVideoElement) => node.readyState))
      .toBeGreaterThanOrEqual(2);
    const frame = page.locator('.live-preview-frame');
    const canvas = page.locator('.live-preview-style');
    await expect(canvas).toBeHidden();
    await expect(video).toBeVisible();
    const original = await frame.screenshot();
    const summary = page.getByRole('region', { name: 'Export summary' });
    await summary.locator('summary').click();
    await summary.getByLabel('Frame rate', { exact: true }).selectOption({ label: '15 fps' });
    await expect(canvas).toBeVisible();
    const processed = await frame.screenshot();
    expect([processed.readUInt32BE(16), processed.readUInt32BE(20)]).toEqual([
      original.readUInt32BE(16),
      original.readUInt32BE(20),
    ]);
    const [x, y] = await rgbGrids(page, processed, original);
    if (crop) {
      for (const grid of [x, y]) {
        for (let channel = 0; channel < 3; channel++) {
          const values = grid.slice(channel * 144, (channel + 1) * 144);
          expect(Math.max(...values) - Math.min(...values), file).toBeLessThan(25);
        }
      }
    } else {
      const xMean = x.reduce((sum, value) => sum + value, 0) / x.length;
      const yMean = y.reduce((sum, value) => sum + value, 0) / y.length;
      let covariance = 0;
      let xVariance = 0;
      let yVariance = 0;
      for (let i = 0; i < x.length; i++) {
        const dx = x[i] - xMean;
        const dy = y[i] - yMean;
        covariance += dx * dy;
        xVariance += dx * dx;
        yVariance += dy * dy;
      }
      expect(covariance / Math.sqrt(xVariance * yVariance), file).toBeGreaterThan(0.95);
    }
  }
});

test('Video Style updates the preview and exports styled video', async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
    delete (Window.prototype as unknown as Record<string, unknown>).showSaveFilePicker;
  });
  await page.goto('/');
  await page.setInputFiles('#file', fixture);
  await expect(page.getByRole('region', { name: 'Export summary' })).toBeVisible();
  const style = page.getByLabel('Video style', { exact: true });
  await expect(style).toBeEnabled();
  await expect
    .poll(() =>
      page.locator('.preview-video').evaluate((video: HTMLVideoElement) => video.readyState),
    )
    .toBeGreaterThanOrEqual(2);
  const frame = page.locator('.live-preview-frame');
  const before = await frame.screenshot();
  await page.locator('.style-adjust > summary').click();
  await style.selectOption('mono');
  const canvas = page.locator('.live-preview-style');
  await expect(canvas).toBeVisible();
  await expect.poll(async () => !(await frame.screenshot()).equals(before)).toBe(true);
  await expect(page.getByRole('button', { name: 'Show original' })).toBeVisible();
  const intensity = page.getByRole('slider', { name: 'Style intensity' });
  await intensity.focus();
  await intensity.press('ArrowLeft');
  await expect(intensity).toBeFocused();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page
    .getByRole('region', { name: 'Export summary' })
    .getByRole('button', { name: /^Export/ })
    .click();
  await expect(page.getByRole('link', { name: /Download .*\.mp4/i })).toBeVisible({
    timeout: 60_000,
  });
});

test('preview label follows the selected style and original view', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('#file', fixture);
  const frame = page.locator('.live-preview-frame');
  const label = frame.locator('.live-preview-label');
  const style = page.getByLabel('Video style', { exact: true });
  await page.locator('.style-adjust > summary').click();
  await expect(label).toBeHidden();

  await style.selectOption('cinematic');
  await expect(label).toHaveText('Cinematic grade');
  await expect(label).toBeVisible();
  await expect(label).toHaveAttribute('aria-hidden', 'true');
  await style.selectOption('diffusion');
  await expect(label).toHaveText('Soft diffusion / Black Pro-Mist');
  for (const viewport of [
    { width: 320, height: 640 },
    { width: 768, height: 844 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    const frameBox = (await frame.boundingBox())!;
    const labelBox = (await label.boundingBox())!;
    expect(labelBox.x).toBeGreaterThanOrEqual(frameBox.x);
    expect(labelBox.y).toBeGreaterThanOrEqual(frameBox.y);
    expect(labelBox.x + labelBox.width).toBeLessThanOrEqual(frameBox.x + frameBox.width);
    expect(labelBox.y + labelBox.height).toBeLessThanOrEqual(frameBox.y + frameBox.height);
  }
  await page.getByRole('button', { name: 'Theater mode' }).click();
  await expect(label).toBeVisible();
  const theaterFrame = (await frame.boundingBox())!;
  const theaterLabel = (await label.boundingBox())!;
  expect(theaterLabel.x + theaterLabel.width).toBeLessThanOrEqual(
    theaterFrame.x + theaterFrame.width,
  );

  await style.selectOption('mono');
  await expect(label).toHaveText('Black & white');
  await page.getByRole('button', { name: 'Show original' }).click();
  await expect(label).toHaveText('Original');
  await page.getByRole('button', { name: 'Show original' }).click();
  await expect(label).toHaveText('Black & white');
  await page.getByRole('button', { name: 'Crop and rotate' }).click();
  await expect(label).toBeHidden();
  await page.getByRole('region', { name: 'Crop and rotate editor' }).getByText('Done').click();
  await expect(label).toBeVisible();
  await style.selectOption('none');
  await expect(label).toBeHidden();
});

test('Video Style carries into GIF export', async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
    delete (Window.prototype as unknown as Record<string, unknown>).showSaveFilePicker;
  });
  await page.goto('/');
  await page.setInputFiles('#file', fixture);
  await page.getByRole('tab', { name: 'GIF', exact: true }).click();
  await page.locator('.style-adjust > summary').click();
  await page.getByLabel('Video style', { exact: true }).selectOption('duotone');
  await page.getByLabel('Shadow color').evaluate((input: HTMLInputElement) => {
    input.value = '#ff0000';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.locator('.live-preview-palette')).toBeVisible();
  const panel = page.getByRole('tabpanel');
  await panel.getByRole('button', { name: 'Export GIF' }).click();
  await expect(page.getByRole('link', { name: /Download .*\.gif/i })).toBeVisible({
    timeout: 60_000,
  });
});

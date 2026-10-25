import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const fixture = new URL('../tests/fixtures/crop-bands.mp4', import.meta.url).pathname;

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
  await expect(page.locator('.live-preview-style')).toBeVisible();
  const panel = page.getByRole('tabpanel');
  await panel.getByRole('button', { name: 'Export GIF' }).click();
  await expect(page.getByRole('link', { name: /Download .*\.gif/i })).toBeVisible({
    timeout: 60_000,
  });
});

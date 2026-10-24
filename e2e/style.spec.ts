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

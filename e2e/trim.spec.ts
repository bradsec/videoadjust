import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const fixture = new URL('../tests/fixtures/land-1080p30-aac.mp4', import.meta.url).pathname;

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('#file', fixture);
  await expect(page.getByRole('slider', { name: 'Start' })).toBeVisible();
});

test('keyboard changes trim and estimate', async ({ page }) => {
  const start = page.getByRole('slider', { name: 'Start' });
  const initialEstimate = await page.locator('.export-estimate-big').textContent();
  await start.focus();
  await page.keyboard.press('ArrowRight');
  await expect(start).toHaveAttribute('aria-valuenow', '0.1');
  await expect(page.locator('.trim-readout').first().locator('output')).toHaveText('0:00.1');
  await expect(page.locator('.trim-head')).toContainText('kept');
  await expect(page.locator('.export-estimate-big')).not.toHaveText(initialEstimate!);
});

test('pointer drag changes the start readout', async ({ page, isMobile }) => {
  const start = page.getByRole('slider', { name: 'Start' });
  const strip = page.locator('.trim-strip');
  const box = await strip.boundingBox();
  expect(box).not.toBeNull();
  await start.dispatchEvent('pointerdown', {
    pointerId: 1,
    pointerType: isMobile ? 'touch' : 'mouse',
    clientX: box!.x + 1,
  });
  await start.dispatchEvent('pointermove', {
    pointerId: 1,
    pointerType: isMobile ? 'touch' : 'mouse',
    clientX: box!.x + box!.width / 4,
  });
  await expect
    .poll(async () => Number(await start.getAttribute('aria-valuenow')))
    .toBeGreaterThan(0);
  await expect(page.locator('.trim-readout').first().locator('output')).not.toHaveText('0:00');
});

test('prepare screen has no accessibility violations', async ({ page }) => {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('unplayable preview keeps trim handles and disables playhead buttons', async ({ page }) => {
  await page.addInitScript(() => {
    const canPlayType = HTMLMediaElement.prototype.canPlayType;
    HTMLMediaElement.prototype.canPlayType = function (mime) {
      if (this.classList.contains('preview-video')) return '';
      return canPlayType.call(this, mime);
    };
  });
  await page.goto('/');
  await page.setInputFiles('#file', fixture);
  await expect(page.locator('.preview-note')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start here' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'End here' })).toBeDisabled();
  await expect(page.getByRole('slider', { name: 'Start' })).toBeEnabled();
  await expect(page.locator('.trim-thumbs canvas').first()).toBeVisible();
});

test('preview error falls back after the source was accepted', async ({ page }) => {
  await page.locator('.preview-video').dispatchEvent('error');
  await expect(page.locator('.preview-note')).toBeVisible();
  await expect(page.locator('.preview-video')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start here' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'End here' })).toBeDisabled();
});

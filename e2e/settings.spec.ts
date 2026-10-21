import { expect, test } from '@playwright/test';

const fixture = new URL('../tests/fixtures/land-1080p30-aac.mp4', import.meta.url).pathname;
const optimalFixture = new URL('../tests/fixtures/small-h264-lowbitrate.mp4', import.meta.url).pathname;

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('#file', fixture);
  await expect(page.getByRole('region', { name: 'Export summary' })).toBeVisible();
});

test('summary and controls track trim and overrides', async ({ page }) => {
  const card = page.getByRole('region', { name: 'Export summary' });
  await expect(card).toContainText('Ready to export');
  await expect(card).toContainText('MP4');
  await expect(card).toContainText('est.');
  await expect(card).toContainText('from');
  await expect(card.getByRole('button', { name: 'Export' })).toBeVisible();
  await card.locator('summary').click();
  await expect(card).toContainText('All automatic');
  await expect(card.getByLabel('Resolution', { exact: true })).toBeVisible();
  await expect(card.getByLabel('Frame rate', { exact: true })).toBeVisible();
  await expect(card.getByLabel('Quality', { exact: true })).toBeVisible();
  const before = await card.locator('.export-estimate-big').textContent();
  await page.getByRole('slider', { name: 'Start' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(card.locator('.export-estimate-big')).not.toHaveText(before!);
  await card.getByLabel('Quality', { exact: true }).evaluate((node) => {
    const slider = node as HTMLInputElement;
    slider.value = '50';
    slider.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(card).toContainText('1 change');
  await card.getByRole('button', { name: 'Reset Quality to auto' }).click();
  await expect(card).toContainText('All automatic');
});

test('audio removal and WebM selection stay valid', async ({ page }) => {
  const card = page.getByRole('region', { name: 'Export summary' });
  await card.locator('summary').click();
  await card.getByLabel('Audio codec', { exact: true }).selectOption('none');
  await expect(card.locator('h2')).toContainText('MP4');
  await expect(card.locator('.export-sub')).toContainText('no audio');
  await card.getByRole('button', { name: 'Reset Audio codec to auto' }).click();
  await expect(card.locator('.export-sub')).toContainText('AAC');
  const webm = card.getByLabel('Format', { exact: true }).locator('option[value="webm"]');
  if (await webm.isEnabled()) {
    await card.getByLabel('Format', { exact: true }).selectOption('webm');
    await expect(card.locator('h2')).toContainText('WEBM');
    await expect(card.locator('.export-sub')).toContainText('OPUS');
  }
});

test('unavailable codecs have a visible reason and other codecs warn', async ({ page }) => {
  const card = page.getByRole('region', { name: 'Export summary' });
  await card.locator('summary').click();
  const unavailable = card.getByLabel('Video codec', { exact: true }).locator('option:disabled');
  if (await unavailable.count()) await expect(card.locator('.setting-reason').first()).toBeVisible();
  const otherCodec = card.getByLabel('Video codec', { exact: true })
    .locator('option:not([disabled]):not([value="avc"])').first();
  if (await otherCodec.count()) {
    await card.getByLabel('Video codec', { exact: true }).selectOption((await otherCodec.getAttribute('value'))!);
    await expect(card.locator('.export-warning')).toBeVisible();
  }
});

test('already small video offers trim-only export', async ({ page }) => {
  await page.getByRole('button', { name: 'Choose another video' }).click();
  await page.setInputFiles('#file', optimalFixture);
  const card = page.getByRole('region', { name: 'Export summary' });
  await expect(card).toContainText('This video is already small');
  await expect(card).toContainText('trim this video');
  await expect(card.getByRole('button', { name: 'Export' })).toBeVisible();
});

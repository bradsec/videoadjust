import { expect, test } from '@playwright/test';

const fixture = new URL('../tests/fixtures/land-1080p30-aac.mp4', import.meta.url).pathname;
const optimalFixture = new URL('../tests/fixtures/small-h264-lowbitrate.mp4', import.meta.url)
  .pathname;

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('#file', fixture);
  const card = page.getByRole('region', { name: 'Export summary' });
  await expect(card).toBeVisible();
  const reencode = card.getByRole('checkbox', { name: 'Re-encode anyway' });
  if (await reencode.isVisible()) await reencode.check();
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
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(card.locator('.quality-value')).toHaveText('Quality: 50% of auto');
  await card.getByLabel('Quality', { exact: true }).evaluate((node) => {
    const slider = node as HTMLInputElement;
    slider.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(card).toContainText('1 change');
  await card.getByRole('button', { name: 'Reset to auto: Quality' }).click();
  await expect(card).toContainText('All automatic');
});

test('rotation, crop, mirror, and metadata controls stay available', async ({ page }) => {
  const card = page.getByRole('region', { name: 'Export summary' });
  await card.locator('summary').click();
  await card.getByLabel('Rotate clockwise').selectOption('90');
  await expect(card.getByLabel('Resolution', { exact: true })).toContainText('1080x1920');
  await card.getByLabel('Crop preset').selectOption('square');
  await expect(card.getByLabel('Resolution', { exact: true })).toContainText('1080x1080');
  await expect(card).toContainText('The preview shows the original video.');
  await card.getByLabel('Crop preset').selectOption('original');
  await expect(card.getByLabel('Resolution', { exact: true })).toContainText('1080x1920');
  await card.getByLabel('Crop preset').selectOption('square');
  await card.getByLabel('Mirror video').check();
  await card.getByLabel('Keyframe interval').selectOption('1');
  await expect(card).toContainText('More keyframes improve seeking but increase file size.');
  await card.getByLabel('Output title').fill('Square clip');
  await card.getByLabel('Output title').blur();
  await card.getByLabel('Strip source metadata').check();
  await expect(card).toContainText('changes');
});

test('audio removal and WebM selection stay valid', async ({ page }) => {
  const card = page.getByRole('region', { name: 'Export summary' });
  await card.locator('summary').click();
  await card.getByLabel('Audio codec', { exact: true }).selectOption('none');
  await expect(card.locator('h2')).toContainText('MP4');
  await expect(card.locator('.export-sub')).toContainText('no audio');
  await card.getByRole('button', { name: 'Reset to auto: Audio codec' }).click();
  await expect(card.locator('.export-sub')).toContainText('AAC');
  const webm = card.getByLabel('Format', { exact: true }).locator('option[value="webm"]');
  test.skip(!(await webm.isEnabled()), 'WebM is unavailable in this browser');
  await card.getByLabel('Format', { exact: true }).selectOption('webm');
  await expect(card.locator('h2')).toContainText('WEBM');
  await expect(card.locator('.export-sub')).toContainText('Opus');
});

test('unavailable codecs have a visible reason', async ({ page }) => {
  const card = page.getByRole('region', { name: 'Export summary' });
  await card.locator('summary').click();
  const unavailable = card.getByLabel('Video codec', { exact: true }).locator('option:disabled');
  test.skip(!(await unavailable.count()), 'All video codecs are available');
  const codecSetting = card
    .locator('.setting')
    .filter({ has: page.getByLabel('Video codec', { exact: true }) });
  const reason = codecSetting.locator('.setting-reason');
  await expect(reason).toBeVisible();
  await expect(reason).toContainText((await unavailable.first().textContent())!);
});

test('other codecs show a compatibility warning', async ({ page }) => {
  const card = page.getByRole('region', { name: 'Export summary' });
  await card.locator('summary').click();
  const otherCodec = card
    .getByLabel('Video codec', { exact: true })
    .locator('option:not([disabled]):not([value="avc"])')
    .first();
  test.skip(!(await otherCodec.count()), 'No alternative video codec is available');
  await card
    .getByLabel('Video codec', { exact: true })
    .selectOption((await otherCodec.getAttribute('value'))!);
  await expect(card.locator('.export-warning')).toBeVisible();
});

test('settings changes and reset keep keyboard focus', async ({ page }) => {
  const card = page.getByRole('region', { name: 'Export summary' });
  await card.locator('summary').click();
  const resolution = card.getByLabel('Resolution', { exact: true });
  await resolution.focus();
  await resolution.selectOption('1280');
  await expect(resolution).toBeFocused();
  const reset = card.getByRole('button', { name: 'Reset to auto: Resolution' });
  await reset.click();
  await expect(reset).toBeFocused();
});

test('audio reset buttons change only their own setting', async ({ page }) => {
  const card = page.getByRole('region', { name: 'Export summary' });
  await card.locator('summary').click();
  const codec = card.getByLabel('Audio codec', { exact: true });
  const opus = codec.locator('option[value="opus"]');
  test.skip(!(await opus.isEnabled()), 'Opus audio is unavailable in this browser');
  const bitrate = card.getByLabel('Audio bitrate', { exact: true });
  await bitrate.selectOption('64000');
  await codec.selectOption('opus');
  await card.getByRole('button', { name: 'Reset to auto: Audio codec' }).click();
  await expect(codec).toHaveValue('aac');
  await expect(bitrate).toHaveValue('64000');
  await codec.selectOption('opus');
  await card.getByRole('button', { name: 'Reset to auto: Audio bitrate' }).click();
  await expect(codec).toHaveValue('opus');
  await expect(bitrate).toHaveValue('128000');
});

test('already small video offers trim-only export', async ({ page }) => {
  await page.getByRole('button', { name: 'Choose another video' }).click();
  await page.setInputFiles('#file', optimalFixture);
  const card = page.getByRole('region', { name: 'Export summary' });
  await expect(card.getByText('This video is already small', { exact: true })).toBeVisible();
  await expect(card).toContainText('trim this video');
  await expect(card.getByRole('button', { name: 'Export trimmed copy' })).toBeVisible();
  await expect(card.getByText('Not needed for a trimmed copy')).toBeVisible();
  await card.locator('summary').click();
  await expect(card.getByLabel('Resolution', { exact: true })).toBeDisabled();
  await card.getByRole('checkbox', { name: 'Re-encode anyway' }).check();
  await expect(card.getByRole('button', { name: 'Export', exact: true })).toBeVisible();
  await expect(card.getByLabel('Resolution', { exact: true })).toBeEnabled();
});

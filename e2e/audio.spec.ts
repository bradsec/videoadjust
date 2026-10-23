import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const fixture = (name: string) => new URL(`../tests/fixtures/${name}`, import.meta.url).pathname;

async function axeClean(page: Page) {
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);
}

async function load(page: Page, name: string) {
  await page.goto('/');
  await page.setInputFiles('#file', fixture(name));
  await expect(page.getByRole('tablist', { name: 'Tool' })).toBeVisible();
}

test(
  'tool tabs switch between Shrink and the audio settings',
  { tag: '@mobile' },
  async ({ page }) => {
    await load(page, 'land-1080p30-aac.mp4');
    const shrinkTab = page.getByRole('tab', { name: 'Shrink video' });
    const audioTab = page.getByRole('tab', { name: 'Extract audio' });
    await expect(shrinkTab).toHaveAttribute('aria-selected', 'true');
    await expect(audioTab).toHaveAttribute('aria-selected', 'false');
    await expect(audioTab).toHaveAttribute('tabindex', '-1');
    await expect(page.getByRole('tabpanel')).toContainText('Ready to export');

    const shrink = page.getByRole('region', { name: 'Export summary' });
    const reencode = shrink.getByRole('checkbox', { name: 'Re-encode anyway' });
    if (await reencode.isVisible()) await reencode.check();
    await shrink.locator('summary').click();
    await shrink.getByLabel('Frame rate', { exact: true }).selectOption('24');
    await expect(shrink).toContainText('1 change');
    await axeClean(page);

    await shrinkTab.focus();
    await page.keyboard.press('ArrowRight');
    await expect(audioTab).toBeFocused();
    await expect(audioTab).toHaveAttribute('aria-selected', 'true');
    await expect(audioTab).toHaveAttribute('tabindex', '0');
    const audio = page.getByRole('region', { name: 'Audio summary' });
    await expect(audio).toContainText('Ready to extract');
    await expect(audio.locator('h2')).toContainText('MP3');
    await expect(audio.getByRole('button', { name: 'Extract audio' })).toBeVisible();
    await expect(audio).toContainText('from');

    await audio.locator('summary').click();
    await expect(audio).toContainText('All automatic');
    await expect(audio.getByRole('group', { name: 'Bitrate in kbps' })).toBeVisible();
    await axeClean(page);

    await audio.getByRole('radio', { name: /M4A/ }).check();
    await expect(audio.locator('h2')).toContainText('M4A');
    // This fixture's AAC measures just over 128 kbps, above the copy limit, so M4A re-encodes.
    await expect(audio).not.toContainText('Copies the original audio');
    await expect(audio).toContainText('1 change');

    await audio.getByRole('radio', { name: /WAV/ }).check();
    await expect(audio.locator('h2')).toContainText('WAV');
    await expect(audio.getByRole('group', { name: 'Bitrate in kbps' })).toBeHidden();
    await audio.getByRole('button', { name: 'Reset to MP3' }).click();
    await expect(audio.getByRole('radio', { name: /MP3/ })).toBeChecked();
    await expect(audio.getByRole('group', { name: 'Bitrate in kbps' })).toBeVisible();

    await audio.getByRole('button', { name: '192', exact: true }).click();
    await expect(audio.getByRole('button', { name: '192', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(audio.getByRole('button', { name: '192', exact: true })).toBeFocused();
    await expect(audio.locator('h2')).toContainText('192 kbps');
    await axeClean(page);

    await audioTab.focus();
    await page.keyboard.press('Home');
    await expect(shrinkTab).toBeFocused();
    await expect(shrinkTab).toHaveAttribute('aria-selected', 'true');
    await expect(shrink).toContainText('1 change');
    await expect(shrink.getByLabel('Frame rate', { exact: true })).toHaveValue('24');

    await page.keyboard.press('End');
    await expect(page.getByRole('tab', { name: 'GIF', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(
      page.getByRole('region', { name: 'GIF summary' }).getByRole('heading'),
    ).toContainText('GIF');
    await page.keyboard.press('ArrowLeft');
    await expect(audioTab).toHaveAttribute('aria-selected', 'true');
    await expect(audio.locator('h2')).toContainText('192 kbps');
  },
);

test('a mono source cannot be extracted as stereo', async ({ page }) => {
  await load(page, 'mono-aac.mp4');
  await page.getByRole('tab', { name: 'Extract audio' }).click();
  const audio = page.getByRole('region', { name: 'Audio summary' });
  await audio.locator('summary').click();
  await expect(audio.getByRole('button', { name: 'Stereo' })).toBeDisabled();
  await expect(audio.getByRole('button', { name: 'Mono' })).toHaveAttribute('aria-pressed', 'true');
  await expect(audio.locator('h2')).toContainText('mono');
  // 64 kbps mono AAC is within the copy limit.
  const copyHint = audio.getByText('Copies the original audio without re-encoding');
  await expect(copyHint).toBeVisible();
  await audio.getByRole('radio', { name: /M4A/ }).check();
  await expect(audio.locator('h2')).toContainText('M4A');
  await expect(audio.locator('.export-sub')).toContainText('no re-encoding');
  await expect(copyHint).toBeVisible();
  await axeClean(page);
});

test('a video without audio disables Extract audio and says why', async ({ page }) => {
  await load(page, 'noaudio.mp4');
  const audioTab = page.getByRole('tab', { name: 'Extract audio' });
  await expect(audioTab).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByText('This video has no audio track')).toBeVisible();
  await expect(audioTab).toHaveAccessibleDescription('This video has no audio track');
  await audioTab.click({ force: true });
  await expect(page.getByRole('tab', { name: 'Shrink video' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('region', { name: 'Export summary' })).toBeVisible();
  await axeClean(page);
});

import { expect, test } from '@playwright/test';

const fixture = new URL('../tests/fixtures/land-1080p30-aac.mp4', import.meta.url).pathname;

test('Space controls the preview only outside controls and editors', async ({ page }, testInfo) => {
  test.skip(['iphone', 'ipad'].includes(testInfo.project.name), 'Physical keyboard projects only');
  await page.goto('/');
  await page.setInputFiles('#file', fixture);
  const video = page.locator('.preview-video');
  const play = page.getByRole('button', { name: 'Play', exact: true });
  const pause = page.getByRole('button', { name: 'Pause', exact: true });
  await expect(play).toBeHidden();
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.paused)).toBe(true);
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  await page.keyboard.press('Space');
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.paused)).toBe(false);
  await page.keyboard.press('Space');
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.paused)).toBe(true);

  await page.getByRole('button', { name: 'Crop and rotate' }).click();
  await page.getByLabel('Crop aspect ratio').selectOption('square');
  await page
    .getByRole('region', { name: 'Crop and rotate editor' })
    .getByRole('button', { name: 'Done' })
    .click();
  await expect(play).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  await page.keyboard.press('Space');
  await expect(pause).toBeVisible();
  await page.keyboard.press('Space');
  await expect(play).toBeVisible();

  await page.locator('.overlay-adjust > summary').click();
  await page.getByLabel('Text overlay', { exact: true }).check();
  const text = page.getByLabel('Overlay text', { exact: true });
  await text.focus();
  await text.press('Space');
  await expect(play).toBeVisible();
  const number = page.getByLabel('Text opacity (%) value');
  await number.focus();
  await number.press('Space');
  await expect(play).toBeVisible();
  const theater = page.getByRole('button', { name: 'Theater mode' });
  await theater.focus();
  await theater.press('Space');
  await expect(play).toBeVisible();

  await page.getByRole('button', { name: 'Crop and rotate' }).click();
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  await page.keyboard.press('Space');
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.paused)).toBe(true);
});

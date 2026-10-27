import { expect, test } from '@playwright/test';
import type { Settings } from '../src/core/types';

const fixture = new URL('../tests/fixtures/land-1080p30-aac.mp4', import.meta.url).pathname;
const srt = '1\n00:00:00,000 --> 00:00:01,500\nHello\n\n2\n00:00:01,500 --> 00:00:03,000\nWorld\n';

test('Shrink exports with burned-in captions', async ({ page }) => {
  await page.goto('/e2e/harness.html');
  await page.setInputFiles('#file', fixture);
  const canAvc = await page.evaluate(() => window.vrHarness.canEncodeVideo('avc', 640, 360));
  test.skip(!canAvc, 'This browser build has no H.264 WebCodecs encoder');
  const settings: Settings = {
    container: 'mp4',
    passthrough: false,
    trim: { start: 0, end: 3 },
    captions: {
      cues: [{ start: 0, end: 3, text: 'Caption' }],
      size: 'large',
      position: 'bottom',
      background: 'box',
    },
    video: { codec: 'avc', width: 640, height: 360, fps: 30, bitrate: 1_000_000 },
    audio: { codec: 'aac', bitrate: 128_000, channels: 2, copy: false },
  };
  const r = await page.evaluate((s) => window.vrHarness.convertToMemory(s), settings);
  if (!r.ok) throw new Error(`${r.error.name}: ${r.error.message}`);
  expect(Math.abs(r.output.durationSec - 3)).toBeLessThanOrEqual(0.1);
});

test('Captions import SRT, preview the current cue and clear with Reset all', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('#file', fixture);
  const section = page.locator('.caption-adjust');
  await section.locator('summary').click();
  await section.getByLabel('Import captions file').setInputFiles({
    name: 'clip.srt',
    mimeType: 'application/x-subrip',
    buffer: Buffer.from(srt),
  });
  await expect(section.getByRole('status')).toHaveText('Imported 2 captions.');
  await expect(section.locator('summary .adjust-state')).toHaveText('2 captions');
  await expect(section.getByLabel('Caption 2 text', { exact: true })).toHaveValue('World');

  const layer = page.locator('.live-preview-captions');
  await expect(layer).toBeVisible();
  await expect
    .poll(() =>
      layer.evaluate((canvas: HTMLCanvasElement) => {
        const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
        return pixels.data.some((value, index) => index % 4 === 3 && value > 0);
      }),
    )
    .toBe(true);
  await page.getByRole('button', { name: 'Show original', exact: true }).click();
  await expect(layer).toBeHidden();
  await page.getByRole('button', { name: 'Show original', exact: true }).click();

  await section.getByLabel('Caption 1 text', { exact: true }).fill('Changed');
  await section.getByLabel('Caption 1 text', { exact: true }).blur();
  await expect(section.getByLabel('Caption 1 text', { exact: true })).toHaveValue('Changed');

  await page.getByRole('button', { name: 'Reset all' }).first().click();
  await page.getByRole('button', { name: 'Confirm reset' }).click();
  await expect(section.locator('summary .adjust-state')).toHaveText('Off');
  await expect(section.locator('.caption-row')).toHaveCount(0);
});

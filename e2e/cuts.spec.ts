import { expect, test } from '@playwright/test';
import type { ConvertResult, GifResult } from './harness';
import type { AudioExtractSettings } from '../src/core/audioExtract';
import type { GifSettings } from '../src/core/gifExport';
import type { Settings } from '../src/core/types';

const fixture = new URL('../tests/fixtures/land-1080p30-aac.mp4', import.meta.url).pathname;
const cuts = [
  { start: 0.5, end: 1 },
  { start: 1.5, end: 2 },
];

function ok<T extends ConvertResult | GifResult>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error(`${r.error.name}: ${r.error.message}`);
  return r as Extract<T, { ok: true }>;
}

test.describe('cut export', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/e2e/harness.html');
    await page.setInputFiles('#file', fixture);
  });

  test('Shrink joins the kept ranges with video and audio', async ({ page }) => {
    const canAvc = await page.evaluate(() => window.vrHarness.canEncodeVideo('avc', 640, 360));
    test.skip(!canAvc, 'This browser build has no H.264 WebCodecs encoder');
    const settings: Settings = {
      container: 'mp4',
      passthrough: false,
      trim: { start: 0, end: 3 },
      cuts,
      video: { codec: 'avc', width: 640, height: 360, fps: 30, bitrate: 1_000_000 },
      audio: { codec: 'aac', bitrate: 128_000, channels: 2, copy: false },
    };
    const r = ok(await page.evaluate((s) => window.vrHarness.convertToMemory(s), settings));
    expect(Math.abs(r.output.durationSec - 2)).toBeLessThanOrEqual(0.1);
    expect(r.output.video).not.toBeNull();
    expect(r.output.audio).not.toBeNull();
  });

  test('Extract audio exports only the kept duration', async ({ page }) => {
    const settings: AudioExtractSettings = {
      format: 'wav',
      trim: { start: 0, end: 3 },
      cuts,
      bitrate: 128_000,
      channels: 2,
      copy: false,
    };
    const r = ok(
      await page.evaluate((s) => {
        const file = (document.getElementById('file') as HTMLInputElement).files![0]!;
        return window.vrHarness.extractAudio(file, s, 'memory');
      }, settings),
    );
    expect(Math.abs(r.output.durationSec - 2)).toBeLessThanOrEqual(0.05);
  });

  test('GIF samples frames from the kept ranges only', async ({ page }) => {
    const settings: GifSettings = {
      trim: { start: 0, end: 3 },
      cuts,
      size: 320,
      fps: 5,
      loop: 'forever',
      colors: 256,
      compression: 'balanced',
    };
    const r = ok(await page.evaluate((s) => window.vrHarness.exportGif(s), settings));
    expect(r.frames).toBe(10);
  });
});

test('Cut sections update the kept duration and Reset all clears them', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('#file', fixture);
  const kept = page.locator('.trim-kept');
  await expect(kept).toContainText('kept');
  const fullKept = await kept.textContent();
  const section = page.getByRole('region', { name: 'Cut sections' });
  await section.getByRole('button', { name: 'Add cut' }).click();
  const start = section.getByLabel('Cut 1 start', { exact: true });
  const end = section.getByLabel('Cut 1 end', { exact: true });
  await end.fill('2');
  await end.press('Enter');
  await start.fill('1');
  await start.press('Enter');
  await expect(start).toHaveValue('0:01.0');
  await expect(end).toHaveValue('0:02.0');
  await expect(kept).toHaveText(/^0:02\.0 of 0:03\.0 kept$/);
  await expect(page.locator('.trim-cut-mark')).toHaveCount(1);

  await page.getByRole('button', { name: 'Reset all' }).first().click();
  await page.getByRole('button', { name: 'Confirm reset' }).click();
  await expect(section.getByLabel('Cut 1 start', { exact: true })).toHaveCount(0);
  await expect(kept).toHaveText(fullKept!);
});

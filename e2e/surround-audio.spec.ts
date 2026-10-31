import { expect, test, type Page } from '@playwright/test';
import type { Capabilities, Settings } from '../src/core/types';
import { openSection } from './sections';

const fixture = (name: string) => new URL(`../tests/fixtures/${name}`, import.meta.url).pathname;

const small = (audio: Settings['audio']): Settings => ({
  container: 'mp4',
  passthrough: false,
  trim: { start: 0, end: 1 },
  video: { codec: 'avc', width: 640, height: 360, fps: 30, bitrate: 500_000 },
  audio,
});
const aacStereo: Settings['audio'] = { codec: 'aac', bitrate: 128_000, channels: 2, copy: false };

/** Collects requests for the lazily loaded AC-3 decoder chunk. */
function ac3ChunkRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on('request', (request) => {
    if (/mediabunny-ac3/.test(request.url())) urls.push(request.url());
  });
  return urls;
}

test.describe('surround and Dolby audio sources', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/e2e/harness.html');
    const canAvc = await page.evaluate(() => window.vrHarness.canEncodeVideo('avc', 640, 360));
    test.skip(!canAvc, 'This browser build has no H.264 WebCodecs encoder');
  });

  test('decodes 5.1 E-AC-3 and exports it as stereo AAC', async ({ page }) => {
    await page.setInputFiles('#file', fixture('h264-eac3-51.mp4'));
    const read = await page.evaluate(() => window.vrHarness.readSource());
    if (!read.ok) throw new Error(read.error.message);
    expect(read.info.audio).toMatchObject({ codec: 'eac3', decodable: true, channels: 6 });
    const result = await page.evaluate(
      (s) => window.vrHarness.convertToMemory(s),
      small(aacStereo),
    );
    if (!result.ok) throw new Error(`${result.error.name}: ${result.error.message}`);
    expect(result.output.audio).toMatchObject({ codec: 'aac', channels: 2 });
    expect(Math.abs(result.output.durationSec - 1)).toBeLessThanOrEqual(0.1);
  });

  test('the pre-save check discards undecodable DTS audio', async ({ page }) => {
    await page.setInputFiles('#file', fixture('h264-dts.mkv'));
    const read = await page.evaluate(() => window.vrHarness.readSource());
    if (!read.ok) throw new Error(read.error.message);
    expect(read.info.audio).toMatchObject({ codec: 'dts', decodable: false });
    const checked = await page.evaluate(
      (s) => window.vrHarness.checkConversion(s),
      small(aacStereo),
    );
    expect(checked).toEqual({ ok: true });
    const videoOnly = await page.evaluate((s) => window.vrHarness.checkConversion(s), small(null));
    expect(videoOnly).toEqual({ ok: true });
  });
});

test.describe('exporting sources with Dolby or undecodable audio', () => {
  async function open(page: Page, name: string) {
    await page.addInitScript(() => {
      const calls = { picker: 0 };
      (window as unknown as { vrSink: typeof calls }).vrSink = calls;
      (window as unknown as { showSaveFilePicker: () => Promise<unknown> }).showSaveFilePicker =
        async () => {
          calls.picker++;
          return { createWritable: async () => new WritableStream() };
        };
    });
    await page.goto('/');
    await page.setInputFiles('#file', fixture(name));
    await expect(page.getByRole('region', { name: 'Export summary' })).toBeVisible();
    const caps = JSON.parse(
      (await page.locator('html').getAttribute('data-caps'))!,
    ) as Capabilities;
    test.skip(!caps.video.avc, 'This browser has no H.264 WebCodecs encoder');
  }
  const exportButton = (page: Page) =>
    page.getByRole('region', { name: 'Export summary' }).getByRole('button', { name: /^Export/ });
  const pickerCalls = (page: Page) =>
    page.evaluate(() => (window as unknown as { vrSink: { picker: number } }).vrSink.picker);

  test('a 5.1 E-AC-3 source loads the AC-3 decoder and exports', async ({ page }) => {
    const chunks = ac3ChunkRequests(page);
    await open(page, 'h264-eac3-51.mp4');
    await expect(page.getByText('This browser cannot decode the audio in this video')).toHaveCount(
      0,
    );
    await exportButton(page).click();
    await expect(page.locator('.verdict')).toBeVisible({ timeout: 60_000 });
    expect(await pickerCalls(page)).toBe(1);
    expect(chunks.length).toBeGreaterThan(0);
  });

  test('an AAC source never fetches the AC-3 decoder', async ({ page }) => {
    const chunks = ac3ChunkRequests(page);
    await open(page, 'land-1080p30-aac.mp4');
    expect(chunks).toEqual([]);
  });

  test('a source with undecodable DTS audio exports its video instead of failing', async ({
    page,
  }) => {
    await open(page, 'h264-dts.mkv');
    await expect(
      page.getByText('This browser cannot decode the audio in this video').first(),
    ).toBeVisible();
    await exportButton(page).click();
    await expect(page.locator('.verdict')).toBeVisible({ timeout: 60_000 });
    expect(await pickerCalls(page)).toBe(1);
  });

  test('added music over undecodable DTS audio exports the music', async ({ page }) => {
    await open(page, 'h264-dts.mkv');
    await openSection(page, 'audio');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Add music or audio', exact: true }).click();
    await (await chooser).setFiles(fixture('mono-aac.mp4'));
    await expect(page.getByText('Added audio: mono-aac.mp4', { exact: true })).toBeVisible();
    await exportButton(page).click();
    await expect(page.locator('.verdict')).toBeVisible({ timeout: 60_000 });
    expect(await pickerCalls(page)).toBe(1);
  });
});

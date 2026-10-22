import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { Capabilities } from '../src/core/types';

const fixture = (name: string) => new URL(`../tests/fixtures/${name}`, import.meta.url).pathname;

/** Remove the save picker so the app keeps the output in memory, as on iOS Safari and Firefox. */
async function forceMemorySink(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w.showSaveFilePicker;
    delete (Window.prototype as unknown as Record<string, unknown>).showSaveFilePicker;
  });
}

/**
 * Stand in for the save picker with a counting WritableStream, since Playwright cannot drive
 * the native dialog. `pickerCancels` rejects the picker the way a dismissed dialog does.
 */
async function fakeSavePicker(page: Page, opts: { pickerCancels?: boolean } = {}) {
  await page.addInitScript((pickerCancels) => {
    const calls = { picker: 0, close: 0, abort: 0, bytes: 0 };
    (window as unknown as { vrSink: typeof calls }).vrSink = calls;
    (window as unknown as { showSaveFilePicker: () => Promise<unknown> }).showSaveFilePicker =
      async () => {
        calls.picker++;
        if (pickerCancels) throw new DOMException('The user aborted a request.', 'AbortError');
        return {
          createWritable: async () =>
            new WritableStream<{ data: Uint8Array }>({
              write(chunk) {
                calls.bytes += chunk.data.byteLength;
              },
              close() {
                calls.close++;
              },
              abort() {
                calls.abort++;
              },
            }),
        };
      };
  }, opts.pickerCancels ?? false);
}

/**
 * Real encoders land on either side of a low source bitrate depending on the engine, so a
 * re-encode at the source bitrate is not reliably bigger. This multiplies the bitrate every
 * VideoEncoder is configured with, at the WebCodecs boundary, so the output is reliably
 * larger than the source without a test hook in the app.
 */
async function inflateEncoderBitrate(page: Page, factor: number) {
  await page.addInitScript((f) => {
    if (typeof VideoEncoder === 'undefined') return;
    const configure = VideoEncoder.prototype.configure;
    VideoEncoder.prototype.configure = function (config: VideoEncoderConfig) {
      return configure.call(
        this,
        config.bitrate ? { ...config, bitrate: Math.round(config.bitrate * f) } : config,
      );
    };
  }, factor);
}

async function axeClean(page: Page) {
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);
}

const sinkCalls = (page: Page) =>
  page.evaluate(() => (window as unknown as { vrSink: Record<string, number> }).vrSink);

async function open(page: Page, name: string) {
  await page.goto('/');
  await page.setInputFiles('#file', fixture(name));
  const card = page.getByRole('region', { name: 'Export summary' });
  await expect(card).toBeVisible();
  const caps = JSON.parse((await page.locator('html').getAttribute('data-caps'))!) as Capabilities;
  test.skip(
    !Object.values(caps.video).some(Boolean),
    'This browser has no WebCodecs video encoder',
  );
  return card;
}

async function reencode(page: Page) {
  const box = page.getByRole('checkbox', { name: 'Re-encode anyway' });
  if (await box.isVisible()) await box.check();
}

const exportButton = (page: Page) =>
  page.getByRole('region', { name: 'Export summary' }).getByRole('button', { name: /^Export/ });

test('exports 1080p30 to a result with the reduction and two videos to compare', async ({
  page,
  baseURL,
}) => {
  if (!baseURL) throw new Error('Playwright baseURL is required');
  const crossOriginRequests: string[] = [];
  const origin = new URL(baseURL).origin;
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== origin) crossOriginRequests.push(request.url());
  });
  await forceMemorySink(page);
  const card = await open(page, 'land-1080p30-aac.mp4');
  await reencode(page);
  // The fixture is already near the floor of what encoders can hit at 1080p, so the test
  // asks for a clearly smaller file: 480p, the lowest quality and 64 kbps audio.
  await card.locator('summary').click();
  await card.getByLabel('Resolution', { exact: true }).selectOption('854');
  await card.getByLabel('Quality', { exact: true }).evaluate((node) => {
    const slider = node as HTMLInputElement;
    slider.value = slider.min;
    slider.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await card.getByLabel('Audio bitrate', { exact: true }).selectOption('64000');
  await exportButton(page).click();
  const figure = page.locator('.verdict .figure');
  await expect(figure).toContainText(/\d+% smaller/, { timeout: 60_000 });
  await expect(page.locator('.stats')).toContainText('Reduction');
  await expect(page.locator('.stats tr.total')).toContainText('% smaller');
  await expect(
    page.getByRole('link', { name: /Download land-1080p30-aac-small\.mp4/ }),
  ).toHaveAttribute('download', 'land-1080p30-aac-small.mp4');

  const videos = page.locator('.compare-stage video');
  await expect(videos).toHaveCount(2);
  await expect(videos.nth(0)).toBeVisible();
  await expect(videos.nth(1)).toBeVisible();

  const knob = page.getByRole('slider', { name: 'Wipe position' });
  await expect(knob).toHaveAttribute('aria-valuenow', '50');
  await knob.focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(knob).toHaveAttribute('aria-valuenow', '40');
  await expect(videos.nth(1)).toHaveCSS('clip-path', 'inset(0px 0px 0px 40%)');
  await page.keyboard.press('End');
  await expect(knob).toHaveAttribute('aria-valuenow', '100');

  const frameMode = page.getByRole('button', { name: 'Frame', exact: true });
  await frameMode.click();
  await expect(frameMode).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeHidden();
  const newTime = () => videos.nth(1).evaluate((v) => (v as HTMLVideoElement).currentTime);
  await expect
    .poll(() => videos.nth(1).evaluate((v) => (v as HTMLVideoElement).readyState))
    .toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Next frame' }).click();
  await page.getByRole('button', { name: 'Next frame' }).click();
  await expect.poll(newTime).toBeCloseTo(2 / 30, 2);
  await page.getByRole('button', { name: 'Previous frame' }).click();
  await expect.poll(newTime).toBeCloseTo(1 / 30, 2);

  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);

  await page.getByRole('button', { name: 'Start over' }).click();
  await expect(page.getByRole('button', { name: 'Choose video' })).toBeVisible();
  expect(crossOriginRequests).toEqual([]);
});

test('shows the new video alone with a note when the original cannot play here', async ({
  page,
}) => {
  await forceMemorySink(page);
  // Stands in for e.g. HEVC on Chromium: the browser reports no player for the original.
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.canPlayType = () => '';
  });
  const card = await open(page, 'land-1080p30-aac.mp4');
  await reencode(page);
  await card.locator('summary').click();
  await card.getByLabel('Resolution', { exact: true }).selectOption('854');
  await exportButton(page).click();
  await expect(page.getByText('This browser cannot play the original for comparison')).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.locator('.compare-stage video:visible')).toHaveCount(1);
  await expect(page.getByRole('slider', { name: 'Wipe position' })).toBeHidden();
  await expect(page.locator('.compare-new')).toHaveCSS('clip-path', 'none');
  await expect(page.locator('.stats thead')).toContainText('Original');
  await expect(page.locator('.stats tbody')).toContainText('1920x1080');
});

test('an output that is not smaller says so and offers Make it smaller', async ({ page }) => {
  await forceMemorySink(page);
  await inflateEncoderBitrate(page, 10);
  const card = await open(page, 'small-h264-lowbitrate.mp4');
  await reencode(page);
  await card.locator('summary').click();
  // Highest quality the slider allows: the source's own bitrate.
  await card.getByLabel('Quality', { exact: true }).evaluate((node) => {
    const slider = node as HTMLInputElement;
    slider.value = slider.max;
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await exportButton(page).click();
  await expect(page.getByText('The new file is not smaller than the original')).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.locator('.verdict .figure')).toContainText('not smaller');
  const smaller = page.getByRole('button', { name: 'Make it smaller' });
  await expect(smaller).toHaveClass(/is-suggested/);

  // 640x360 has no smaller size step, so quality goes down instead and the notice says so.
  await smaller.click();
  await expect(page.getByRole('region', { name: 'Export summary' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('quality is lowered to 75% of auto');
});

test('Cancel returns to prepare with settings kept and discards the partial file', async ({
  page,
}) => {
  await fakeSavePicker(page);
  const card = await open(page, 'land-4k60-aac.mp4');
  await card.locator('summary').click();
  await card.getByLabel('Resolution', { exact: true }).selectOption('1280');
  await exportButton(page).click();
  const cancel = page.getByRole('button', { name: 'Cancel export' });
  await expect(cancel).toBeVisible();
  await cancel.click();
  await expect(page.getByRole('region', { name: 'Export summary' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText(
    'A partial file may remain at the location you chose',
  );
  await page.getByRole('region', { name: 'Export summary' }).locator('summary').click();
  await expect(page.getByLabel('Resolution', { exact: true })).toHaveValue('1280');
  expect(await sinkCalls(page)).toMatchObject({ picker: 1, abort: 1, close: 0 });
});

test('a file-stream export closes the file once and skips playback compare', async ({ page }) => {
  await fakeSavePicker(page);
  await open(page, 'land-1080p30-aac.mp4');
  await reencode(page);
  await exportButton(page).click();
  await expect(page.locator('.verdict')).toContainText('is saved where you chose', {
    timeout: 60_000,
  });
  await expect(page.locator('.compare-skipped')).toBeVisible();
  await expect(page.locator('.compare-stage video')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Download/ })).toHaveCount(0);
  const calls = await sinkCalls(page);
  expect(calls).toMatchObject({ picker: 1, abort: 0, close: 1 });
  expect(calls.bytes).toBeGreaterThan(0);
});

test('a cancelled save picker returns to prepare without a notice', async ({ page }) => {
  await fakeSavePicker(page, { pickerCancels: true });
  await open(page, 'land-1080p30-aac.mp4');
  await reencode(page);
  await exportButton(page).click();
  await expect.poll(async () => (await sinkCalls(page)).picker).toBe(1);
  await expect(page.getByRole('region', { name: 'Export summary' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

async function extractAudio(page: Page, name: string, format?: RegExp) {
  await page.goto('/');
  await page.setInputFiles('#file', fixture(name));
  await page.getByRole('tab', { name: 'Extract audio' }).click();
  const panel = page.getByRole('region', { name: 'Audio summary' });
  if (format) {
    await panel.locator('summary').click();
    await panel.getByRole('radio', { name: format }).check();
  }
  await panel.getByRole('button', { name: 'Extract audio' }).click();
}

async function extractAudioToMemory(page: Page, name: string, format?: RegExp) {
  await forceMemorySink(page);
  await extractAudio(page, name, format);
  await expect(page.locator('.verdict')).toContainText('is ready to save or share', {
    timeout: 60_000,
  });
}

test('an MP3 extract shows the audio result with a working player', async ({ page, baseURL }) => {
  if (!baseURL) throw new Error('Playwright baseURL is required');
  const crossOriginRequests: string[] = [];
  const origin = new URL(baseURL).origin;
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== origin) crossOriginRequests.push(request.url());
  });
  await extractAudioToMemory(page, 'land-1080p30-aac.mp4');

  const stats = page.locator('.stats');
  await expect(stats).toContainText('Audio file');
  await expect(stats).toContainText('Original video');
  await expect(stats.locator('tbody tr', { hasText: 'Codec' })).toContainText('MP3');
  await expect(page.getByRole('link', { name: /Download/ })).toHaveAttribute(
    'download',
    /-audio\.mp3$/,
  );
  await expect(page.getByRole('button', { name: 'Lower bitrate' })).toBeVisible();

  const audio = page.locator('audio');
  await expect(audio).toHaveCount(1);
  const bytes = [...readFileSync(fixture('land-1080p30-aac.mp4'))];
  const sourceSpan = await page.evaluate(async (data) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.src = URL.createObjectURL(new Blob([new Uint8Array(data)], { type: 'video/mp4' }));
    await new Promise((resolve) =>
      video.addEventListener('loadedmetadata', resolve, { once: true }),
    );
    return video.duration;
  }, bytes);
  await expect
    .poll(() => audio.evaluate((a) => (a as HTMLAudioElement).duration))
    .toBeCloseTo(sourceSpan, 0);
  const duration = await audio.evaluate((a) => (a as HTMLAudioElement).duration);
  expect(Math.abs(duration - sourceSpan)).toBeLessThan(0.1);

  const play = page.getByRole('button', { name: 'Play', exact: true });
  await play.click();
  const pause = page.getByRole('button', { name: 'Pause', exact: true });
  await expect(pause).toBeVisible();
  await pause.click();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();

  const scrub = page.getByRole('slider', { name: 'Seek' });
  await scrub.focus();
  await page.keyboard.press('End');
  await expect(scrub).toHaveAttribute('aria-valuenow', String(Math.round(duration)));
  await page.keyboard.press('Home');
  await expect(scrub).toHaveAttribute('aria-valuenow', '0');
  await page.keyboard.press('ArrowRight');
  // The fixture is shorter than one 5 s step, so the seek clamps to the end.
  await expect(scrub).toHaveAttribute('aria-valuenow', String(Math.round(Math.min(5, duration))));

  await axeClean(page);
  expect(crossOriginRequests).toEqual([]);
});

test('Lower bitrate returns to the audio settings at 96 kbps', async ({ page }) => {
  await extractAudioToMemory(page, 'land-1080p30-aac.mp4');
  await page.getByRole('button', { name: 'Lower bitrate' }).click();
  const panel = page.getByRole('region', { name: 'Audio summary' });
  await expect(panel).toBeVisible();
  await expect(panel.locator('h2')).toContainText('96 kbps');
});

test('a WAV extract reports PCM 16-bit and lossless', async ({ page }) => {
  await extractAudioToMemory(page, 'land-1080p30-aac.mp4', /WAV/);
  const stats = page.locator('.stats');
  await expect(stats.locator('tbody tr', { hasText: 'Codec' })).toContainText('PCM 16-bit');
  await expect(stats.locator('tbody tr', { hasText: 'Bitrate' })).toContainText('Lossless');
  await axeClean(page);
});

test('a file-stream audio result has no player and says where the file is', async ({ page }) => {
  await fakeSavePicker(page);
  await extractAudio(page, 'land-1080p30-aac.mp4');
  await expect(page.locator('.verdict')).toContainText('is saved where you chose', {
    timeout: 60_000,
  });
  await expect(page.getByText('Saved where you chose. Open it from there to play.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toHaveCount(0);
  await expect(page.locator('audio')).toHaveCount(0);
  await axeClean(page);
});

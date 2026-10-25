import { readFile } from 'node:fs/promises';
import { openSection } from './sections';
import { expect, test, type Page } from '@playwright/test';
import { ALL_FORMATS, BufferSource, Input } from 'mediabunny';

type ResultInfo = {
  durationSec: number;
  audio: { codec: string | null; channels: number; sampleRate: number } | null;
  video: { codec: string | null } | null;
};

const fixture = (name: string) => new URL(`../tests/fixtures/${name}`, import.meta.url).pathname;
test.setTimeout(120_000);

async function load(page: Page, name = 'land-1080p30-aac.mp4') {
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
    delete (Window.prototype as unknown as Record<string, unknown>).showSaveFilePicker;
  });
  await page.goto('/');
  await page.setInputFiles('#file', fixture(name));
  await openSection(page, 'audio');
  await expect(page.getByRole('region', { name: 'Audio tracks', exact: true })).toBeVisible();
}

async function addAudio(page: Page) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add music or audio', exact: true }).click();
  await (await chooser).setFiles(fixture('mono-aac.mp4'));
  await expect(page.getByText('Added audio: mono-aac.mp4', { exact: true })).toBeVisible();
}

async function exportVideo(page: Page): Promise<ResultInfo> {
  await page
    .getByRole('region', { name: 'Export summary' })
    .getByRole('button', { name: /^Export/ })
    .click();
  return resultInfo(page, 'mp4');
}

async function exportWav(page: Page): Promise<ResultInfo> {
  await page.getByRole('tab', { name: 'Extract audio', exact: true }).click();
  const audio = page.getByRole('region', { name: 'Audio summary' });
  await audio.locator('summary').click();
  await audio.getByRole('radio', { name: /WAV/ }).check();
  await audio.getByRole('button', { name: 'Extract audio', exact: true }).click();
  return resultInfo(page, 'wav');
}

// The built app does not serve source modules, so read the result's container metadata in Node.
async function resultBytes(page: Page, extension: string): Promise<Buffer> {
  const link = page.getByRole('link', { name: new RegExp(`Download .*\\.${extension}`, 'i') });
  await expect(link).toBeVisible({ timeout: 90_000 });
  const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
  return readFile((await download.path())!);
}

async function resultInfo(page: Page, extension: string): Promise<ResultInfo> {
  const bytes = await resultBytes(page, extension);
  const input = new Input({
    source: new BufferSource(bytes),
    formats: ALL_FORMATS,
  });
  try {
    const audio = await input.getPrimaryAudioTrack();
    const video = await input.getPrimaryVideoTrack();
    return {
      durationSec: await input.computeDuration(),
      audio: audio
        ? { codec: audio.codec, channels: audio.numberOfChannels, sampleRate: audio.sampleRate }
        : null,
      video: video ? { codec: video.codec } : null,
    };
  } finally {
    input.dispose();
  }
}

test('Reset original audio restores inclusion and volume without changing the added track', async ({
  page,
}) => {
  await load(page);
  await addAudio(page);
  const originalVolume = page.getByLabel('Original volume (dB)', { exact: true });
  const original = page.getByRole('checkbox', { name: 'Original audio', exact: true });
  const addedVolume = page.getByLabel('Added volume (dB)', { exact: true });
  const reset = page.getByRole('button', { name: 'Reset original audio', exact: true });
  await expect(reset).toBeHidden();
  await addedVolume.fill('-3');
  await originalVolume.fill('-6');
  await expect(reset).toBeVisible();
  await original.uncheck();
  await expect(originalVolume).toBeDisabled();
  await reset.click();
  await expect(original).toBeChecked();
  await expect(originalVolume).toHaveValue('0');
  await expect(originalVolume).toBeFocused();
  await expect(reset).toBeHidden();
  await expect(addedVolume).toHaveValue('-3');
  await original.uncheck();
  await expect(reset).toBeVisible();
  await reset.click();
  await expect(original).toBeChecked();
  await expect(reset).toBeHidden();
});

test('two tracks with independent volumes export MP4', async ({ page }) => {
  await load(page);
  await addAudio(page);
  await page.getByLabel('Original volume (dB)', { exact: true }).fill('-6');
  await page.getByLabel('Added volume (dB)', { exact: true }).fill('-3');
  await page.getByLabel('Added start offset (seconds)', { exact: true }).fill('0.5');
  await page.getByRole('checkbox', { name: 'Loop added audio', exact: true }).check();
  await page.getByLabel('Normalize loudness', { exact: true }).selectOption('-16');
  const result = await exportVideo(page);
  expect(result.audio).toMatchObject({ codec: 'aac', channels: 2, sampleRate: 48000 });
  expect(result.video?.codec).toBe('avc');
});

test('the same mix and master settings export WAV after switching tools', async ({ page }) => {
  await load(page);
  await addAudio(page);
  await page.getByLabel('Original volume (dB)', { exact: true }).fill('-12');
  await page.getByLabel('Added volume (dB)', { exact: true }).fill('-6');
  await page.getByLabel('Gain (dB)', { exact: true }).fill('-2');
  const result = await exportWav(page);
  expect(result.audio).toMatchObject({ codec: 'pcm-s16', channels: 2, sampleRate: 48000 });
  expect(result.durationSec).toBeCloseTo(3, 1);
});

test('a silent source exports MP4 with added audio', async ({ page }) => {
  await load(page, 'noaudio.mp4');
  await expect(page.getByRole('tab', { name: 'Extract audio', exact: true })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await addAudio(page);
  await expect(page.getByRole('tab', { name: 'Extract audio', exact: true })).not.toHaveAttribute(
    'aria-disabled',
    'true',
  );
  const result = await exportVideo(page);
  expect(result.audio).toMatchObject({ codec: 'aac', sampleRate: 48000 });
});

test('removing original audio exports only the added samples', async ({ page }) => {
  await load(page);
  await addAudio(page);
  await page.getByLabel('Original volume (dB)', { exact: true }).fill('12');
  await page.getByRole('checkbox', { name: 'Original audio', exact: true }).uncheck();
  await exportWav(page);
  const resultWav = (await resultBytes(page, 'wav')).toString('base64');
  const addedBytes = (await readFile(fixture('mono-aac.mp4'))).toString('base64');
  const ratio = await page.evaluate(
    async ({ resultWav, addedBytes }) => {
      const bytes = (base64: string) =>
        Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)).buffer;
      const context = new AudioContext({ sampleRate: 48000 });
      try {
        const [result, added] = await Promise.all([
          context.decodeAudioData(bytes(resultWav)),
          context.decodeAudioData(bytes(addedBytes)),
        ]);
        const rms = (buffer: AudioBuffer) => {
          const plane = buffer.getChannelData(0);
          const start = Math.round(0.3 * buffer.sampleRate);
          const end = Math.round(0.8 * buffer.sampleRate);
          let energy = 0;
          for (let i = start; i < end; i++) energy += plane[i]! ** 2;
          return Math.sqrt(energy / (end - start));
        };
        return rms(result) / rms(added);
      } finally {
        await context.close();
      }
    },
    { resultWav, addedBytes },
  );
  expect(ratio).toBeGreaterThan(0.97);
  expect(ratio).toBeLessThan(1.03);
});

test('waveform lanes scale without decoding again when volume changes', async ({ page }) => {
  await load(page);
  await addAudio(page);
  const original = page.locator('canvas[data-track="original"]');
  const added = page.locator('canvas[data-track="added"]');
  await expect(original).toHaveAttribute('data-ready', 'true');
  await expect(added).toHaveAttribute('data-ready', 'true');
  const before = await original.getAttribute('data-peak');
  await page.getByLabel('Original volume (dB)', { exact: true }).fill('-6');
  await expect(original).not.toHaveAttribute('data-peak', before!);
  await expect(original).toHaveAttribute('data-gain', String(10 ** (-6 / 20)));
  await page.getByRole('checkbox', { name: 'Original audio', exact: true }).uncheck();
  await expect(original).toHaveAttribute('data-removed', 'true');
  await expect(page.getByText('Original · Removed', { exact: true })).toBeVisible();
});

test('preview graph sets separate original, added and master gains', async ({ page }) => {
  // WebKit can hand back a new AudioParam wrapper per access, so tag nothing: keep the recent
  // values from every gain update and check the expected set is among them.
  await page.addInitScript(() => {
    const state = window as Window & { mixGains?: number[] };
    const setTarget = AudioParam.prototype.setTargetAtTime;
    AudioParam.prototype.setTargetAtTime = function (value, start, constant) {
      state.mixGains = [...(state.mixGains ?? []).slice(-11), value];
      return setTarget.call(this, value, start, constant);
    };
  });
  await load(page);
  await addAudio(page);
  await page.getByLabel('Original volume (dB)', { exact: true }).fill('-6');
  await page.getByLabel('Added volume (dB)', { exact: true }).fill('-3');
  await page.getByLabel('Gain (dB)', { exact: true }).fill('-2');
  // CI WebKit can start the player muted, and the added track follows player mute and volume.
  await page.locator('.preview-video').evaluate(async (video: HTMLVideoElement) => {
    video.muted = false;
    video.volume = 1;
    await video.play();
  });
  await expect(page.locator('.preview-video')).toHaveJSProperty('muted', false);
  await expect(page.locator('.preview-video')).toHaveJSProperty('volume', 1);
  const recent = () =>
    page.evaluate(() =>
      ((window as Window & { mixGains?: number[] }).mixGains ?? []).map((v) => v.toFixed(4)),
    );
  const original = (10 ** (-6 / 20)).toFixed(4);
  const added = (10 ** (-3 / 20)).toFixed(4);
  const master = (10 ** (-2 / 20)).toFixed(4);
  await expect.poll(recent).toEqual(expect.arrayContaining([original, added, master]));
  await page.getByRole('checkbox', { name: 'Original audio', exact: true }).uncheck();
  await expect
    .poll(async () => {
      const values = await recent();
      return values.includes('0.0000') && !values.includes(original) && values.includes(added);
    })
    .toBe(true);
});

test('files without decodable audio show an error and preserve the existing mix', async ({
  page,
}) => {
  await load(page);
  await page.getByLabel('Added audio file', { exact: true }).setInputFiles(fixture('noaudio.mp4'));
  await expect(page.getByRole('alert')).toContainText('no decodable audio');
  await expect(page.getByRole('checkbox', { name: 'Original audio', exact: true })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Add music or audio', exact: true })).toBeVisible();
});

test('added track plays from one scheduled buffer without restarts', async ({ page }) => {
  await page.addInitScript(() => {
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args: Parameters<typeof start>) {
      // The fixture loops at 3 s; restarts there are a deliberate re-sync, so record the time.
      const state = window as Window & { addedStarts?: number[] };
      (state.addedStarts ??= []).push(document.querySelector('video')!.currentTime);
      return start.apply(this, args);
    };
  });
  await load(page);
  await addAudio(page);
  await page.locator('.preview-video').evaluate(async (node: HTMLVideoElement) => {
    node.currentTime = 0;
    await node.play();
  });
  const starts = () =>
    page.evaluate(() => (window as Window & { addedStarts?: number[] }).addedStarts ?? []);
  // Decoding finishes asynchronously; the first start marks the buffer playing.
  await expect.poll(async () => (await starts()).length).toBeGreaterThanOrEqual(1);
  await page.waitForTimeout(1500);
  const beforeLoop = (await starts()).filter((time) => time < 2.8);
  // Before the fix, a second media element was re-seeked several times a second.
  expect(beforeLoop.length).toBeLessThanOrEqual(2);
});

test('a longer added track slides by dragging or arrow keys on its waveform', async ({ page }) => {
  await load(page, 'land-4k60-aac.mp4');
  await addAudio(page);
  const lane = page.getByRole('slider', { name: 'Added audio position' });
  const offset = page.getByLabel('Added start offset (seconds)', { exact: true });
  await expect(lane).toHaveAttribute('aria-valuenow', '0');
  await expect(lane).toHaveAttribute('aria-valuemin', String(-2.9));
  await lane.focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft');
  await expect(lane).toHaveAttribute('aria-valuenow', '-0.5');
  await expect(lane).toHaveAttribute('aria-valuetext', '0.5 s into the track');
  await expect(offset).toHaveValue('-0.5');
  const box = (await lane.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  // A quarter of a 2 s strip is 0.5 s further into the track.
  await expect
    .poll(async () => Number(await lane.getAttribute('aria-valuenow')))
    .toBeCloseTo(-1, 1);
  const result = await exportWav(page);
  expect(result.durationSec).toBeCloseTo(2, 1);
});

test('a slid added track draws only inside the kept range', async ({ page }) => {
  await load(page, 'land-4k60-aac.mp4');
  const start = page.getByRole('slider', { name: 'Start', exact: true });
  await start.focus();
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
  await expect(start).toHaveAttribute('aria-valuenow', '1');
  await addAudio(page);
  const lane = page.getByRole('slider', { name: 'Added audio position' });
  await lane.focus();
  await page.keyboard.press('Home');
  await expect(lane).toHaveAttribute('aria-valuenow', '-2.9');
  await expect(lane).toHaveAttribute('data-ready', 'true');
  // At 20% of a 2 s strip (0.4 s) the source is trimmed away: only background and the axis.
  const stray = await page
    .locator('canvas[data-track="added"]')
    .evaluate((canvas: HTMLCanvasElement) => {
      const context = canvas.getContext('2d')!;
      const x = Math.floor(canvas.width * 0.2);
      const column = context.getImageData(x, 0, 1, canvas.height).data;
      const background = context.getImageData(x, 0, 1, 1).data.join();
      const axis = context.getImageData(x, Math.floor(canvas.height / 2), 1, 1).data.join();
      let count = 0;
      for (let i = 0; i < column.length; i += 4) {
        const pixel = column.slice(i, i + 4).join();
        if (pixel !== background && pixel !== axis) count++;
      }
      return count;
    });
  expect(stray).toBe(0);
});

test('preview shows a status while measuring mixed loudness', async ({ page }) => {
  await load(page);
  await addAudio(page);
  // A 3 s clip measures quickly, so record every status text instead of racing the check.
  await page.locator('.mix-waveform-status').evaluate((node) => {
    const seen: string[] = [];
    (window as Window & { statusSeen?: string[] }).statusSeen = seen;
    new MutationObserver(() => {
      if (!(node as HTMLElement).hidden) seen.push(node.textContent ?? '');
    }).observe(node, { attributes: true, childList: true, characterData: true, subtree: true });
  });
  await page.getByLabel('Normalize loudness', { exact: true }).selectOption('-16');
  await expect
    .poll(() => page.evaluate(() => (window as Window & { statusSeen?: string[] }).statusSeen))
    .toContain('Measuring loudness for the preview…');
  await expect(page.locator('.mix-waveform-status')).toBeHidden({ timeout: 15_000 });
});

import { expect, test, type Page } from '@playwright/test';
import type { CancelAt, ConvertResult } from './harness';
import type { AudioExtractSettings, AudioFormat } from '../src/core/audioExtract';
import type { Settings } from '../src/core/types';

const fixture = (name: string) => new URL(`../tests/fixtures/${name}`, import.meta.url).pathname;

const hd: Settings = {
  container: 'mp4',
  passthrough: false,
  trim: { start: 0, end: 3 },
  video: { codec: 'avc', width: 1920, height: 1080, fps: 30, bitrate: 2_000_000 },
  audio: { codec: 'aac', bitrate: 128_000, channels: 2, copy: false },
};

function ok(r: ConvertResult): Extract<ConvertResult, { ok: true }> {
  if (!r.ok) throw new Error(`${r.error.name}: ${r.error.message}`);
  return r;
}

async function convert(page: Page, settings: Settings, cancelAt?: CancelAt) {
  return page.evaluate(([s, c]) => window.vrHarness.convertToMemory(s, c), [
    settings,
    cancelAt,
  ] as const);
}

async function convertWithSamples(page: Page, settings: Settings) {
  return page.evaluate((s) => window.vrHarness.convertToMemory(s, 'never', true), settings);
}

test.describe('video conversion', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/e2e/harness.html');
    const canAvc = await page.evaluate(() => window.vrHarness.canEncodeVideo('avc', 1920, 1080));
    test.skip(!canAvc, 'This browser build has no H.264 WebCodecs encoder at 1920x1080');
  });

  test('converts a 1080p30 source and keeps its duration', async ({ page }) => {
    await page.setInputFiles('#file', fixture('land-1080p30-aac.mp4'));
    const r = ok(await convert(page, hd));
    expect(Math.abs(r.output.durationSec - 3)).toBeLessThanOrEqual(0.1);
    expect(r.output.video).toMatchObject({ codec: 'avc', displayWidth: 1920, displayHeight: 1080 });
    expect(r.output.audio).toMatchObject({ codec: 'aac', channels: 2 });
    expect(r.lastProgress).toBe(1);
    expect(r.reportedBytes).toBe(r.outputBytes);
  });

  test('target export fits under half the unconstrained re-encoded output', async ({ page }) => {
    await page.setInputFiles('#file', fixture('land-1080p30-aac.mp4'));
    const baseline = ok(await convert(page, hd));
    expect(baseline.outputBytes).toBeGreaterThanOrEqual(100_000);
    const targetBytes = Math.floor(baseline.outputBytes / 2);
    const result = ok(await convert(page, { ...hd, targetSizeMB: targetBytes / 1_000_000 }));
    expect(result.outputBytes).toBeLessThanOrEqual(targetBytes);
    expect(result.outputBytes).toBeGreaterThan(0);
    expect(Math.abs(result.output.durationSec - 3)).toBeLessThanOrEqual(0.1);
    expect(result.output.video?.codec).toBe('avc');
    expect(result.lastProgress).toBe(1);
    expect(result.reportedBytes).toBe(result.outputBytes);
  });

  test('rotated crop takes its rectangle from the rotated frame', async ({ page }) => {
    await page.setInputFiles('#file', fixture('crop-bands.mp4'));
    // A quarter turn clockwise moves the red left band to the top 140 rows of a 360x640 frame.
    const result = ok(
      await convertWithSamples(page, {
        ...hd,
        trim: { start: 0, end: 1 },
        video: { codec: 'avc', width: 360, height: 140, fps: 30, bitrate: 800_000 },
        audio: null,
        transform: {
          rotate: 90,
          flip: false,
          crop: 'free',
          rect: { left: 0, top: 0, width: 360, height: 140 },
        },
      }),
    );
    expect(result.output.video).toMatchObject({ displayWidth: 360, displayHeight: 140 });
    for (const [red, green, blue] of result.pixelSamples ?? []) {
      expect(red).toBeGreaterThan(green + 35);
      expect(red).toBeGreaterThan(blue + 35);
    }
  });

  test('square crop keeps centre pixels without stretching the full frame', async ({ page }) => {
    await page.setInputFiles('#file', fixture('crop-bands.mp4'));
    const result = ok(
      await convertWithSamples(page, {
        ...hd,
        trim: { start: 0, end: 1 },
        video: { codec: 'avc', width: 360, height: 360, fps: 30, bitrate: 800_000 },
        audio: null,
        transform: { rotate: 0, flip: false, crop: 'square' },
      }),
    );
    expect(result.output.video).toMatchObject({ displayWidth: 360, displayHeight: 360 });
    expect(result.pixelSamples).toHaveLength(3);
    for (const [red, green, blue] of result.pixelSamples ?? []) {
      expect(green).toBeGreaterThan(red + 35);
      expect(green).toBeGreaterThan(blue + 35);
    }
  });

  test('trims 0.5 s to 2.0 s', async ({ page }) => {
    await page.setInputFiles('#file', fixture('land-1080p30-aac.mp4'));
    const r = ok(await convert(page, { ...hd, trim: { start: 0.5, end: 2 } }));
    expect(Math.abs(r.output.durationSec - 1.5)).toBeLessThanOrEqual(0.1);
  });

  test('converts a source with no audio track', async ({ page }) => {
    await page.setInputFiles('#file', fixture('noaudio.mp4'));
    const r = ok(
      await convert(page, {
        ...hd,
        video: { codec: 'avc', width: 1280, height: 720, fps: 30, bitrate: 1_000_000 },
        audio: null,
      }),
    );
    expect(r.output.audio).toBeNull();
    expect(r.output.video).toMatchObject({ displayWidth: 1280, displayHeight: 720 });
    expect(Math.abs(r.output.durationSec - 3)).toBeLessThanOrEqual(0.1);
  });

  test('scales 4K 60 fps down to 1920x1080 at 30 fps', async ({ page }) => {
    await page.setInputFiles('#file', fixture('land-4k60-aac.mp4'));
    const r = ok(await convert(page, { ...hd, trim: { start: 0, end: 2 } }));
    expect(r.output.video).toMatchObject({ displayWidth: 1920, displayHeight: 1080 });
    expect(r.output.video!.fps).toBeGreaterThan(28);
    expect(r.output.video!.fps).toBeLessThan(32);
    expect(Math.abs(r.output.durationSec - 2)).toBeLessThanOrEqual(0.1);
  });

  for (const when of ['mid-run', 'at-start', 'immediately'] as const) {
    test(`cancel (${when}) rejects with ConversionCanceledError`, async ({ page }) => {
      await page.setInputFiles('#file', fixture('land-1080p30-aac.mp4'));
      const r = await convert(page, hd, when);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.name, r.error.message).toBe('ConversionCanceledError');
    });
  }

  test('file-stream MP4 output closes the writable exactly once and decodes', async ({ page }) => {
    await page.setInputFiles('#file', fixture('land-1080p30-aac.mp4'));
    const r = await page.evaluate((s) => window.vrHarness.convertToCountingStream(s), hd);
    expect(r.closeCalls).toBe(1);
    expect(r.abortCalls).toBe(0);
    const done = ok(r);
    expect(Math.abs(done.output.durationSec - 3)).toBeLessThanOrEqual(0.1);
    expect(done.output.video).toMatchObject({ displayWidth: 1920, displayHeight: 1080 });
    expect(done.reportedBytes).toBe(done.outputBytes);
  });

  test('rejects with ConversionInvalidError when no track is left to convert', async ({ page }) => {
    await page.setInputFiles('#file', fixture('noaudio.mp4'));
    const r = await convert(page, { ...hd, video: null, audio: null });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.name).toBe('ConversionInvalidError');
      expect(r.error.message).toContain('video track: discarded_by_user');
    }
  });
});

const audioSettings: AudioExtractSettings = {
  format: 'mp3',
  trim: { start: 0, end: 3 },
  bitrate: 128_000,
  channels: 2,
  copy: false,
};

async function extractAudio(
  page: Page,
  settings: AudioExtractSettings,
  sinkKind: 'memory' | 'file-stream',
) {
  return page.evaluate(
    ([s, kind]) => {
      const file = (document.getElementById('file') as HTMLInputElement).files?.[0];
      if (!file) throw new Error('No fixture selected');
      return window.vrHarness.extractAudio(file, s, kind);
    },
    [settings, sinkKind] as const,
  );
}

test.describe('audio extraction', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/e2e/harness.html');
    await page.setInputFiles('#file', fixture('land-1080p30-aac.mp4'));
  });

  for (const [format, codec] of [
    ['mp3', 'mp3'],
    ['m4a', 'aac'],
    ['wav', 'pcm-s16'],
  ] as const satisfies readonly (readonly [AudioFormat, string])[]) {
    test(`extracts ${format} to memory with audio only and source duration`, async ({ page }) => {
      const source = await page.evaluate(() => window.vrHarness.readSource());
      if (!source.ok) throw new Error(source.error.message);
      const result = ok(await extractAudio(page, { ...audioSettings, format }, 'memory'));
      expect(result.output.video).toBeNull();
      expect(result.output.audio?.codec).toBe(codec);
      expect(Math.abs(result.output.durationSec - source.info.durationSec)).toBeLessThanOrEqual(
        0.1,
      );
      expect(result.reportedBytes).toBe(result.outputBytes);
    });
  }

  test('copies trimmed M4A from 0.5 to 2.0 seconds', async ({ page }) => {
    const result = ok(
      await extractAudio(
        page,
        { ...audioSettings, format: 'm4a', trim: { start: 0.5, end: 2 }, copy: true },
        'memory',
      ),
    );
    expect(result.output.video).toBeNull();
    expect(result.output.audio?.codec).toBe('aac');
    expect(Math.abs(result.output.durationSec - 1.5)).toBeLessThanOrEqual(0.1);
  });

  for (const format of ['wav', 'mp3'] as const) {
    test(`extracts readable ${format} through file stream`, async ({ page }) => {
      const result = await extractAudio(page, { ...audioSettings, format }, 'file-stream');
      expect(result.closeCalls).toBe(1);
      expect(result.abortCalls).toBe(0);
      const done = ok(result);
      expect(done.output.video).toBeNull();
      expect(done.output.audio?.codec).toBe(format === 'wav' ? 'pcm-s16' : 'mp3');
      expect(Math.abs(done.output.durationSec - 3)).toBeLessThanOrEqual(0.1);
      expect(done.outputBytes).toBeGreaterThan(0);
      expect(done.reportedBytes).toBe(done.outputBytes);
    });
  }
});

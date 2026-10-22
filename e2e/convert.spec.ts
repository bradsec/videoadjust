import { expect, test, type Page } from '@playwright/test';
import type { CancelAt, ConvertResult } from './harness';
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

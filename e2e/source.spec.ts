import { expect, test, type Page } from '@playwright/test';
import type { ReadResult } from './harness';

const fixture = (name: string) => new URL(`../tests/fixtures/${name}`, import.meta.url).pathname;

async function read(page: Page): Promise<ReadResult> {
  return page.evaluate(() => window.vrHarness.readSource());
}

test.beforeEach(async ({ page }) => {
  await page.goto('/e2e/harness.html');
});

test('reads a 4K 60 fps source', async ({ page }) => {
  await page.setInputFiles('#file', fixture('land-4k60-aac.mp4'));
  const r = await read(page);
  if (!r.ok) throw new Error(r.error.message);
  expect(r.info.video).not.toBeNull();
  expect(r.info.video!.displayWidth).toBe(3840);
  expect(r.info.video!.displayHeight).toBe(2160);
  expect(r.info.video!.fps).toBeGreaterThan(55);
  expect(r.info.video!.fps).toBeLessThan(65);
  expect(r.info.audio).not.toBeNull();
});

test('reports portrait display size for a rotated source', async ({ page }) => {
  await page.setInputFiles('#file', fixture('portrait-rot90.mp4'));
  const r = await read(page);
  if (!r.ok) throw new Error(r.error.message);
  // Mediabunny reports clockwise rotation; the fixture's matrix may encode a quarter turn either way.
  expect([90, 270]).toContain(r.info.video!.rotation);
  expect(r.info.video!.displayWidth).toBe(1080);
  expect(r.info.video!.displayHeight).toBe(1920);
  expect(r.info.video!.displayWidth).toBeLessThan(r.info.video!.displayHeight);
});

test('reports no audio track when the source has none', async ({ page }) => {
  await page.setInputFiles('#file', fixture('noaudio.mp4'));
  const r = await read(page);
  if (!r.ok) throw new Error(r.error.message);
  expect(r.info.audio).toBeNull();
  expect(r.info.video).not.toBeNull();
});

test('rejects a renamed text file with UnsupportedSourceError', async ({ page }) => {
  await page.setInputFiles('#file', {
    name: 'notes.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.from('this is plain text, not a video'.repeat(100)),
  });
  const r = await read(page);
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.error.name).toBe('UnsupportedSourceError');
    expect(r.error.message).toMatch(/not a video/i);
  }
});

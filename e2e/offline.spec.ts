import { expect, test } from '@playwright/test';
import type { Capabilities } from '../src/core/types';

const fixture = (name: string) => new URL(`../tests/fixtures/${name}`, import.meta.url).pathname;

test('works offline after the first visit and converts a fixture', async ({ page, context }) => {
  test.setTimeout(90_000);
  // Memory sink: Playwright cannot drive the native save dialog.
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
  });
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  // Reload so the worker controls the page, which is what an owner's second visit looks like.
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect(page.getByRole('button', { name: 'Choose video' })).toBeVisible();

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Choose video' })).toBeVisible();

  await page.setInputFiles('#file', fixture('land-1080p30-aac.mp4'));
  const card = page.getByRole('region', { name: 'Export summary' });
  await expect(card).toBeVisible();
  const caps = JSON.parse((await page.locator('html').getAttribute('data-caps'))!) as Capabilities;
  test.skip(
    !Object.values(caps.video).some(Boolean),
    'This browser has no WebCodecs video encoder',
  );
  const reencode = page.getByRole('checkbox', { name: 'Re-encode anyway' });
  if (await reencode.isVisible()) await reencode.check();
  await card.getByRole('button', { name: /^Export/ }).click();
  await expect(page.locator('.verdict .figure')).toBeVisible({ timeout: 60_000 });
});

test('extracts MP3 offline from the precached encoder chunk', async ({ page, context }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
  });
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect(page.getByRole('button', { name: 'Choose video' })).toBeVisible();

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Choose video' })).toBeVisible();

  await page.setInputFiles('#file', fixture('land-1080p30-aac.mp4'));
  await page.getByRole('tab', { name: 'Extract audio' }).click();
  const panel = page.getByRole('region', { name: 'Audio summary' });
  await expect(panel.locator('h2')).toContainText('MP3');
  await panel.getByRole('button', { name: 'Extract audio' }).click();
  await expect(page.locator('.verdict')).toContainText('is ready to save or share', {
    timeout: 60_000,
  });
  await expect(page.locator('.stats').locator('tbody tr', { hasText: 'Codec' })).toContainText(
    'MP3',
  );
});

test('precache list covers the build and excludes the e2e harness', async ({ request }) => {
  const sw = await (await request.get('/sw.js')).text();
  expect(sw).not.toContain('__VM_');
  expect(sw).not.toContain('harness');
  expect(sw).toContain('index.html');
  expect(sw).toContain("cache: 'no-cache'");
  expect(sw).toMatch(/assets\/(?:index|main)-[\w-]+\.js/);
  expect(sw).toMatch(/aac-encoder[\w-]*\.js/);
  expect(sw).toMatch(/mp3-encoder[\w-]*\.js/);
});

test('offline navigation uses the current cache only, never an older version', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  // An older version's cache sorts first in caches.match, so a lookup across caches would hit it.
  await page.evaluate(async () => {
    const stale = await caches.open('videomate-0.0.0-old');
    const body = () =>
      new Response('<!doctype html><title>STALE</title>', {
        headers: { 'content-type': 'text/html' },
      });
    for (const url of ['./', './index.html', location.href])
      await stale.put(new URL(url, location.href).href, body());
    const names = await caches.keys();
    // Put the stale cache first in creation order by recreating the current ones after it.
    for (const name of names.filter((n) => n !== 'videomate-0.0.0-old')) {
      const cache = await caches.open(name);
      const entries = await cache.keys();
      const saved = await Promise.all(entries.map(async (r) => [r, await cache.match(r)] as const));
      await caches.delete(name);
      const fresh = await caches.open(name);
      for (const [r, res] of saved) await fresh.put(r, res!);
    }
  });
  await context.setOffline(true);
  await page.reload();
  await expect(page).not.toHaveTitle('STALE');
  await expect(page.getByRole('button', { name: 'Choose video' })).toBeVisible();
});

test('activation deletes caches left by the old videoresize name', async ({ page }) => {
  // Runs before the page registers the worker; install precaches the whole build, so the
  // legacy cache exists well before activate.
  await page.addInitScript(() => {
    void caches.open('videoresize-1.0.0');
  });
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect
    .poll(() =>
      page.evaluate(async () => (await caches.keys()).some((k) => k.startsWith('videoresize-'))),
    )
    .toBe(false);
  expect(
    await page.evaluate(async () => (await caches.keys()).some((k) => k.startsWith('videomate-'))),
  ).toBe(true);
});

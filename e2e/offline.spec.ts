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

test('precache list covers the build and excludes the e2e harness', async ({ request }) => {
  const sw = await (await request.get('/sw.js')).text();
  expect(sw).not.toContain('__VR_');
  expect(sw).not.toContain('harness');
  expect(sw).toContain('index.html');
  expect(sw).toContain("cache: 'no-cache'");
  expect(sw).toMatch(/assets\/(?:index|main)-[\w-]+\.js/);
  expect(sw).toMatch(/aac-encoder[\w-]*\.js/);
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
    const stale = await caches.open('videoresize-0.0.0-old');
    const body = () =>
      new Response('<!doctype html><title>STALE</title>', {
        headers: { 'content-type': 'text/html' },
      });
    for (const url of ['./', './index.html', location.href])
      await stale.put(new URL(url, location.href).href, body());
    const names = await caches.keys();
    // Put the stale cache first in creation order by recreating the current ones after it.
    for (const name of names.filter((n) => n !== 'videoresize-0.0.0-old')) {
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

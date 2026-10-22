import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import type { Capabilities } from '../src/core/types';

const fixture = (name: string) => new URL(`../tests/fixtures/${name}`, import.meta.url).pathname;

async function axeClean(page: Page) {
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);
}

test.beforeEach(({}, testInfo) => {
  test.skip(!['iphone', 'ipad'].includes(testInfo.project.name), 'Phone and tablet projects only');
});

test('portrait phone video: full flow keeps portrait orientation, axe clean in each state', async ({
  page,
}) => {
  test.setTimeout(90_000); // real encode plus four axe scans; slow when workers share the CPU
  // Memory sink, as on real iOS Safari: the result screen then compares both videos.
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
    delete (Window.prototype as unknown as Record<string, unknown>).showSaveFilePicker;
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Choose video' })).toBeVisible();
  await axeClean(page);

  await page.setInputFiles('#file', fixture('portrait-rot90.mp4'));
  const card = page.getByRole('region', { name: 'Export summary' });
  await expect(card).toBeVisible();
  const caps = JSON.parse((await page.locator('html').getAttribute('data-caps'))!) as Capabilities;
  test.skip(
    !Object.values(caps.video).some(Boolean),
    'This browser has no WebCodecs video encoder',
  );
  await axeClean(page);

  const reencode = page.getByRole('checkbox', { name: 'Re-encode anyway' });
  if (await reencode.isVisible()) await reencode.check();
  await card.getByRole('button', { name: /^Export/ }).click();
  await expect(page.locator('.verdict .figure')).toBeVisible({ timeout: 60_000 });

  // The result stats name the displayed size: portrait means height is the long edge.
  const videos = page.locator('.compare-stage video');
  const shown = videos.filter({ visible: true });
  await expect(shown.first()).toBeVisible();
  await expect
    .poll(() => shown.first().evaluate((v) => (v as HTMLVideoElement).readyState))
    .toBeGreaterThan(0);
  const dims = await videos.evaluateAll((all) =>
    all.map((v) => [(v as HTMLVideoElement).videoWidth, (v as HTMLVideoElement).videoHeight]),
  );
  const decoded = dims.filter(([w, h]) => w > 0 && h > 0);
  expect(decoded.length).toBeGreaterThan(0);
  for (const [w, h] of decoded) expect(w).toBeLessThan(h);
  await page.screenshot({ path: test.info().outputPath('compare-portrait.png') });

  await axeClean(page);
  await page.getByRole('button', { name: 'Start over' }).click();
  await expect(page.getByRole('button', { name: 'Choose video' })).toBeVisible();
});

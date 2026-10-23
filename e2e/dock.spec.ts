import { expect, test, type Page } from '@playwright/test';

const fixture = (name: string) => new URL(`../tests/fixtures/${name}`, import.meta.url).pathname;

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone', 'Phone layout only');
});

async function open(page: Page) {
  await page.goto('/');
  await page.setInputFiles('#file', fixture('land-1080p30-aac.mp4'));
  const card = page.getByRole('region', { name: 'Export summary' });
  await expect(card).toBeVisible();
  return card;
}

/** The dock and its action sit wholly inside the viewport without any scrolling. */
async function expectDockOnScreen(page: Page) {
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const card = page.getByRole('region', { name: 'Export summary' });
  const dock = card.locator('.dock');
  const box = (await dock.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  await expect(card.getByRole('button', { name: /^Export/ })).toBeInViewport({ ratio: 1 });
}

test('the dock is on screen on load', { tag: '@mobile' }, async ({ page }) => {
  await open(page);
  await expectDockOnScreen(page);
});

test('the dock is on screen with a notice above the trim', { tag: '@mobile' }, async ({ page }) => {
  // A tiny reported memory makes any in-memory export ask first, which shows a notice.
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => 1e-7 });
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
    delete (Window.prototype as unknown as Record<string, unknown>).showSaveFilePicker;
  });
  const card = await open(page);
  await card.getByRole('button', { name: /^Export/ }).click();
  await expect(page.getByRole('alert')).toContainText('may need about');
  await page.evaluate(() => window.scrollTo(0, 0));
  await expectDockOnScreen(page);
});

test(
  'the page reserves the dock height so the footer scrolls clear of it',
  { tag: '@mobile' },
  async ({ page }) => {
    const card = await open(page);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const dock = (await card.locator('.dock').boundingBox())!;
    const footer = (await page.locator('footer').boundingBox())!;
    expect(footer.y + footer.height).toBeLessThanOrEqual(dock.y + 1);
  },
);

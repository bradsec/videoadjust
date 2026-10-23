import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const fixture = (name: string) => new URL(`../tests/fixtures/${name}`, import.meta.url).pathname;

// --bg in src/styles/tokens.css; the app is dark only.
const DARK_BG = 'rgb(17, 20, 25)';

const bodyBackground = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test('the app is dark whatever the system colour scheme', async ({ browser }) => {
  const page = await browser.newPage({ colorScheme: 'light' });
  await page.goto('/');
  expect(await bodyBackground(page)).toBe(DARK_BG);
  await expect(page.getByRole('switch', { name: /theme/i })).toHaveCount(0);
  await page.close();
});

test('Start here and End here are filled buttons', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('#file', fixture('land-1080p30-aac.mp4'));
  const pageBg = await bodyBackground(page);
  for (const name of ['Start here', 'End here']) {
    const cue = page.getByRole('button', { name });
    await expect(cue).toBeVisible();
    const look = await cue.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        tag: node.tagName,
        background: style.backgroundColor,
        border: parseFloat(style.borderTopWidth),
        height: node.getBoundingClientRect().height,
      };
    });
    expect(look.tag).toBe('BUTTON');
    expect(look.background).not.toBe('rgba(0, 0, 0, 0)');
    expect(look.background).not.toBe(pageBg);
    expect(look.border).toBeGreaterThanOrEqual(1);
    expect(look.height).toBeGreaterThanOrEqual(44);
  }
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);
});

/** A save picker whose file never finishes a write, so the export stays on the working screen. */
async function stalledSavePicker(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { showSaveFilePicker: () => Promise<unknown> }).showSaveFilePicker =
      async () => ({
        createWritable: async () => new WritableStream({ write: () => new Promise(() => {}) }),
      });
  });
}

/** In-memory output, as on iOS Safari, so the result screen shows the comparison or player. */
async function memorySink(page: Page) {
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
    delete (Window.prototype as unknown as Record<string, unknown>).showSaveFilePicker;
  });
}

async function startExport(page: Page, tool: 'shrink' | 'audio') {
  await page.goto('/');
  await page.setInputFiles('#file', fixture('land-1080p30-aac.mp4'));
  if (tool === 'audio') {
    await page.getByRole('tab', { name: 'Extract audio' }).click();
    await page
      .getByRole('region', { name: 'Audio summary' })
      .getByRole('button', { name: 'Extract audio' })
      .click();
  } else {
    const card = page.getByRole('region', { name: 'Export summary' });
    await expect(card).toBeVisible();
    // Re-encode as the other export tests do. A trimmed copy finishes within about 100 ms, and
    // Playwright WebKit can then block its main thread in the preview video's load() teardown.
    const reencode = card.getByRole('checkbox', { name: 'Re-encode anyway' });
    if (await reencode.isVisible()) await reencode.check();
    await card.getByRole('button', { name: /^Export/ }).click();
  }
}

for (const tool of ['shrink', 'audio'] as const) {
  test(`the ${tool} working screen is axe clean`, async ({ page }) => {
    await stalledSavePicker(page);
    await startExport(page, tool);
    await expect(page.getByRole('button', { name: 'Cancel export' })).toBeVisible({
      timeout: 30_000,
    });
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations).toEqual([]);
  });

  test(`the ${tool} result screen is axe clean`, async ({ page }) => {
    test.setTimeout(90_000); // a real export; slow when workers share the CPU
    await memorySink(page);
    await startExport(page, tool);
    await expect(page.locator('.verdict .figure')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('link', { name: /Download/ })).toBeVisible();
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations).toEqual([]);
  });
}

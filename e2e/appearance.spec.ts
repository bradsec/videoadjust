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

test('trim Set buttons stay compact with touch targets', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('#file', fixture('land-1080p30-aac.mp4'));
  const pageBg = await bodyBackground(page);
  for (const name of ['Set start to playhead', 'Set end to playhead']) {
    const cue = page.getByRole('button', { name });
    await expect(cue).toBeVisible();
    await expect(cue).toHaveAttribute('title', name);
    const look = await cue.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        tag: node.tagName,
        background: style.backgroundColor,
        border: parseFloat(style.borderTopWidth),
        height: node.getBoundingClientRect().height,
        width: node.getBoundingClientRect().width,
        text: node.textContent?.trim(),
      };
    });
    expect(look.tag).toBe('BUTTON');
    expect(look.background).not.toBe('rgba(0, 0, 0, 0)');
    expect(look.background).not.toBe(pageBg);
    expect(look.border).toBeGreaterThanOrEqual(1);
    expect(look.height).toBeGreaterThanOrEqual(44);
    expect(look.width).toBeGreaterThanOrEqual(24);
    expect(look.width).toBeLessThan(120);
    expect(look.text).toBe('Set');
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
  test(`the ${tool} working screen is axe clean`, { tag: '@mobile' }, async ({ page }) => {
    await stalledSavePicker(page);
    await startExport(page, tool);
    await expect(page.getByRole('button', { name: 'Cancel export' })).toBeVisible({
      timeout: 30_000,
    });
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations).toEqual([]);
  });

  test(`the ${tool} result screen is axe clean`, { tag: '@mobile' }, async ({ page }) => {
    test.setTimeout(90_000); // a real export; slow when workers share the CPU
    await memorySink(page);
    await startExport(page, tool);
    await expect(page.locator('.verdict .figure')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('link', { name: /Download/ })).toBeVisible();
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations).toEqual([]);
  });
}

test('phone taps do not zoom the page', { tag: '@mobile' }, async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('#file', fixture('land-1080p30-aac.mp4'));
  await expect(page.getByRole('region', { name: 'Export summary' })).toBeVisible();
  for (const details of await page.locator('details').all())
    await details.evaluate((node) => ((node as HTMLDetailsElement).open = true));
  // Inspector sections open one at a time, so reopen Overlay after the later sections.
  await page
    .locator('.overlay-adjust')
    .evaluate((node) => ((node as HTMLDetailsElement).open = true));
  await page.getByLabel('Text overlay', { exact: true }).check();
  const look = await page.evaluate(() => ({
    touchAction: getComputedStyle(document.documentElement).touchAction,
    pageWidth: document.documentElement.scrollWidth,
    viewWidth: document.documentElement.clientWidth,
    // iOS zooms into any text field under 16px when it takes focus.
    small: [...document.querySelectorAll('textarea, select, input')]
      .filter(
        (node) => !/^(checkbox|range|color|file|hidden)$/.test((node as HTMLInputElement).type),
      )
      .filter((node) => parseFloat(getComputedStyle(node).fontSize) < 16)
      .map((node) => node.getAttribute('aria-label') ?? node.tagName),
  }));
  expect(look.touchAction).toBe('manipulation');
  expect(look.small).toEqual([]);
  expect(look.pageWidth).toBeLessThanOrEqual(look.viewWidth);
});

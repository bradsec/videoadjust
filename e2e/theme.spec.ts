import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const fixture = (name: string) => new URL(`../tests/fixtures/${name}`, import.meta.url).pathname;

// --bg in src/styles/tokens.css for each theme.
const DARK_BG = 'rgb(18, 17, 16)';
const LIGHT_BG = 'rgb(245, 241, 234)';

const bodyBackground = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test.describe('with a light system colour scheme', () => {
  test.use({ colorScheme: 'light' });

  test('dark is the default', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await bodyBackground(page)).toBe(DARK_BG);
    await expect(page.getByRole('switch', { name: 'Light theme' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });
});

test('the switch turns on the light theme and it persists across reload', async ({ page }) => {
  await page.goto('/');
  const toggle = page.getByRole('switch', { name: 'Light theme' });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await bodyBackground(page)).toBe(LIGHT_BG);
  expect(await page.evaluate(() => localStorage.getItem('videoadjust-theme'))).toBe('light');

  await page.reload();
  await expect(page.getByRole('switch', { name: 'Light theme' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await bodyBackground(page)).toBe(LIGHT_BG);
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);

  await page.getByRole('switch', { name: 'Light theme' }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('switch', { name: 'Light theme' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
});

test('theme-init.js applies the saved theme without the app bundle', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('videoadjust-theme', 'light'));
  // With the app module blocked, only the same-origin head script can set the theme.
  await page.route(/\/assets\/[^/]+\.js$/, (route) => route.abort());
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await bodyBackground(page)).toBe(LIGHT_BG);
  await expect(page.locator('#app')).toBeEmpty();
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#f5f1ea');
});

test('falls back to dark when storage throws, and the switch still works', async ({ page }) => {
  await page.addInitScript(() => {
    const fail = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
    Object.defineProperty(Storage.prototype, 'getItem', { value: fail });
    Object.defineProperty(Storage.prototype, 'setItem', { value: fail });
  });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const toggle = page.getByRole('switch', { name: 'Light theme' });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('the service worker precaches theme-init.js', async ({ request }) => {
  const sw = await (await request.get('/sw.js')).text();
  // The build writes the list as one string literal joined with an escaped newline.
  const list = /const PRECACHE = '([^']*)'/.exec(sw)?.[1]?.split('\\n');
  expect(list).toContain('./theme-init.js');
});

for (const theme of ['dark', 'light'] as const) {
  test(`Start here and End here are filled buttons in the ${theme} theme`, async ({ page }) => {
    if (theme === 'light')
      await page.addInitScript(() => localStorage.setItem('videoadjust-theme', 'light'));
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
}

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
  await page.addInitScript(() => localStorage.setItem('videoadjust-theme', 'light'));
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
  test(`light theme: the ${tool} working screen is axe clean`, async ({ page }) => {
    await stalledSavePicker(page);
    await startExport(page, tool);
    await expect(page.getByRole('button', { name: 'Cancel export' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations).toEqual([]);
  });

  test(`light theme: the ${tool} result screen is axe clean`, async ({ page }) => {
    test.setTimeout(90_000); // a real export; slow when workers share the CPU
    await memorySink(page);
    await startExport(page, tool);
    await expect(page.locator('.verdict .figure')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('link', { name: /Download/ })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations).toEqual([]);
  });
}

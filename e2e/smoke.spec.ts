import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test(
  'loads, has no axe violations, makes no cross-origin requests',
  { tag: '@mobile' },
  async ({ page, baseURL }) => {
    const origin = new URL(baseURL!).host;
    const foreign: string[] = [];
    page.on('request', (req) => {
      const url = new URL(req.url());
      if (url.protocol.startsWith('http') && url.host !== origin) foreign.push(req.url());
    });

    await page.goto('/');
    await expect(page).toHaveTitle('videoadjust - Private Video Editor in Your Browser');

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
    expect(foreign).toEqual([]);
  },
);

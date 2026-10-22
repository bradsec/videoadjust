import { expect, test } from '@playwright/test';

test('ships third-party licences and links them', async ({ page, request }) => {
  const res = await request.get('./THIRD-PARTY-LICENSES.txt');
  expect(res.status()).toBe(200);
  const text = await res.text();
  expect(text).toContain('LGPL');
  expect(text).toContain('FFmpeg');
  expect(text).toContain('GNU LESSER GENERAL PUBLIC LICENSE');
  expect(text).toContain('Mozilla Public License Version 2.0');

  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Licences' })).toHaveAttribute(
    'href',
    './THIRD-PARTY-LICENSES.txt',
  );
});

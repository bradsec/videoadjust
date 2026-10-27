import { expect, test } from '@playwright/test';

const fixture = new URL('../tests/fixtures/land-1080p30-aac.mp4', import.meta.url).pathname;

test('Fit controls update Shrink and GIF dimensions and Reset all clears Fit', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('#file', fixture);
  const fit = page.locator('.fit-adjust');
  await fit.locator('summary').click();
  await page.getByLabel('Fit aspect').selectOption('1:1');
  await expect(fit.locator('.adjust-state')).toHaveText('1 change');
  const ratio = await page.locator('.live-preview-stage').evaluate((node) => {
    const [width, height] = getComputedStyle(node).aspectRatio.split('/').map(Number);
    return width! / height!;
  });
  expect(ratio).toBeCloseTo(1, 2);
  const original = page.getByRole('button', { name: 'Show original' });
  await original.scrollIntoViewIfNeeded();
  const frame = page.locator('.live-preview-frame');
  const before = (await frame.boundingBox())!;
  await original.click();
  const after = (await frame.boundingBox())!;
  for (const key of ['x', 'y', 'width', 'height'] as const)
    expect(after[key]).toBeCloseTo(before[key], 0);
  await original.click();
  await page.getByLabel('Fit background').selectOption('color');
  await page.getByLabel('Fit solid colour').evaluate((node) => {
    const input = node as HTMLInputElement;
    input.value = '#123456';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.getByRole('tab', { name: 'GIF' }).click();
  await expect(page.getByLabel('Fit aspect')).toHaveValue('1:1');
  await expect(page.getByRole('region', { name: 'GIF summary' })).toContainText('320x320 GIF');
  await page.getByRole('button', { name: 'Reset to auto: Fit to aspect' }).click();
  await expect(page.getByLabel('Fit aspect')).toHaveValue('off');
  await page.getByLabel('Fit aspect').selectOption('4:5');
  const summary = page.getByRole('region', { name: 'GIF summary' });
  await summary.getByRole('button', { name: 'Reset all' }).click();
  await summary.getByRole('button', { name: 'Confirm reset' }).click();
  await expect(page.getByLabel('Fit aspect')).toHaveValue('off');
});

import AxeBuilder from '@axe-core/playwright';
import { openSection } from './sections';
import { expect, test } from '@playwright/test';

const fixture = new URL('../tests/fixtures/land-1080p30-aac.mp4', import.meta.url).pathname;
test.setTimeout(120_000);

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('#file', fixture);
  await expect(page.getByRole('region', { name: 'Export summary' })).toBeVisible();
});

test('Cancel and Escape preserve settings; Confirm reset restores all defaults', async ({
  page,
}) => {
  const card = page.getByRole('region', { name: 'Export summary' });
  const count = card.locator('.reset-all .adjust-state');
  const reset = card.getByRole('button', { name: 'Reset all', exact: true });
  await expect(count).toHaveText('All automatic');
  await expect(reset).toBeDisabled();
  const fullEnd = await page
    .getByRole('slider', { name: 'End', exact: true })
    .getAttribute('aria-valuenow');
  await page.getByRole('slider', { name: 'Start', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  const trimStart = await page
    .getByRole('slider', { name: 'Start', exact: true })
    .getAttribute('aria-valuenow');
  await page.locator('.style-adjust > summary').click();
  const style = page.getByLabel('Video style', { exact: true });
  await style.selectOption('cinematic');
  const exposure = page.getByLabel('Exposure (stops)', { exact: true });
  await exposure.evaluate((input: HTMLInputElement) => {
    input.value = '1';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const gain = page.getByLabel('Gain (dB)', { exact: true });
  await gain.evaluate((input: HTMLInputElement) => {
    input.value = '-6';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await card.locator('summary').click();
  const precision = card.getByLabel('Trim precision', { exact: true });
  await precision.selectOption('exact');
  await page.getByRole('button', { name: 'Theater mode', exact: true }).click();
  const changed = await count.textContent();

  await reset.click();
  await expect(card.getByRole('button', { name: 'Confirm reset', exact: true })).toBeFocused();
  await expect(card.locator('.reset-all-status')).toContainText('cannot be undone');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await card.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(reset).toBeFocused();
  await expect(count).toHaveText(changed!);
  await expect(style).toHaveValue('cinematic');
  await expect(exposure).toHaveValue('1');
  await expect(gain).toHaveValue('-6');
  await expect(precision).toHaveValue('exact');
  await expect(page.getByRole('slider', { name: 'Start', exact: true })).toHaveAttribute(
    'aria-valuenow',
    trimStart!,
  );

  await reset.click();
  await gain.focus();
  await page.keyboard.press('Escape');
  await expect(reset).toBeFocused();
  await expect(count).toHaveText(changed!);
  await expect(card.getByRole('button', { name: 'Cancel', exact: true })).toBeHidden();

  await reset.click();
  await card.getByRole('button', { name: 'Confirm reset', exact: true }).click();
  await expect(count).toHaveText('All automatic');
  await expect(reset).toBeDisabled();
  await expect(count).toBeFocused();
  await expect(
    page.locator('.toast', { hasText: 'All settings reset to automatic defaults.' }),
  ).toBeVisible();
  await expect(style).toHaveValue('none');
  await expect(exposure).toHaveValue('0');
  await expect(page.getByLabel('Contrast', { exact: true })).toHaveValue('1');
  await expect(page.getByLabel('Saturation', { exact: true })).toHaveValue('1');
  await expect(page.getByLabel('Temperature', { exact: true })).toHaveValue('0');
  await expect(gain).toHaveValue('0');
  await expect(precision).toHaveValue('fast');
  await expect(page.getByRole('slider', { name: 'Start', exact: true })).toHaveAttribute(
    'aria-valuenow',
    '0',
  );
  await expect(page.getByRole('slider', { name: 'End', exact: true })).toHaveAttribute(
    'aria-valuenow',
    fullEnd!,
  );
  await openSection(page, 'audio');
  await expect(page.getByRole('checkbox', { name: 'Original audio', exact: true })).toBeChecked();
  await expect(page.getByLabel('Original volume (dB)', { exact: true })).toHaveValue('0');
  await expect(page.getByRole('tab', { name: 'Shrink video', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('button', { name: 'Theater mode', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.file-name')).toHaveText('land-1080p30-aac.mp4');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

for (const [tool, summary] of [
  ['Extract audio', 'Audio summary'],
  ['GIF', 'GIF summary'],
] as const) {
  test(`Reset all from ${tool} clears settings on other tabs and releases added audio`, async ({
    page,
  }) => {
    await page.getByLabel('Gain (dB)', { exact: true }).evaluate((input: HTMLInputElement) => {
      input.value = '-6';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const added = new URL('../tests/fixtures/mono-aac.mp4', import.meta.url).pathname;
    await page.getByLabel('Added audio file', { exact: true }).setInputFiles(added);
    await openSection(page, 'audio');
    await expect(page.getByText('Added audio: mono-aac.mp4', { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: tool, exact: true }).click();
    const card = page.getByRole('region', { name: summary });
    await card.getByRole('button', { name: 'Reset all', exact: true }).click();
    await card.getByRole('button', { name: 'Confirm reset', exact: true }).click();
    await expect(card.locator('.reset-all .adjust-state')).toHaveText('All automatic');
    await expect(page.getByRole('tab', { name: tool, exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(card.locator('.reset-all .adjust-state')).toBeFocused();
    await page.getByRole('tab', { name: 'Shrink video', exact: true }).click();
    await expect(page.getByLabel('Gain (dB)', { exact: true })).toHaveValue('0');
    await expect(page.getByText('Added audio: mono-aac.mp4', { exact: true })).toHaveCount(0);
    await expect(page.locator('canvas[data-track="added"]')).toBeHidden();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
}

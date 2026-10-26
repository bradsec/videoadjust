import { expect, test } from '@playwright/test';

test('Help opens with shortcuts and returns focus on Escape', async ({ page }) => {
  await page.goto('/');
  const helpButton = page.locator('header').getByRole('button', { name: 'Help' });
  await helpButton.click();
  const dialog = page.getByRole('dialog', { name: 'Help' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(helpButton).toBeFocused();
});

test('Help fits and keeps Close visible @mobile', async ({ page }) => {
  await page.goto('/');
  await page.locator('header').getByRole('button', { name: 'Help' }).click();
  const dialog = page.getByRole('dialog', { name: 'Help' });
  await expect(dialog).toBeVisible();
  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  const viewport = page.viewportSize()!;
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
  const close = dialog.getByRole('button', { name: 'Close' });
  await expect(close).toBeInViewport();
  await close.click();
  await expect(dialog).toBeHidden();
});

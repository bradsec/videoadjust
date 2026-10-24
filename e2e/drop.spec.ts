import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const fixture = (name: string) => new URL(`../tests/fixtures/${name}`, import.meta.url).pathname;

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

/**
 * Drops a File whose size property is overridden, so the over-2-GB path runs
 * without 2 GB of data. The 8 real bytes are not a video, and a reader that
 * trusts the fake size may wait for bytes that do not exist (WebKit does), so
 * tests assert that reading starts and do not wait for it to finish.
 */
async function dropSyntheticFile(page: Page, name: string, size: number) {
  await page.evaluate(
    ([n, s]) => {
      const file = new File([new Uint8Array(8)], n as string, { type: 'video/mp4' });
      Object.defineProperty(file, 'size', { value: s });
      const dt = new DataTransfer();
      dt.items.add(file);
      document
        .querySelector('.dropzone')!
        .dispatchEvent(
          new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }),
        );
    },
    [name, size] as const,
  );
}

// Reading is under way (status text) or has already failed (alert), depending on engine speed.
const readingOrFailed = (page: Page) => page.locator('[role=status]:not(:empty), [role=alert]');

test('shows the drop zone and says files stay on this device', async ({ page }) => {
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByText('Stays on this device')).toBeVisible();
  await expect(page.getByText('Nothing is uploaded')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose video' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'About', exact: true })).toBeVisible();
});

test('opens the native picker from the Choose video button', async ({ page }) => {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose video' }).click();
  expect((await chooser).isMultiple()).toBe(false);
});

test(
  'moves to the prepare state with the file name and summary',
  { tag: '@mobile' },
  async ({ page }) => {
    await page.setInputFiles('#file', fixture('land-1080p30-aac.mp4'));
    await expect(
      page.getByRole('heading', { level: 1, name: 'land-1080p30-aac.mp4' }),
    ).toBeVisible();
    await expect(page.locator('.file-summary')).toContainText('1920x1080');
    await expect(page.locator('.file-summary')).toContainText('30 fps');
    await expect(page.locator('.file-summary')).toContainText('H.264');
    await expect(page.getByRole('button', { name: 'Choose video' })).toHaveCount(0);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  },
);

test('shows an error naming the problem for a non-video and stays on the drop screen', async ({
  page,
}) => {
  await page.setInputFiles('#file', {
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('this is not a video'),
  });
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('not a video');
  await expect(alert).toContainText('notes.txt');
  await expect(page.getByRole('button', { name: 'Choose video' })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('warns before reading a file over 2 GB and offers Continue', async ({ page }) => {
  await dropSyntheticFile(page, 'huge.mp4', 2.6e9);
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('2.6 GB');
  await expect(alert.getByRole('button', { name: 'Continue anyway' })).toBeVisible();

  // Choosing another video clears the warning.
  await alert.getByRole('button', { name: 'Choose another video' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);

  // Continue starts reading the file.
  await dropSyntheticFile(page, 'huge.mp4', 2.6e9);
  await page.getByRole('button', { name: 'Continue anyway' }).click();
  await expect(readingOrFailed(page)).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Continue anyway' })).toHaveCount(0);
  await expect(page.getByRole('alert').filter({ hasText: 'GB' })).toHaveCount(0);
});

test('a file at exactly 2 GB is read without a warning', async ({ page }) => {
  await dropSyntheticFile(page, 'edge.mp4', 2e9);
  await expect(readingOrFailed(page)).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Continue anyway' })).toHaveCount(0);
  await expect(page.getByRole('alert').filter({ hasText: 'GB' })).toHaveCount(0);
});

test('footer links to the GitHub repo and opens About with the version', async ({ page }) => {
  const { version } = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { version: string };
  await page.goto('/');
  const repo = page.getByRole('link', { name: `videoadjust v${version} on GitHub` });
  await expect(repo).toHaveAttribute('href', 'https://github.com/bradsec/videoadjust');
  await expect(repo).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(page.locator('footer')).not.toContainText('Licences');
  await expect(page.locator('footer .footer-links')).toContainText(`v${version}`);

  await page.getByRole('button', { name: 'About', exact: true }).click();
  const about = page.getByRole('dialog', { name: 'About videoadjust' });
  await expect(about).toBeVisible();
  await expect(about).toContainText(`Version ${version}`);
  await expect(about).toContainText('works offline after your first visit');
  await expect(about.getByRole('link', { name: 'View third-party licences' })).toHaveAttribute(
    'href',
    './THIRD-PARTY-LICENSES.txt',
  );
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);
  await about.getByRole('button', { name: 'Close' }).click();
  await expect(about).toBeHidden();
  await page.getByRole('button', { name: 'About', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(about).toBeHidden();
});

import type { Page } from '@playwright/test';

export type Section = 'audio' | 'colour' | 'style' | 'overlay';

/** Inspector sections open one at a time, so open the one a test needs before using it. */
export async function openSection(page: Page, section: Section): Promise<void> {
  const details = page.locator(`.${section}-adjust`);
  if (!(await details.evaluate((node: HTMLDetailsElement) => node.open)))
    await details.locator('> summary').click();
}

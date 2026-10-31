import { expect, test } from '@playwright/test';

test(
  'AAC with a negative first packet timestamp re-encodes',
  { tag: '@mobile' },
  async ({ page }) => {
    await page.goto('/e2e/harness.html');
    await page.setInputFiles(
      '#file',
      new URL('../tests/fixtures/land-aac-only.m4a', import.meta.url).pathname,
    );
    const result = await page.evaluate(async () => {
      const file = (document.getElementById('file') as HTMLInputElement).files![0];
      return window.vrHarness.extractAudio(
        file,
        { format: 'm4a', trim: { start: 0, end: 3 }, bitrate: 128_000, channels: 2, copy: false },
        'memory',
      );
    });
    if (!result.ok) throw new Error(`${result.error.name}: ${result.error.message}`);
    expect(result.output.audio?.codec).toBe('aac');
    expect(result.outputBytes).toBeGreaterThan(0);
  },
);

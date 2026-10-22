import { expect, test, type Locator, type Page } from '@playwright/test';
import type { Capabilities } from '../src/core/types';

const fixture = new URL('../tests/fixtures/land-1080p30-aac.mp4', import.meta.url).pathname;

const MAX_WIDTH_DRIFT_PX = 0.5;

type Sample = { text: string; width: number };

async function measure(locator: Locator) {
  const text = (await locator.textContent()) ?? '';
  const box = await locator.boundingBox();
  if (!box) throw new Error('readout has no box');
  return { text, width: box.width };
}

/** Every sample has the same text length and, within half a pixel, the same rendered width. */
function expectSteady(samples: Sample[]) {
  const first = samples[0]!;
  for (const s of samples) {
    expect(s.text.length, `${s.text} vs ${first.text}`).toBe(first.text.length);
    expect(Math.abs(s.width - first.width), `${s.text} vs ${first.text}`).toBeLessThanOrEqual(
      MAX_WIDTH_DRIFT_PX,
    );
  }
}

test('trim readouts keep one width as the tenths pass zero', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('#file', fixture);
  const start = page.getByRole('slider', { name: 'Start' });
  await expect(start).toBeVisible();
  const startValue = page.locator('.trim-readout').first().locator('output');
  const endValue = page.locator('.trim-readout').last().locator('output');
  const kept = page.locator('.trim-head .num');

  await start.focus();
  const startSamples: Sample[] = [];
  const endSamples: Sample[] = [];
  const keptSamples: Sample[] = [];
  const sample = async () => {
    startSamples.push(await measure(startValue));
    endSamples.push(await measure(endValue));
    keptSamples.push(await measure(kept));
  };
  await sample();
  await page.keyboard.press('Shift+ArrowRight');
  await expect(startValue).toHaveText('0:01.0');
  await page.locator('.trim-readouts').screenshot({
    path: test.info().outputPath('trim-readouts-whole-second.png'),
  });
  await sample();
  await page.keyboard.press('ArrowRight');
  await expect(startValue).toHaveText('0:01.1');
  await sample();
  await page.keyboard.press('ArrowRight');
  await expect(startValue).toHaveText('0:01.2');
  await sample();

  const end = page.getByRole('slider', { name: 'End' });
  await end.focus();
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(endValue).toHaveText('0:02.0');
  await sample();
  await page.keyboard.press('ArrowLeft');
  await expect(endValue).toHaveText('0:01.9');
  await sample();

  expectSteady(startSamples);
  expectSteady(endSamples);
  expectSteady(keptSamples);
});

async function resultPage(page: Page) {
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
    delete (Window.prototype as unknown as Record<string, unknown>).showSaveFilePicker;
  });
  await page.goto('/');
  await page.setInputFiles('#file', fixture);
  const card = page.getByRole('region', { name: 'Export summary' });
  await expect(card).toBeVisible();
  const caps = JSON.parse((await page.locator('html').getAttribute('data-caps'))!) as Capabilities;
  test.skip(
    !Object.values(caps.video).some(Boolean),
    'This browser has no WebCodecs video encoder',
  );
  const box = page.getByRole('checkbox', { name: 'Re-encode anyway' });
  if (await box.isVisible()) await box.check();
  await card.getByRole('button', { name: /^Export/ }).click();
  await expect(page.locator('.compare-stage video')).toHaveCount(2, { timeout: 60_000 });
}

test('the compare clock keeps one width at whole-second, tenth and hundredth positions', async ({
  page,
}) => {
  await resultPage(page);
  const clock = page.locator('.scrub-time');
  const output = page.locator('.compare-new');
  await output.evaluate((node) => (node as HTMLVideoElement).pause());
  const samples: Sample[] = [];
  for (const t of [1, 1.1, 1.25]) {
    await output.evaluate(
      (node, to) =>
        new Promise<void>((resolve) => {
          const v = node as HTMLVideoElement;
          v.addEventListener('seeked', () => resolve(), { once: true });
          v.currentTime = to;
        }),
      t,
    );
    await expect(clock).toHaveText(/^\d:\d\d\.\d \/ \d:\d\d\.\d$/);
    samples.push(await measure(clock));
  }
  expectSteady(samples);
});

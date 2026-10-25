import { expect, test, type Page } from '@playwright/test';

const fixture = new URL('../tests/fixtures/crop-bands.mp4', import.meta.url).pathname;
const landscapeFixture = new URL('../tests/fixtures/land-1080p30-aac.mp4', import.meta.url)
  .pathname;

async function expectPreviewFits(page: Page, expectedAspect: number, edited: boolean) {
  const stageElement = page.locator('.live-preview-stage');
  await expect
    .poll(() =>
      stageElement.evaluate((node) => {
        const stage = node.getBoundingClientRect();
        const frame = node.firstElementChild!.getBoundingClientRect();
        return frame.bottom - stage.bottom;
      }),
    )
    .toBeLessThanOrEqual(1);
  const stage = (await stageElement.boundingBox())!;
  const frame = (await page.locator('.live-preview-frame').boundingBox())!;
  const video = page.locator('.preview-video');
  const videoBox = (await video.boundingBox())!;
  const bar = (await page.locator('.live-preview-bar').boundingBox())!;

  expect(frame.x).toBeGreaterThanOrEqual(stage.x - 1);
  expect(frame.y).toBeGreaterThanOrEqual(stage.y - 1);
  expect(frame.x + frame.width).toBeLessThanOrEqual(stage.x + stage.width + 1);
  expect(frame.y + frame.height).toBeLessThanOrEqual(stage.y + stage.height + 1);
  expect(Math.abs(frame.x + frame.width / 2 - stage.x - stage.width / 2)).toBeLessThanOrEqual(2);
  expect(
    Math.abs((await stageElement.evaluate((node) => node.clientHeight)) - stage.height),
  ).toBeLessThanOrEqual(1);
  expect(stage.y).toBeGreaterThanOrEqual(-1);
  expect(stage.y + stage.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  expect(bar.y).toBeGreaterThanOrEqual(-1);
  expect(bar.y + bar.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  if (edited) {
    expect(Math.abs(frame.width / frame.height / expectedAspect - 1)).toBeLessThanOrEqual(0.02);
    const intendedHeight = await video.evaluate((node) => parseFloat(node.style.height));
    expect(Math.abs(videoBox.height - intendedHeight)).toBeLessThanOrEqual(1);
  } else {
    expect(videoBox.x).toBeGreaterThanOrEqual(stage.x - 1);
    expect(videoBox.y).toBeGreaterThanOrEqual(stage.y - 1);
    expect(videoBox.x + videoBox.width).toBeLessThanOrEqual(stage.x + stage.width + 1);
    expect(videoBox.y + videoBox.height).toBeLessThanOrEqual(stage.y + stage.height + 1);
    await expect(video).toHaveCSS('object-fit', 'contain');
    await expect
      .poll(() => video.evaluate((node: HTMLVideoElement) => node.videoWidth / node.videoHeight))
      .toBeGreaterThan(0);
    const sourceAspect = await video.evaluate(
      (node: HTMLVideoElement) => node.videoWidth / node.videoHeight,
    );
    expect(Math.abs(sourceAspect / expectedAspect - 1)).toBeLessThanOrEqual(0.02);
  }
}

for (const theater of [true, false]) {
  test(`landscape crop fits the preview${theater ? ' in theater mode' : ''}`, async ({
    page,
  }, testInfo) => {
    test.skip(['iphone', 'ipad'].includes(testInfo.project.name), 'Desktop projects only');
    await page.setViewportSize(
      theater ? { width: 2000, height: 1017 } : { width: 1440, height: 900 },
    );
    await page.goto('/');
    await page.setInputFiles('#file', landscapeFixture);
    await expect(page.getByRole('region', { name: 'Export summary' })).toBeVisible();
    if (theater) await page.getByRole('button', { name: 'Theater mode' }).click();
    await expectPreviewFits(page, 1920 / 1080, false);
    const sourceHeight = await page
      .locator('.preview-video')
      .evaluate((video: HTMLVideoElement) => video.videoHeight);

    await page.getByRole('button', { name: 'Crop and rotate' }).click();
    await page.getByLabel('Crop aspect ratio').selectOption('landscape');
    const narrower = page
      .getByRole('group', { name: 'Size' })
      .getByRole('button', { name: 'Narrower' });
    for (let step = 0; step < 20; step++) await narrower.click();
    const cropLabel = await page
      .getByRole('group', { name: /Crop selection/ })
      .getAttribute('aria-label');
    const [, cropWidth, cropHeight] = cropLabel!.match(/(\d+) by (\d+) pixels/)!;
    expect(Number(cropHeight)).toBeGreaterThanOrEqual(sourceHeight / 2);
    expect(Number(cropHeight)).toBeLessThan(sourceHeight);
    await page
      .getByRole('region', { name: 'Crop and rotate editor' })
      .getByRole('button', { name: 'Done' })
      .click();
    await expect(page.locator('.live-preview-frame')).toHaveClass(/is-edited/);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expectPreviewFits(page, Number(cropWidth) / Number(cropHeight), true);
  });
}

test('desktop theater mode widens the preview and persists', async ({ page }, testInfo) => {
  test.skip(['iphone', 'ipad'].includes(testInfo.project.name), 'Desktop projects only');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  await page.setInputFiles('#file', fixture);

  const toggle = page.getByRole('button', { name: 'Theater mode' });
  const canvas = page.locator('.prepare-regions .canvas');
  const inspector = page.locator('.prepare-regions .inspector');
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  const initialWidth = (await canvas.boundingBox())!.width;
  const logo = page.locator('.top .logo');
  const header = page.locator('.top-in');
  const initialHeader = (await header.boundingBox())!;

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  const theaterWidth = (await canvas.boundingBox())!.width;
  expect(theaterWidth).toBeGreaterThan(initialWidth * 1.4);
  const inspectorWidth = (await inspector.boundingBox())!.width;
  expect(inspectorWidth).toBeGreaterThanOrEqual(360);
  expect(inspectorWidth).toBeLessThanOrEqual(400);
  expect(
    Math.abs((await logo.boundingBox())!.x - (await canvas.boundingBox())!.x),
  ).toBeLessThanOrEqual(2);
  expect(
    Math.abs(
      (await page.locator('.footer-links').boundingBox())!.x - (await canvas.boundingBox())!.x,
    ),
  ).toBeLessThanOrEqual(2);
  const headerRight = (await page.getByRole('button', { name: 'About' }).boundingBox())!;
  const inspectorRight = (await inspector.boundingBox())!;
  expect(
    Math.abs(headerRight.x + headerRight.width - inspectorRight.x - inspectorRight.width),
  ).toBeLessThanOrEqual(2);
  const video = (await page.locator('.preview-video').boundingBox())!;
  expect(video.y + video.height).toBeLessThanOrEqual(1080);

  await page.reload();
  await page.setInputFiles('#file', fixture);
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  expect((await canvas.boundingBox())!.width).toBeCloseTo(theaterWidth, 0);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  expect((await canvas.boundingBox())!.width).toBeCloseTo(initialWidth, 0);
  expect((await header.boundingBox())!.x).toBeCloseTo(initialHeader.x, 0);
  await toggle.click();
  await page.getByRole('button', { name: 'Choose another video' }).click();
  await expect(page.locator('body')).not.toHaveClass(/is-theater/);
  expect((await header.boundingBox())!.x).toBeCloseTo(initialHeader.x, 0);
});

test(
  'phone and tablet keep the one-column layout',
  { tag: '@mobile' },
  async ({ page }, testInfo) => {
    test.skip(!['iphone', 'ipad'].includes(testInfo.project.name), 'Small-device projects only');
    await page.goto('/');
    await page.setInputFiles('#file', fixture);
    await expect(
      page.getByRole('button', { name: 'Theater mode', includeHidden: true }),
    ).toBeHidden();
    const canvas = (await page.locator('.prepare-regions .canvas').boundingBox())!;
    const inspector = (await page.locator('.prepare-regions .inspector').boundingBox())!;
    expect(inspector.y).toBeGreaterThanOrEqual(canvas.y + canvas.height);
    expect(inspector.x).toBeCloseTo(canvas.x, 0);
  },
);

test('result comparison offers theater mode on desktop and leaves it on Start over', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
    delete (Window.prototype as unknown as Record<string, unknown>).showSaveFilePicker;
  });
  await page.goto('/');
  await page.setInputFiles('#file', landscapeFixture);
  const card = page.getByRole('region', { name: 'Export summary' });
  await card.getByRole('checkbox', { name: 'Re-encode anyway' }).check();
  await card.locator('summary').click();
  await card.getByLabel('Resolution', { exact: true }).selectOption({ index: 2 });
  await card.getByRole('button', { name: /^Export/ }).click();
  await expect(page.getByRole('link', { name: /Download/ })).toBeVisible({ timeout: 60_000 });
  const stage = page.locator('.compare-stage');
  const before = (await stage.boundingBox())!.width;
  const toggle = page.getByRole('button', { name: 'Theater mode' });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await stage.boundingBox())!.width).toBeGreaterThan(before);
  await page.getByRole('button', { name: 'Start over' }).click();
  await expect(page.locator('body')).not.toHaveClass(/is-theater/);
});

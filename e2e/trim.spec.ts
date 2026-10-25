import { expect, test } from '@playwright/test';

const fixture = new URL('../tests/fixtures/land-1080p30-aac.mp4', import.meta.url).pathname;
const longFixture = new URL('../tests/fixtures/long-31s.mp4', import.meta.url).pathname;

test('thumbnail density follows strip geometry and grows in Theater mode', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.setInputFiles('#file', longFixture);
  const strip = page.locator('.trim-strip');
  const tiles = strip.locator('.trim-thumbs canvas');
  await expect
    .poll(() =>
      page.locator('.preview-video').evaluate((video: HTMLVideoElement) => video.videoWidth),
    )
    .toBeGreaterThan(0);
  const aspect = await page
    .locator('.preview-video')
    .evaluate((video: HTMLVideoElement) => video.videoWidth / video.videoHeight);
  const expected = async () => {
    const box = (await strip.boundingBox())!;
    return Math.min(40, Math.max(4, Math.ceil(box.width / (box.height * aspect))));
  };
  await expect.poll(() => tiles.count()).toBeGreaterThanOrEqual(8);
  const desktopCount = await tiles.count();
  expect(Math.abs(desktopCount - (await expected()))).toBeLessThanOrEqual(1);
  const tile = (await tiles.first().boundingBox())!;
  expect(Math.abs(tile.width / tile.height / aspect - 1)).toBeLessThanOrEqual(0.1);
  const resolution = await tiles.first().evaluate((canvas: HTMLCanvasElement) => ({
    width: canvas.width,
    height: canvas.height,
    scale: Math.min(devicePixelRatio || 1, 2),
  }));
  expect(Math.abs(resolution.width - tile.width * resolution.scale)).toBeLessThanOrEqual(2);
  expect(Math.abs(resolution.height - tile.height * resolution.scale)).toBeLessThanOrEqual(2);

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.getByRole('button', { name: 'Theater mode' }).click();
  await expect.poll(() => tiles.count()).toBeGreaterThan(desktopCount);
  await expect.poll(() => tiles.count()).toBeGreaterThan(12);
  expect(Math.abs((await tiles.count()) - (await expected()))).toBeLessThanOrEqual(1);
  const theaterTile = (await tiles.first().boundingBox())!;
  expect(Math.abs(theaterTile.width / theaterTile.height / aspect - 1)).toBeLessThanOrEqual(0.1);
  const lastTile = (await tiles.last().boundingBox())!;
  const stripBox = (await strip.boundingBox())!;
  expect(Math.abs(lastTile.x + lastTile.width - stripBox.x - stripBox.width)).toBeLessThanOrEqual(
    1,
  );
});

test('phone filmstrip keeps at least four thumbnails', { tag: '@mobile' }, async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('#file', longFixture);
  await expect.poll(() => page.locator('.trim-thumbs canvas').count()).toBeGreaterThanOrEqual(4);
});

// WebKit's Linux media backend can wedge the page when it navigates away while the preview
// <video> is still loading, so a test that needs an init script must not load a file first.
test('unplayable preview keeps trim handles and disables playhead buttons', async ({ page }) => {
  await page.addInitScript(() => {
    const canPlayType = HTMLMediaElement.prototype.canPlayType;
    HTMLMediaElement.prototype.canPlayType = function (mime) {
      if (this.classList.contains('preview-video')) return '';
      return canPlayType.call(this, mime);
    };
  });
  await page.goto('/');
  await page.setInputFiles('#file', fixture);
  await expect(page.locator('.preview-note')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Set start to playhead' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Set end to playhead' })).toBeDisabled();
  await expect(page.getByRole('slider', { name: 'Start' })).toBeEnabled();
  await expect(page.locator('.trim-thumbs canvas').first()).toBeVisible();
});

test.describe('with a video loaded', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.setInputFiles('#file', fixture);
    await expect(page.getByRole('slider', { name: 'Start' })).toBeVisible();
  });

  test('keyboard changes trim and estimate', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'land-1080p30-aac.mp4' })).toBeFocused();
    const start = page.getByRole('slider', { name: 'Start' });
    const initialEstimate = await page.locator('.export-estimate-big').textContent();
    await start.focus();
    await page.keyboard.press('ArrowRight');
    await expect(start).toHaveAttribute('aria-valuenow', '0.1');
    await expect(page.getByRole('textbox', { name: 'Trim start' })).toHaveValue('0:00.1');
    await expect(page.locator('.trim-head')).toContainText('kept');
    await expect(page.locator('.export-estimate-big')).not.toHaveText(initialEstimate!);
  });

  test('pointer drag changes the start readout', { tag: '@mobile' }, async ({ page, isMobile }) => {
    const start = page.getByRole('slider', { name: 'Start' });
    const strip = page.locator('.trim-strip');
    const box = await strip.boundingBox();
    expect(box).not.toBeNull();
    await start.dispatchEvent('pointerdown', {
      pointerId: 1,
      pointerType: isMobile ? 'touch' : 'mouse',
      clientX: box!.x + 1,
    });
    await start.dispatchEvent('pointermove', {
      pointerId: 1,
      pointerType: isMobile ? 'touch' : 'mouse',
      clientX: box!.x + box!.width / 4,
    });
    await expect
      .poll(async () => Number(await start.getAttribute('aria-valuenow')))
      .toBeGreaterThan(0);
    await expect(page.getByRole('textbox', { name: 'Trim start' })).not.toHaveValue('0:00.0');
  });

  test('ruler stays aligned and seeks on click', { tag: '@mobile' }, async ({ page }) => {
    const ruler = page.locator('.trim-ruler');
    const strip = page.locator('.trim-strip');
    await expect(ruler.locator('text').first()).toBeVisible();
    const labels = ruler.locator('text');
    expect(await labels.count()).toBeGreaterThan(1);
    expect(await labels.count()).toBeLessThan(30);
    const rulerBox = (await ruler.boundingBox())!;
    const stripBox = (await strip.boundingBox())!;
    expect(rulerBox.x).toBeCloseTo(stripBox.x, 0);
    expect(rulerBox.width).toBeCloseTo(stripBox.width, 0);
    await ruler.click({ position: { x: rulerBox.width / 2, y: rulerBox.height / 2 } });
    await expect
      .poll(() => page.locator('.preview-video').evaluate((v: HTMLVideoElement) => v.currentTime))
      .toBeGreaterThan(1);
  });

  test('playhead drags and responds to keys', { tag: '@mobile' }, async ({ page, isMobile }) => {
    const playhead = page.getByRole('slider', { name: 'Playback position' });
    const strip = page.locator('.trim-strip');
    const box = (await strip.boundingBox())!;
    await expect(playhead).toBeVisible();
    await playhead.dispatchEvent('pointerdown', {
      pointerId: 7,
      pointerType: isMobile ? 'touch' : 'mouse',
      clientX: box.x + 2,
    });
    await strip.dispatchEvent('pointermove', {
      pointerId: 7,
      pointerType: isMobile ? 'touch' : 'mouse',
      clientX: box.x + box.width * 0.6,
    });
    await strip.dispatchEvent('pointerup', {
      pointerId: 7,
      pointerType: isMobile ? 'touch' : 'mouse',
      clientX: box.x + box.width * 0.6,
    });
    await expect
      .poll(() => page.locator('.preview-video').evaluate((v: HTMLVideoElement) => v.currentTime))
      .toBeGreaterThan(1.5);
    await playhead.focus();
    const before = Number(await playhead.getAttribute('aria-valuenow'));
    await page.keyboard.press('ArrowLeft');
    await expect
      .poll(async () => Number(await playhead.getAttribute('aria-valuenow')))
      .toBeLessThan(before - 0.9);
  });

  test('handles win when overlapping the playhead', async ({ page }) => {
    const start = page.getByRole('slider', { name: 'Start' });
    const strip = page.locator('.trim-strip');
    await strip.scrollIntoViewIfNeeded();
    const box = (await strip.boundingBox())!;
    await page.mouse.move(box.x - 7, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 4, box.y + box.height / 2);
    await page.mouse.up();
    await expect
      .poll(async () => Number(await start.getAttribute('aria-valuenow')))
      .toBeGreaterThan(0.5);
  });

  test('typed time updates trim and invalid time keeps the previous value', async ({ page }) => {
    const input = page.getByRole('textbox', { name: 'Trim start' });
    const start = page.getByRole('slider', { name: 'Start' });
    const kept = page.locator('.trim-head .num');
    const original = await kept.textContent();
    await input.fill('0:01.5');
    await input.press('Enter');
    await expect(start).toHaveAttribute('aria-valuenow', '1.5');
    await expect(kept).not.toHaveText(original!);
    const endInput = page.getByRole('textbox', { name: 'Trim end' });
    await endInput.fill('0:02.5');
    await endInput.press('Enter');
    await expect(page.getByRole('slider', { name: 'End' })).toHaveAttribute('aria-valuenow', '2.5');
    await input.fill('1:75');
    await input.press('Enter');
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#trim-start-error')).toBeVisible();
    await expect(start).toHaveAttribute('aria-valuenow', '1.5');
    await input.press('Escape');
    await expect(input).toHaveValue('0:01.5');
  });

  test('Set copies the playhead into the matching time field', async ({ page }) => {
    const startField = page.getByRole('textbox', { name: 'Trim start' });
    const endField = page.getByRole('textbox', { name: 'Trim end' });
    const video = page.locator('.preview-video');
    await startField.fill('bad time');
    await startField.press('Enter');
    await expect(startField).toHaveAttribute('aria-invalid', 'true');
    await video.evaluate((node: HTMLVideoElement) => (node.currentTime = 1));
    await page.getByRole('button', { name: 'Set start to playhead' }).click();
    await expect(startField).toHaveValue('0:01.0');
    await expect(startField).toHaveAttribute('aria-invalid', 'false');
    await expect(page.locator('#trim-start-error')).toBeHidden();
    await expect(page.getByRole('slider', { name: 'Start' })).toHaveAttribute('aria-valuenow', '1');
    await video.evaluate((node: HTMLVideoElement) => (node.currentTime = 2));
    await page.getByRole('button', { name: 'Set end to playhead' }).click();
    await expect(endField).toHaveValue('0:02.0');
    await expect(page.getByRole('slider', { name: 'End' })).toHaveAttribute('aria-valuenow', '2');
  });

  test('trim readouts sit flush with the trim section edges at every width', async ({ page }) => {
    const groups = page.locator('.trim-readout');
    for (const viewport of [
      { width: 320, height: 640 },
      { width: 390, height: 844 },
      { width: 768, height: 844 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      const head = (await page.locator('.trim-head').boundingBox())!;
      const start = (await groups.first().boundingBox())!;
      const end = (await groups.last().boundingBox())!;
      expect(Math.abs(start.y - end.y)).toBeLessThanOrEqual(1);
      for (const group of [groups.first(), groups.last()]) {
        const label = (await group.locator('.trim-label').boundingBox())!;
        const input = (await group.locator('.trim-input').boundingBox())!;
        const button = (await group.locator('.btn-cue').boundingBox())!;
        expect(label.y).toBeLessThan(input.y);
        expect(input.y + input.height).toBeLessThanOrEqual(button.y + 1);
      }
      for (const selector of ['.trim-label', '.trim-input', '.btn-cue']) {
        const startItem = (await groups.first().locator(selector).boundingBox())!;
        const endItem = (await groups.last().locator(selector).boundingBox())!;
        expect(Math.abs(startItem.x - head.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(endItem.x + endItem.width - head.x - head.width)).toBeLessThanOrEqual(1);
      }
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.scrollingElement!.scrollWidth,
        innerWidth,
      }));
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth);
    }
  });

  test('theater mode expands the ruler with the strip', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    const strip = page.locator('.trim-strip');
    const ruler = page.locator('.trim-ruler');
    const before = (await strip.boundingBox())!.width;
    await page.getByRole('button', { name: 'Theater mode' }).click();
    await expect.poll(async () => (await strip.boundingBox())!.width).toBeGreaterThan(before);
    await expect
      .poll(async () => (await ruler.boundingBox())!.width)
      .toBeCloseTo((await strip.boundingBox())!.width, 0);
    const head = (await page.locator('.trim-head').boundingBox())!;
    const groups = page.locator('.trim-readout');
    const start = (await groups.first().boundingBox())!;
    const end = (await groups.last().boundingBox())!;
    expect(Math.abs(start.x - head.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(end.x + end.width - head.x - head.width)).toBeLessThanOrEqual(1);
  });

  test('preview error falls back after the source was accepted', async ({ page }) => {
    // A real error ends loading first. Tearing the <video> down mid-load instead can wedge
    // WebKit's Linux media backend, which hangs dispatchEvent until the test times out.
    await expect
      .poll(() =>
        page
          .locator('.preview-video')
          .evaluate(
            (v: HTMLVideoElement) =>
              v.readyState === HTMLMediaElement.HAVE_ENOUGH_DATA &&
              v.networkState !== HTMLMediaElement.NETWORK_LOADING,
          ),
      )
      .toBe(true);
    await page.locator('.preview-video').dispatchEvent('error');
    await expect(page.locator('.preview-note')).toBeVisible();
    await expect(page.locator('.preview-video')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Set start to playhead' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Set end to playhead' })).toBeDisabled();
  });
});

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

test('phone preview stays visible above frame controls', { tag: '@mobile' }, async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('#file', fixture);
  const preview = page.locator('.preview-host');
  if ((await page.evaluate(() => innerWidth)) >= 700) {
    await expect(preview).not.toHaveCSS('position', 'sticky');
    return;
  }
  await expect(preview).toHaveCSS('position', 'sticky');
  const next = page.getByRole('button', { name: 'Next frame' });
  await next.evaluate((button) => button.scrollIntoView({ block: 'start' }));
  const buttonBox = (await next.boundingBox())!;
  const videoBox = (await page.locator('.preview-video').boundingBox())!;
  const height = await page.evaluate(() => innerHeight);
  expect(buttonBox.y).toBeGreaterThanOrEqual(videoBox.y + videoBox.height);
  expect(buttonBox.y + buttonBox.height).toBeLessThanOrEqual(height);
  expect(videoBox.y).toBeGreaterThanOrEqual(0);
  expect(videoBox.y + videoBox.height).toBeLessThanOrEqual(height);

  const style = page.locator('.style-adjust > summary');
  await style.evaluate((summary) => summary.scrollIntoView({ block: 'start' }));
  const styleBox = (await style.boundingBox())!;
  const pinnedVideoBox = (await page.locator('.preview-video').boundingBox())!;
  expect(pinnedVideoBox.y).toBeGreaterThanOrEqual(0);
  expect(pinnedVideoBox.y + pinnedVideoBox.height).toBeLessThanOrEqual(height);
  expect(styleBox.y - pinnedVideoBox.y - pinnedVideoBox.height).toBeGreaterThanOrEqual(8);
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
  await expect(page.getByRole('button', { name: 'Previous frame' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Next frame' })).toBeDisabled();
  await expect(page.getByRole('slider', { name: 'Start' })).toBeEnabled();
  await expect(page.locator('.trim-thumbs canvas').first()).toBeVisible();
});

test.describe('with a video loaded', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.setInputFiles('#file', fixture);
    await expect(page.getByRole('slider', { name: 'Start' })).toBeVisible();
  });

  test('frame buttons and shortcuts step the paused preview, except while typing', async ({
    page,
  }) => {
    const video = page.locator('.preview-video');
    const time = () => video.evaluate((node: HTMLVideoElement) => node.currentTime);
    await video.evaluate((node: HTMLVideoElement) => {
      node.pause();
      node.currentTime = 1;
    });
    const playheadTime = page.locator('.trim-playhead-time');
    await expect(playheadTime).toHaveText('0:01.00');
    const next = page.getByRole('button', { name: 'Next frame' });
    const previous = page.getByRole('button', { name: 'Previous frame' });
    await next.click();
    await expect(playheadTime).toHaveText('0:01.03');
    await expect.poll(time).toBeGreaterThan(1.02);
    expect(await time()).toBeCloseTo(1 + 1 / 30, 2);
    await previous.click();
    await expect(playheadTime).toHaveText('0:01.00');
    await expect.poll(time).toBeLessThan(1.02);
    expect(await time()).toBeCloseTo(1, 2);
    await page.keyboard.press('.');
    await expect(playheadTime).toHaveText('0:01.03');
    await expect.poll(time).toBeGreaterThan(1.02);
    await page.keyboard.press(',');
    await expect(playheadTime).toHaveText('0:01.00');
    await expect.poll(time).toBeLessThan(1.02);
    const input = page.getByRole('textbox', { name: 'Trim start' });
    await input.focus();
    const before = await time();
    await input.press('.');
    await input.press(',');
    expect(await time()).toBeCloseTo(before, 4);
    await input.press('Escape');
    await next.click();
    await expect(playheadTime).toHaveText('0:01.03');
    await next.click();
    await expect(playheadTime).toHaveText('0:01.06');
    await expect(playheadTime).toHaveAttribute('aria-label', 'Playhead 0:01.06');
  });

  test('keyboard changes trim and estimate', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'land-1080p30-aac.mp4' })).toBeFocused();
    const start = page.getByRole('slider', { name: 'Start' });
    const initialEstimate = await page.locator('.export-estimate-big').textContent();
    await start.focus();
    await page.keyboard.press('ArrowRight');
    await expect(start).toHaveAttribute('aria-valuenow', '0.1');
    await expect(page.getByRole('textbox', { name: 'Trim start' })).toHaveValue('0:00.1');
    await expect(page.locator('.trim-kept')).toContainText('kept');
    await expect(page.locator('.export-estimate-big')).not.toHaveText(initialEstimate!);
  });

  for (const tool of ['Shrink video', 'Extract audio', 'GIF']) {
    test(`Reset trim restores the full source in ${tool} at 320px`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 640 });
      await page.getByRole('tab', { name: tool, exact: true }).click();
      const start = page.getByRole('slider', { name: 'Start', exact: true });
      const end = page.getByRole('slider', { name: 'End', exact: true });
      const endReadout = page.getByRole('textbox', { name: 'Trim end' });
      const fullEnd = await endReadout.inputValue();
      const duration = await end.getAttribute('aria-valuenow');
      const kept = page.locator('.trim-kept');
      const fullKept = await kept.textContent();
      const reset = page.getByRole('button', { name: 'Reset trim', exact: true });
      await expect(reset).toBeHidden();
      await start.focus();
      await start.press('ArrowRight');
      await expect(start).toHaveAttribute('aria-valuenow', '0.1');
      await expect(reset).toBeVisible();
      await end.press('ArrowLeft');
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.scrollingElement!.scrollWidth,
        innerWidth,
      }));
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth);
      await reset.click();
      await expect(start).toBeFocused();
      await expect(start).toHaveAttribute('aria-valuenow', '0');
      await expect(end).toHaveAttribute('aria-valuenow', duration!);
      await expect(page.getByRole('textbox', { name: 'Trim start' })).toHaveValue('0:00.0');
      await expect(endReadout).toHaveValue(fullEnd);
      await expect(kept).toHaveText(fullKept!);
      await expect(reset).toBeHidden();
    });
  }

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
    const kept = page.locator('.trim-kept');
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

  test('trim readouts keep controls together and align to section edges', async ({ page }) => {
    const groups = page.locator('.trim-readout');
    for (const viewport of [
      { width: 320, height: 640 },
      { width: 375, height: 812 },
      { width: 390, height: 844 },
      { width: 768, height: 844 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      const head = (await page.locator('.trim-head').boundingBox())!;
      const start = (await groups.first().boundingBox())!;
      const end = (await groups.last().boundingBox())!;
      for (const [side, group] of [
        ['start', groups.first()],
        ['end', groups.last()],
      ] as const) {
        const label = (await group.locator('.trim-label').boundingBox())!;
        const input = (await group.locator('.trim-input').boundingBox())!;
        const button = (await group.locator('.btn-cue').boundingBox())!;
        expect(
          Math.abs(label.y + label.height / 2 - input.y - input.height / 2),
        ).toBeLessThanOrEqual(1);
        expect(
          Math.abs(button.y + button.height / 2 - input.y - input.height / 2),
        ).toBeLessThanOrEqual(1);
        if (side === 'start') {
          expect(button.x + button.width).toBeLessThanOrEqual(label.x + 1);
          expect(label.x + label.width).toBeLessThanOrEqual(input.x + 1);
        } else {
          expect(label.x + label.width).toBeLessThanOrEqual(input.x + 1);
          expect(input.x + input.width).toBeLessThanOrEqual(button.x + 1);
        }
      }
      expect(Math.abs(start.x - head.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(end.x + end.width - head.x - head.width)).toBeLessThanOrEqual(1);
      await expect(page.locator('.trim-head > .trim-kept')).toHaveCount(1);
      const frameGroup = (await page.locator('.trim-frame-group').boundingBox())!;
      const time = (await page.locator('.trim-playhead-time').boundingBox())!;
      const previous = (await page.getByRole('button', { name: 'Previous frame' }).boundingBox())!;
      const next = (await page.getByRole('button', { name: 'Next frame' }).boundingBox())!;
      expect(previous.x + previous.width).toBeLessThanOrEqual(time.x + 1);
      expect(time.x + time.width).toBeLessThanOrEqual(next.x + 1);
      if (viewport.width > 500) {
        expect(Math.abs(start.y - end.y)).toBeLessThanOrEqual(1);
        expect(frameGroup.x).toBeGreaterThan(start.x + start.width);
        expect(frameGroup.x + frameGroup.width).toBeLessThan(end.x);
      } else {
        expect(frameGroup.y).toBeGreaterThanOrEqual(
          Math.max(start.y + start.height, end.y + end.height),
        );
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

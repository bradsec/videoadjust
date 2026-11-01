import { expect, test } from '@playwright/test';

const fixture = new URL('../tests/fixtures/land-1080p30-aac.mp4', import.meta.url).pathname;
const longFixture = new URL('../tests/fixtures/long-31s.mp4', import.meta.url).pathname;
const streamingFixture = new URL('../tests/fixtures/long-eac3.mp4', import.meta.url).pathname;
const eac3Fixture = new URL('../tests/fixtures/h264-eac3.mp4', import.meta.url).pathname;

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
  const preview = page.locator('.live-preview-stage');
  if ((await page.evaluate(() => innerWidth)) >= 700) {
    await expect(preview).not.toHaveCSS('position', 'sticky');
    return;
  }
  await expect(preview).toHaveCSS('position', 'sticky');
  expect(
    await page.locator('.preview-video').evaluate((video: HTMLVideoElement) => video.controls),
  ).toBe(true);
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
  await page.setInputFiles(
    '#file',
    new URL('../tests/fixtures/noaudio.mp4', import.meta.url).pathname,
  );
  await expect(page.locator('.preview-note')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Set start to playhead' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Set end to playhead' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Previous frame' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Next frame' })).toBeDisabled();
  await expect(page.getByRole('slider', { name: 'Start' })).toBeEnabled();
  await expect(page.locator('.trim-thumbs canvas').first()).toBeVisible();
});

test('a source whose audio the browser cannot play gets a video preview with sound', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const create = URL.createObjectURL;
    URL.createObjectURL = function (object: Blob | MediaSource) {
      const url = create.call(this, object);
      if (object instanceof File)
        (window as Window & { originalPreviewUrl?: string }).originalPreviewUrl = url;
      return url;
    };
  });
  await page.goto('/');
  await page.setInputFiles('#file', eac3Fixture);
  await expect
    .poll(() =>
      page.locator('.preview-video').evaluate((video: HTMLVideoElement) => video.videoWidth),
    )
    .toBe(640);
  await expect(page.locator('.preview-note')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Set start to playhead' })).toBeEnabled();
  // Playwright WebKit on Linux reports E-AC-3 as playable, so only browsers that reject it warn.
  const rejectsAudio = await page
    .locator('.preview-video')
    .evaluate((video: HTMLVideoElement) => video.canPlayType('video/mp4; codecs="ec-3"') === '');
  await expect(
    page.getByText('Preview has no sound: this browser cannot play the audio. Export converts it.'),
  ).toBeHidden();
  if (rejectsAudio) {
    expect(await page.locator('.preview-video').getAttribute('src')).not.toBe(
      await page.evaluate(
        () => (window as Window & { originalPreviewUrl?: string }).originalPreviewUrl,
      ),
    );
  }
});

test('preview proxy plays, survives export for comparison, and is released on Start over', async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'WebKit plays E-AC-3 natively, so this source needs no preview copy',
  );
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    const state = window as Window & {
      proxySource?: string;
      proxyCopy?: string;
      previewWrites?: string[];
      revoked?: string[];
    };
    state.previewWrites = [];
    state.revoked = [];
    const create = URL.createObjectURL;
    URL.createObjectURL = function (object: Blob | MediaSource) {
      const url = create.call(this, object);
      if (object instanceof File) state.proxySource = url;
      // The first plain video Blob is the finished copy; the export comes later.
      else if (object instanceof Blob && object.type.startsWith('video/')) state.proxyCopy ??= url;
      return url;
    };
    const revoke = URL.revokeObjectURL;
    URL.revokeObjectURL = function (url: string) {
      state.revoked!.push(url);
      return revoke.call(this, url);
    };
    const src = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src')!;
    Object.defineProperty(HTMLMediaElement.prototype, 'src', {
      ...src,
      set(this: HTMLMediaElement, value: string) {
        if (this.classList.contains('preview-video')) state.previewWrites!.push(value);
        src.set!.call(this, value);
      },
    });
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
    delete (Window.prototype as unknown as Record<string, unknown>).showSaveFilePicker;
  });
  await page.goto('/');
  const started = Date.now();
  await page.setInputFiles('#file', eac3Fixture);
  await expect(page.locator('.preview-proxy-status')).toContainText('Preparing preview');
  await expect(page.locator('.preview-proxy-status')).toBeHidden({ timeout: 30_000 });
  const buildMs = Date.now() - started;
  console.log(`PROXY_FIXTURE_BUILD_MS=${buildMs}`);
  const preview = page.locator('.preview-video');
  const proxyUrl = await page.evaluate(() => (window as Window & { proxyCopy?: string }).proxyCopy);
  expect(proxyUrl).toMatch(/^blob:/);
  expect(await preview.getAttribute('src')).toMatch(/^blob:/);
  expect(
    await page.evaluate(() => {
      const state = window as Window & { proxySource?: string; previewWrites?: string[] };
      return state.previewWrites?.includes(state.proxySource ?? '');
    }),
  ).toBe(false);
  await preview.evaluate((video: HTMLVideoElement) => video.play());
  await expect
    .poll(() => preview.evaluate((video: HTMLVideoElement) => video.currentTime))
    .toBeGreaterThan(0.2);
  await page
    .getByRole('region', { name: 'Export summary' })
    .getByRole('button', { name: /^Export/ })
    .click();
  await expect(page.getByRole('button', { name: 'Start over' })).toBeVisible({ timeout: 60_000 });
  // A preview copy means a heavy original, so the result starts with the new video alone.
  await expect(page.locator('.compare-stage video:visible')).toHaveCount(1);
  await expect(page.locator('.compare-video').first()).not.toHaveAttribute('src');
  await page.getByRole('button', { name: 'Compare with original' }).click();
  await expect(page.locator('.compare-video').first()).toHaveAttribute('src', proxyUrl!);
  await expect(page.locator('.compare-stage video:visible')).toHaveCount(2);
  await expect(page.getByRole('slider', { name: 'Wipe position' })).toBeVisible();
  await page.getByRole('button', { name: 'Start over' }).click();
  expect(
    await page.evaluate(
      (url) => (window as Window & { revoked?: string[] }).revoked?.includes(url),
      proxyUrl!,
    ),
  ).toBe(true);
});

test('preview proxy Cancel and Use original choose separate outcomes', async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'WebKit plays E-AC-3 natively, so this source needs no preview copy',
  );
  await page.goto('/');
  await page.setInputFiles('#file', eac3Fixture);
  await expect(page.locator('.preview-proxy-status')).toContainText('Preparing preview');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('.preview-proxy-status')).toHaveText('Preview preparation canceled.');
  await expect(page.locator('.preview-audio-note')).toBeVisible();
  await expect(page.locator('.preview-video')).not.toHaveAttribute('src', /^blob:/);
  await page.getByRole('button', { name: 'Choose another video' }).click();
  await page.setInputFiles('#file', eac3Fixture);
  await expect(page.locator('.preview-proxy-status')).toContainText('Preparing preview');
  await page.getByRole('button', { name: 'Use original' }).click();
  await expect(page.locator('.preview-video')).toHaveAttribute('src', /^blob:/);
  await expect(page.locator('.preview-audio-note')).toBeVisible();
});

test('streamed preview copy plays before it is done, with centred status and Cancel', async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'WebKit plays E-AC-3 natively, so this source needs no preview copy',
  );
  test.setTimeout(120_000);
  await page.goto('/');
  await page.setInputFiles('#file', streamingFixture);
  const status = page.locator('.preview-proxy-status');
  await expect(status).toContainText('Preparing preview');
  await expect(status).toHaveAttribute('role', 'status');
  await expect(status).toHaveAttribute('aria-live', 'polite');
  const stage = (await page.locator('.live-preview-stage').boundingBox())!;
  const box = (await status.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(stage.x);
  expect(box.x + box.width).toBeLessThanOrEqual(stage.x + stage.width);
  expect(Math.abs(box.x + box.width / 2 - (stage.x + stage.width / 2))).toBeLessThan(2);
  expect(Math.abs(box.y + box.height / 2 - (stage.y + stage.height / 2))).toBeLessThan(2);
  const preview = page.locator('.preview-video');
  const cancel = page.getByRole('button', { name: 'Cancel', exact: true });
  await expect
    .poll(() => preview.evaluate((video: HTMLVideoElement) => video.currentTime), {
      timeout: 30_000,
    })
    .toBeGreaterThan(0.5);
  // Cancel and Use original leave once the copy is done, so playback started before that.
  await expect(cancel).toBeVisible();
  await cancel.click();
  await expect(status).toHaveText('Preview preparation canceled.');
  await expect(preview).not.toHaveAttribute('src', /^blob:/);
});

test('proxied frame save draws the full-resolution original', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
    delete (Window.prototype as unknown as Record<string, unknown>).showSaveFilePicker;
    const canPlayType = HTMLMediaElement.prototype.canPlayType;
    HTMLMediaElement.prototype.canPlayType = function (mime) {
      if (mime.includes('mp4a.40.2')) return '';
      return canPlayType.call(this, mime);
    };
    const draw = OffscreenCanvasRenderingContext2D.prototype.drawImage;
    OffscreenCanvasRenderingContext2D.prototype.drawImage = function (
      this: OffscreenCanvasRenderingContext2D,
      ...args
    ) {
      const source = args[0];
      const state = window as Window & {
        captureFrame?: boolean;
        savedFrameSource?: [number, number];
      };
      if (
        state.captureFrame &&
        (source instanceof HTMLCanvasElement || source instanceof OffscreenCanvas)
      )
        state.savedFrameSource = [source.width, source.height];
      return Reflect.apply(draw, this, args);
    } as typeof draw;
  });
  await page.goto('/');
  await page.setInputFiles('#file', fixture);
  await expect(page.locator('.preview-proxy-status')).toBeHidden({ timeout: 30_000 });
  await expect
    .poll(() =>
      page.locator('.preview-video').evaluate((video: HTMLVideoElement) => video.videoWidth),
    )
    .toBe(1280);
  await page.evaluate(() => ((window as Window & { captureFrame?: boolean }).captureFrame = true));
  await page.getByRole('button', { name: 'Save frame as PNG' }).click();
  await expect(page.getByRole('link', { name: 'Download frame' })).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as Window & { savedFrameSource?: [number, number] }).savedFrameSource,
    ),
  ).toEqual([1920, 1080]);
});

test('Chromium builds a proxy when presented video frames are black but filmstrip frames are visible', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium');
  await page.addInitScript(() => {
    const create = URL.createObjectURL;
    URL.createObjectURL = function (object: Blob | MediaSource) {
      if (object instanceof Blob && !(object instanceof File) && object.type.startsWith('video/'))
        (window as Window & { copyReady?: boolean }).copyReady = true;
      return create.call(this, object);
    };
    const drawImage = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (
      this: CanvasRenderingContext2D,
      ...args: Parameters<typeof drawImage>
    ) {
      if (args[0] instanceof HTMLVideoElement) {
        this.fillStyle = '#000';
        this.fillRect(0, 0, this.canvas.width, this.canvas.height);
        return;
      }
      return Reflect.apply(drawImage, this, args);
    } as typeof drawImage;
  });
  await page.goto('/');
  await page.setInputFiles('#file', longFixture);
  await expect(page.locator('.trim-thumbs canvas').first()).toBeVisible();
  await page.locator('.preview-video').evaluate((video: HTMLVideoElement) => video.play());
  // A copy of this small file can finish within one poll, so the finished copy's URL is checked.
  await expect
    .poll(() => page.evaluate(() => (window as Window & { copyReady?: boolean }).copyReady), {
      timeout: 20_000,
    })
    .toBe(true);
  await expect(page.locator('.preview-proxy-actions')).toBeHidden();
  await expect(page.locator('.preview-picture-note')).toBeHidden();
});

test('preview warns when playback presents no frames', async ({ page }) => {
  await page.addInitScript(() => {
    HTMLVideoElement.prototype.requestVideoFrameCallback = (callback) => {
      (window as typeof window & { delayedFrame?: VideoFrameRequestCallback }).delayedFrame =
        callback;
      return 1;
    };
  });
  await page.goto('/');
  await page.setInputFiles('#file', longFixture);
  const video = page.locator('.preview-video');
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState))
    .toBeGreaterThanOrEqual(2);
  await video.evaluate((v: HTMLVideoElement) => v.play());
  await expect(
    page.getByText("This browser cannot show this video's picture. Export still works."),
  ).toBeVisible({ timeout: 10_000 });
  await page.evaluate(() => {
    const frame = (window as typeof window & { delayedFrame?: VideoFrameRequestCallback })
      .delayedFrame;
    frame?.(performance.now(), {} as VideoFrameCallbackMetadata);
  });
  await expect(page.locator('.preview-picture-note')).toBeHidden();
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

import { expect, test } from '@playwright/test';

const fixture = new URL('../tests/fixtures/land-1080p30-aac.mp4', import.meta.url).pathname;

test('GIF preview applies the selected colour limit', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('#file', fixture);
  await page.getByRole('tab', { name: 'GIF', exact: true }).click();
  await page.getByRole('tabpanel').locator('summary').click();
  const colours = page.getByLabel('Colours', { exact: true });
  const palette = page.locator('.live-preview-palette');
  const sample = () =>
    palette.evaluate((canvas: HTMLCanvasElement) => {
      const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      const colors = new Set<number>();
      for (let i = 0; i < data.length; i += 4)
        colors.add((data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!);
      return colors.size;
    });

  await colours.selectOption('64');
  await expect(palette).toBeVisible();
  await expect.poll(sample).toBeGreaterThan(1);
  const limited = await sample();
  expect(limited).toBeLessThanOrEqual(64);

  await colours.selectOption('128');
  await expect
    .poll(async () => {
      const count = await sample();
      return count > limited && count <= 128;
    })
    .toBe(true);
  const medium = await sample();

  await colours.selectOption('256');
  await expect
    .poll(async () => {
      const count = await sample();
      return count > medium && count <= 256;
    })
    .toBe(true);
});

for (const tool of ['Shrink', 'GIF']) {
  test(
    `${tool} previews edits live and can show the original`,
    { tag: '@mobile' },
    async ({ page }) => {
      await page.goto('/');
      await page.setInputFiles('#file', fixture);
      await expect(page.getByRole('region', { name: 'Export summary' })).toBeVisible();
      if (tool === 'GIF') await page.getByRole('tab', { name: 'GIF', exact: true }).click();
      const original = page.getByRole('button', { name: 'Show original', exact: true });
      const video = page.locator('.preview-video');
      const frame = page.locator('.live-preview-frame');
      const layer = page.locator('.live-preview-overlay');
      const palette = page.locator('.live-preview-palette');
      // A GIF is smaller and slower than the source, so its preview starts in output view.
      if (tool === 'GIF') await expect(original).toBeVisible();
      else await expect(original).toBeHidden();
      const before = await video.evaluate((node) => getComputedStyle(node).transform);

      await page.getByRole('button', { name: 'Crop and rotate' }).click();
      await page.getByLabel('Editor rotation').selectOption('90');
      await expect(page.locator('.live-preview')).toBeHidden();
      await page.getByRole('region', { name: 'Crop and rotate editor' }).getByText('Done').click();
      await expect(video).toBeVisible();
      await expect
        .poll(() => video.evaluate((node) => getComputedStyle(node).transform))
        .not.toBe(before);
      await expect(video).toHaveCSS('transform', /^matrix\(0, [\d.]+, -[\d.]+, 0,/);

      await page.getByRole('button', { name: 'Crop and rotate' }).click();
      await page.getByLabel('Crop aspect ratio').selectOption('square');
      await page.getByRole('region', { name: 'Crop and rotate editor' }).getByText('Done').click();
      await expect
        .poll(async () => {
          const box = (await frame.boundingBox())!;
          return Math.abs(box.width - box.height);
        })
        .toBeLessThan(1);

      const beforeOverlay =
        tool === 'GIF'
          ? await palette.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())
          : '';
      await page.locator('.overlay-adjust > summary').click();
      await page.getByLabel('Text overlay', { exact: true }).check();
      await page.getByLabel('Overlay text', { exact: true }).fill('Live preview');
      await page.getByLabel('Overlay text', { exact: true }).blur();
      await expect
        .poll(() =>
          layer.evaluate((canvas: HTMLCanvasElement) => {
            const pixels = canvas
              .getContext('2d')!
              .getImageData(0, 0, canvas.width, canvas.height).data;
            return pixels.some((value, index) => index % 4 === 3 && value > 0);
          }),
        )
        .toBe(true);
      if (tool === 'GIF') {
        await expect(layer).toBeHidden();
        await expect
          .poll(() => palette.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL()))
          .not.toBe(beforeOverlay);
        expect(await palette.boundingBox()).toEqual(await frame.boundingBox());
      } else {
        await expect(layer).toBeVisible();
        expect(await layer.boundingBox()).toEqual(await frame.boundingBox());
      }
      await page.getByRole('button', { name: 'Position overlay' }).click();
      await expect(page.locator('.live-preview')).toBeHidden();
      await expect(page.getByRole('button', { name: 'Move text overlay' })).toBeVisible();
      await page
        .getByRole('region', { name: 'Overlay editor', exact: true })
        .getByText('Done')
        .click();
      await expect(tool === 'GIF' ? palette : layer).toBeVisible();

      const editedTransform = await video.evaluate((node) => getComputedStyle(node).transform);
      await original.click();
      await expect(original).toHaveAttribute('aria-pressed', 'true');
      await expect(video).toHaveCSS('transform', 'none');
      await expect(frame).not.toHaveClass(/is-edited/);
      await expect(layer).toBeHidden();
      await original.click();
      await expect(original).toHaveAttribute('aria-pressed', 'false');
      await expect(video).toHaveCSS('transform', editedTransform);
      await expect(tool === 'GIF' ? palette : layer).toBeVisible();

      await page
        .getByRole('slider', { name: 'Preview position' })
        .evaluate((node: HTMLInputElement) => {
          node.value = '1';
          node.dispatchEvent(new Event('input', { bubbles: true }));
        });
      await expect
        .poll(() => video.evaluate((node: HTMLVideoElement) => node.currentTime))
        .toBeCloseTo(1);
      // currentTime changes as soon as it is set; WebKit can stall a play() sent mid-seek.
      await expect
        .poll(() =>
          video.evaluate(
            (node: HTMLVideoElement) =>
              !node.seeking && node.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA,
          ),
        )
        .toBe(true);
      await page.getByRole('button', { name: 'Play', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Pause', exact: true }).click();
      await expect(video).toHaveCSS('transform', editedTransform);
    },
  );
}

test('editor resets restore the frame and overlay anchors, and edits end Show original', async ({
  page,
}) => {
  await page.goto('/');
  await page.setInputFiles('#file', fixture);
  await expect(page.getByRole('region', { name: 'Export summary' })).toBeVisible();
  const original = page.getByRole('button', { name: 'Show original', exact: true });
  const play = page.getByRole('button', { name: 'Play', exact: true });
  const video = page.locator('.preview-video');
  const frame = page.locator('.live-preview-frame');
  const crop = page.getByRole('region', { name: 'Crop and rotate editor' });

  await page.getByRole('button', { name: 'Crop and rotate' }).click();
  await page.getByLabel('Editor rotation').selectOption('90');
  await page.getByLabel('Crop aspect ratio').selectOption('square');
  await page.getByLabel('Editor mirror').check();
  await crop.getByRole('button', { name: 'Reset crop, rotation and mirror' }).click();
  await expect(page.getByLabel('Editor rotation')).toHaveValue('0');
  await expect(page.getByLabel('Crop aspect ratio')).toHaveValue('original');
  await expect(page.getByLabel('Editor mirror')).not.toBeChecked();
  await crop.getByText('Done').click();
  await expect(original).toBeHidden();

  await page.locator('.overlay-adjust > summary').click();
  await page.getByLabel('Text overlay', { exact: true }).check();
  await page.getByLabel('Overlay text', { exact: true }).fill('Reset me');
  await page.getByLabel('Overlay text', { exact: true }).blur();
  await page.getByRole('button', { name: 'Position overlay' }).click();
  const selection = page.getByRole('button', { name: 'Move text overlay' });
  await expect(selection).toBeVisible();
  const anchored = (await selection.boundingBox())!;
  await selection.focus();
  for (let i = 0; i < 3; i++) await selection.press('Shift+ArrowUp');
  await expect.poll(async () => (await selection.boundingBox())!.y).toBeLessThan(anchored.y - 1);
  await page.getByRole('button', { name: 'Reset positions', exact: true }).click();
  await expect
    .poll(async () => {
      const box = (await selection.boundingBox())!;
      return Math.abs(box.x - anchored.x) + Math.abs(box.y - anchored.y);
    })
    .toBeLessThan(1);
  await page.getByRole('region', { name: 'Overlay editor', exact: true }).getByText('Done').click();

  await expect(original).toBeVisible();
  const placement = await original.boundingBox();
  await original.click();
  await expect(original).toHaveAttribute('aria-pressed', 'true');
  await expect(frame).not.toHaveClass(/is-edited/);
  await expect(play).toBeVisible();
  expect(await video.evaluate((node: HTMLVideoElement) => node.controls)).toBe(false);
  expect(await original.boundingBox()).toEqual(placement);

  const opacity = page.getByRole('slider', { name: 'Text opacity (%)', exact: true });
  await opacity.focus();
  await opacity.press('ArrowLeft');
  await expect(original).toHaveAttribute('aria-pressed', 'false');
  await expect(frame).toHaveClass(/is-edited/);
});

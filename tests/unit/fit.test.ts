import { afterEach, expect, it, vi } from 'vitest';
import { fitGeometry, paintFit } from '../../src/core/fit';
import { outputSize, videoFrameSize } from '../../src/core/videoGeometry';
import { preserveQuality } from '../../src/ui/controllerSettings';
import type { Settings, SourceInfo } from '../../src/core/types';

afterEach(() => vi.unstubAllGlobals());

it('fits centred content into even output dimensions without upscaling it', () => {
  expect(fitGeometry({ width: 1920, height: 1080 }, '9:16', 1080)).toEqual({
    width: 608,
    height: 1080,
    content: { left: 0, top: 369, width: 608, height: 342 },
  });
  const portrait = fitGeometry({ width: 1080, height: 1920 }, '16:9', 1920);
  expect(portrait.width % 2).toBe(0);
  expect(portrait.height % 2).toBe(0);
  expect(portrait.content.width).toBeLessThanOrEqual(1080);
  expect(portrait.content.height).toBeLessThanOrEqual(1920);
  const odd = fitGeometry({ width: 101, height: 99 }, '1:1', 100);
  expect(odd.content.width).toBeLessThanOrEqual(101);
  expect(odd.content.height).toBeLessThanOrEqual(99);
  expect(fitGeometry({ width: 640, height: 360 }, 'off', 640)).toEqual({
    width: 640,
    height: 360,
    content: { left: 0, top: 0, width: 640, height: 360 },
  });
});

it('sizes fitted output from the rotated and cropped frame', () => {
  const source = { displayWidth: 1920, displayHeight: 1080 } as NonNullable<
    Parameters<typeof videoFrameSize>[0]
  >;
  const fit = { aspect: '16:9', background: 'blur', color: '#ffffff' } as const;
  const frame = videoFrameSize(source, 90, 'square');
  expect(frame).toEqual({ width: 1080, height: 1080 });
  expect(outputSize(source, 90, 'square', 1080, undefined, fit)).toEqual({
    width: 1080,
    height: 608,
  });
  expect(fitGeometry(frame, fit.aspect, 1080).content).toEqual({
    left: 236,
    top: 0,
    width: 608,
    height: 608,
  });
});

it('updates the quality baseline when Fit changes the output area', () => {
  const source = {
    video: { displayWidth: 1920, displayHeight: 1080, bitrate: 10_000_000 },
  } as SourceInfo;
  const previous = {
    container: 'mp4',
    passthrough: false,
    trim: { start: 0, end: 1 },
    audio: null,
    video: { codec: 'avc', width: 1920, height: 1080, fps: 30, bitrate: 4_000_000 },
  } as Settings;
  const next = preserveQuality(
    previous,
    {
      ...previous,
      fit: { aspect: '1:1', background: 'blur', color: '#ffffff' },
    },
    source,
  );
  expect(next.video).toMatchObject({ width: 1920, height: 1920 });
  expect(next.video!.bitrate).toBeGreaterThan(previous.video!.bitrate);
});

it.each(['black', 'color'] as const)('paints %s behind centred content', (background) => {
  const context = {
    save: vi.fn(),
    restore: vi.fn(),
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    filter: 'none',
    fillStyle: '',
  };
  const frame = {} as CanvasImageSource;
  paintFit(
    context as unknown as OffscreenCanvasRenderingContext2D,
    frame,
    { width: 200, height: 200, content: { left: 0, top: 44, width: 200, height: 112 } },
    { aspect: '1:1', background, color: '#123456' },
  );
  expect(context.drawImage).toHaveBeenLastCalledWith(frame, 0, 44, 200, 112);
  expect(context.fillRect).toHaveBeenCalledWith(0, 0, 200, 200);
  if (background === 'color') expect(context.fillStyle).toBe('#123456');
  if (background === 'black') expect(context.fillStyle).toBe('#000000');
});

it('reuses a small canvas to blur the background without context.filter', () => {
  const smallDraw = vi.fn();
  const scratch = { fillRect: vi.fn(), drawImage: smallDraw, imageSmoothingQuality: 'low' };
  const constructed = vi.fn();
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      width: number;
      height: number;
      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
        constructed();
      }
      getContext() {
        return scratch;
      }
    },
  );
  const context = {
    save: vi.fn(),
    restore: vi.fn(),
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    fillStyle: '',
    imageSmoothingQuality: 'low',
  };
  const frame = {} as CanvasImageSource;
  const geometry = {
    width: 1080,
    height: 1080,
    content: { left: 0, top: 236, width: 1080, height: 608 },
  };
  const fit = { aspect: '1:1', background: 'blur', color: '#ffffff' } as const;
  paintFit(context as unknown as OffscreenCanvasRenderingContext2D, frame, geometry, fit);
  paintFit(context as unknown as OffscreenCanvasRenderingContext2D, frame, geometry, fit);
  expect(constructed).toHaveBeenCalledTimes(1);
  expect(scratch.imageSmoothingQuality).toBe('high');
  expect(context.imageSmoothingQuality).toBe('high');
  expect(smallDraw).toHaveBeenCalledWith(
    frame,
    expect.any(Number),
    expect.any(Number),
    expect.any(Number),
    expect.any(Number),
  );
  expect(context.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1080, 1080);
  expect(context).not.toHaveProperty('filter');
});

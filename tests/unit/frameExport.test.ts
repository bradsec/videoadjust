import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportCurrentFrame, preparedFrameMatrix } from '../../src/core/frameExport';
import * as overlays from '../../src/core/overlays';
import * as styles from '../../src/core/style';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('captures output pixels in geometry, colour/style, overlay order and releases the renderer', async () => {
  const order: string[] = [];
  const source = {} as HTMLVideoElement;
  const layer = {} as OffscreenCanvas;
  const context = {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    rotate: vi.fn(),
    drawImage: vi.fn((image) =>
      order.push(image === source ? 'source' : image === layer ? 'overlay' : 'style'),
    ),
  };
  const blob = new Blob(['frame'], { type: 'image/png' });
  const encode = vi.fn(async () => blob);
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      constructor(
        public width: number,
        public height: number,
      ) {}
      getContext() {
        return context;
      }
      convertToBlob = encode;
    },
  );
  vi.spyOn(overlays, 'renderOverlayLayer').mockResolvedValue(layer);
  const destroy = vi.fn();
  const draw = vi.fn(() => order.push('correct and style'));
  vi.spyOn(styles, 'createStyleRenderer').mockReturnValue({ draw, destroy });
  const style = styles.normalizeStyle({ id: 'mono', correction: { exposure: 1 } });
  expect(
    await exportCurrentFrame(
      source,
      { width: 640, height: 360 },
      {
        output: { width: 200, height: 100 },
        timestamp: 2.3,
        transform: {
          rotate: 90,
          flip: true,
          crop: 'free',
          rect: { left: 40, top: 20, width: 200, height: 100 },
        },
        style,
      },
    ),
  ).toBe(blob);
  expect(context.clearRect).toHaveBeenCalledWith(0, 0, 200, 100);
  expect(context.setTransform).toHaveBeenCalledWith(
    ...preparedFrameMatrix(
      { width: 640, height: 360 },
      { width: 200, height: 100 },
      {
        rotate: 90,
        flip: true,
        crop: 'free',
        rect: { left: 40, top: 20, width: 200, height: 100 },
      },
    ),
  );
  expect(draw).toHaveBeenCalledWith(expect.anything(), 200, 100, 2.3, style);
  expect(order).toEqual(['source', 'correct and style', 'style', 'overlay']);
  expect(encode).toHaveBeenCalledWith({ type: 'image/png', quality: 0.92 });
  expect(destroy).toHaveBeenCalledTimes(1);
});

describe('prepared frame matrix', () => {
  const source = { width: 100, height: 60 };
  it.each([
    [
      'original',
      { width: 200, height: 120 },
      undefined,
      [
        [0, 0, 0, 0],
        [100, 60, 200, 120],
      ],
    ],
    [
      'crop rect',
      { width: 80, height: 40 },
      { crop: 'free', rect: { left: 20, top: 10, width: 40, height: 20 } },
      [
        [20, 10, 0, 0],
        [60, 30, 80, 40],
      ],
    ],
    [
      'rotate 90',
      { width: 60, height: 100 },
      { rotate: 90 },
      [
        [0, 0, 60, 0],
        [100, 0, 60, 100],
        [0, 60, 0, 0],
      ],
    ],
    [
      'rotate 180',
      { width: 100, height: 60 },
      { rotate: 180 },
      [
        [0, 0, 100, 60],
        [100, 60, 0, 0],
      ],
    ],
    [
      'rotate 270',
      { width: 60, height: 100 },
      { rotate: 270 },
      [
        [0, 0, 0, 100],
        [100, 0, 0, 0],
        [0, 60, 60, 100],
      ],
    ],
    [
      'flip',
      { width: 100, height: 60 },
      { flip: true },
      [
        [0, 0, 100, 0],
        [100, 60, 0, 60],
      ],
    ],
    [
      'flip and rotate',
      { width: 60, height: 100 },
      { flip: true, rotate: 90 },
      [
        [0, 0, 0, 0],
        [100, 0, 0, 100],
        [0, 60, 60, 0],
      ],
    ],
  ] as const)('%s maps corners', (_name, output, transform, points) => {
    const [a, b, c, d, e, f] = preparedFrameMatrix(source, output, {
      rotate: 0,
      flip: false,
      crop: 'original',
      ...transform,
    });
    for (const [x, y, expectedX, expectedY] of points) {
      expect(a * x + c * y + e).toBeCloseTo(expectedX);
      expect(b * x + d * y + f).toBeCloseTo(expectedY);
    }
  });
});

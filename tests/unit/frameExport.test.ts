import { afterEach, expect, it, vi } from 'vitest';
import { exportCurrentFrame } from '../../src/core/frameExport';
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
  expect(context.setTransform).toHaveBeenCalledWith(1, 0, 0, 1, -40, -20);
  expect(context.translate).toHaveBeenCalledWith(180, 320);
  expect(context.scale).toHaveBeenCalledWith(-1, 1);
  expect(context.rotate).toHaveBeenCalledWith(Math.PI / 2);
  expect(draw).toHaveBeenCalledWith(expect.anything(), 200, 100, 2.3, style);
  expect(order).toEqual(['source', 'correct and style', 'style', 'overlay']);
  expect(encode).toHaveBeenCalledWith({ type: 'image/png', quality: 0.92 });
  expect(destroy).toHaveBeenCalledTimes(1);
});

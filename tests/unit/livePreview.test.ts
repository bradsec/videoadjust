import { describe, expect, it } from 'vitest';
import type { CropPreset, Rotation } from '../../src/core/types';
import { livePreviewGeometry, previewFidelity } from '../../src/ui/livePreview';

const source = { width: 640, height: 360 };
const container = { width: 640, height: 640 };
type Geometry = NonNullable<ReturnType<typeof livePreviewGeometry>>;

// Apply the CSS operations to a source pixel, returning its position inside the clipped frame.
function project(geometry: Geometry, x: number, y: number) {
  const match = geometry.transform.match(
    /^translate\(([-\d.]+)px, ([-\d.]+)px\) scaleX\((-?1)\) rotate\((\d+)deg\) translate\(-50%, -50%\)$/,
  )!;
  const [, tx, ty, flip, rotate] = match.map(Number);
  const dx = (x / source.width - 0.5) * geometry.videoWidth;
  const dy = (y / source.height - 0.5) * geometry.videoHeight;
  const angle = (rotate * Math.PI) / 180;
  return {
    x: tx + flip * (dx * Math.cos(angle) - dy * Math.sin(angle)),
    y: ty + dx * Math.sin(angle) + dy * Math.cos(angle),
  };
}

describe('live preview geometry', () => {
  for (const rotate of [0, 90, 180, 270] as const) {
    for (const flip of [false, true]) {
      it(`rotates ${rotate} then mirrors ${flip} in output space`, () => {
        const geometry = livePreviewGeometry(
          source,
          { rotate, flip, crop: 'original' },
          container,
        )!;
        const [width, height, x, y]: number[] = {
          0: [640, 360, 0, 0],
          90: [360, 640, 360, 0],
          180: [640, 360, 640, 360],
          270: [360, 640, 0, 640],
        }[rotate];
        expect(geometry.width).toBe(width);
        expect(geometry.height).toBe(height);
        expect(geometry.left).toBe((640 - width) / 2);
        expect(geometry.top).toBe((640 - height) / 2);
        const first = project(geometry, 0, 0);
        const last = project(geometry, 640, 360);
        expect(first.x).toBeCloseTo(flip ? width - x : x);
        expect(first.y).toBeCloseTo(y);
        expect(last.x).toBeCloseTo(flip ? x : width - x);
        expect(last.y).toBeCloseTo(height - y);
      });
    }
  }

  it.each<[CropPreset, number, number, number, number]>([
    ['original', 0, 0, 640, 360],
    ['free', 0, 0, 640, 360],
    ['square', 140, 0, 360, 360],
    ['4:5', 176, 0, 288, 360],
    ['portrait', 221, 4, 198, 352],
    ['landscape', 0, 0, 640, 360],
  ])('fits the %s crop and clips its origin', (crop, left, top, width, height) => {
    const geometry = livePreviewGeometry(source, { rotate: 0, flip: false, crop }, container)!;
    const scale = Math.min(640 / width, 640 / height);
    expect(geometry.width).toBeCloseTo(width * scale);
    expect(geometry.height).toBeCloseTo(height * scale);
    const origin = project(geometry, left, top);
    expect(origin.x).toBeCloseTo(0);
    expect(origin.y).toBeCloseTo(0);
    const end = project(geometry, left + width, top + height);
    expect(end.x).toBeCloseTo(geometry.width);
    expect(end.y).toBeCloseTo(geometry.height);
  });

  it.each<Rotation>([0, 90, 180, 270])('crops an off-centre mirrored %i degree frame', (rotate) => {
    const geometry = livePreviewGeometry(
      source,
      { rotate, flip: true, crop: 'free', rect: { left: 40, top: 20, width: 200, height: 100 } },
      { width: 400, height: 400 },
    )!;
    expect(geometry.crop).toEqual({ left: 40, top: 20, width: 200, height: 100 });
    expect(geometry).toMatchObject({ width: 400, height: 200, left: 0, top: 100 });
    const points: Record<Rotation, [number, number]> = {
      0: [600, 20],
      90: [20, 40],
      180: [40, 340],
      270: [620, 320],
    };
    const origin = project(geometry, ...points[rotate]);
    expect(origin.x).toBeCloseTo(0);
    expect(origin.y).toBeCloseTo(0);
  });

  it('normalizes an out-of-bounds custom crop on an odd frame', () => {
    const geometry = livePreviewGeometry(
      { width: 641, height: 361 },
      {
        rotate: 90,
        flip: true,
        crop: 'free',
        rect: { left: 500, top: -20, width: 201, height: 101 },
      },
      { width: 333, height: 111 },
    )!;
    expect(geometry.crop).toEqual({ left: 161, top: 0, width: 200, height: 100 });
    expect(geometry.width).toBeCloseTo(222);
    expect(geometry.height).toBeCloseTo(111);
    expect(geometry.left).toBeCloseTo(55.5);
    expect(geometry.top).toBeCloseTo(0);
    expect(geometry.videoWidth).toBeCloseTo(641 * 1.11);
    expect(geometry.videoHeight).toBeCloseTo(361 * 1.11);
  });

  it('preserves an uncropped odd aspect ratio and letterboxes wide and tall containers', () => {
    const odd = { width: 1919, height: 1079 };
    const wide = livePreviewGeometry(odd, undefined, { width: 1000, height: 100 })!;
    expect(wide.crop).toBeNull();
    expect(wide.height).toBe(100);
    expect(wide.width).toBeCloseTo((1919 / 1079) * 100);
    expect(wide.left).toBeCloseTo((1000 - wide.width) / 2);
    expect(wide.top).toBe(0);
    const tall = livePreviewGeometry(odd, undefined, { width: 100, height: 1000 })!;
    expect(tall.width).toBe(100);
    expect(tall.height).toBeCloseTo((1079 / 1919) * 100);
    expect(tall.left).toBe(0);
    expect(tall.top).toBeCloseTo((1000 - tall.height) / 2);
  });

  it('handles a reduced Original crop', () => {
    const geometry = livePreviewGeometry(
      { width: 1920, height: 1080 },
      {
        rotate: 0,
        flip: false,
        crop: 'original',
        rect: { left: 32, top: 18, width: 1600, height: 900 },
      },
      { width: 800, height: 450 },
    )!;
    expect(geometry.crop).toEqual({ left: 32, top: 18, width: 1600, height: 900 });
    expect(geometry).toMatchObject({ width: 800, height: 450, left: 0, top: 0 });
  });

  it.each([0, -1, NaN, Infinity])('ignores unavailable or invalid dimensions: %s', (width) => {
    expect(livePreviewGeometry(source, undefined, { width, height: 100 })).toBeNull();
    expect(livePreviewGeometry({ width, height: 100 }, undefined, container)).toBeNull();
  });
});

describe('preview fidelity', () => {
  const frame = { width: 1920, height: 1080 };
  it('renders through the canvas when the output is smaller or slower than the source', () => {
    expect(previewFidelity({ output: frame, fps: 30, sourceFps: 30 }, frame)).toEqual({
      scaled: false,
      reduced: false,
    });
    expect(
      previewFidelity({ output: { width: 854, height: 480 }, fps: 30, sourceFps: 30 }, frame),
    ).toEqual({ scaled: true, reduced: false });
    expect(previewFidelity({ output: frame, fps: 15, sourceFps: 29.97 }, frame)).toEqual({
      scaled: false,
      reduced: true,
    });
  });
  it('ignores rounding in frame rates and missing rates', () => {
    expect(previewFidelity({ output: frame, fps: 29.97, sourceFps: 29.97 }, frame).reduced).toBe(
      false,
    );
    expect(previewFidelity({ output: frame, fps: null, sourceFps: 30 }, frame).reduced).toBe(false);
  });
});

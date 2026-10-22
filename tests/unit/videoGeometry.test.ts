import { describe, expect, it } from 'vitest';
import {
  cropRectangle,
  moveCrop,
  normalizeCrop,
  remapCrop,
  resizeCrop,
} from '../../src/core/videoGeometry';

describe('crop geometry', () => {
  it('fits the largest centred rectangle for each ratio', () => {
    expect(cropRectangle(640, 360, 'original')).toBeNull();
    expect(cropRectangle(640, 360, 'free')).toEqual({ left: 0, top: 0, width: 640, height: 360 });
    expect(cropRectangle(640, 360, 'square')).toEqual({
      left: 140,
      top: 0,
      width: 360,
      height: 360,
    });
    expect(cropRectangle(640, 360, '4:5')).toEqual({ left: 176, top: 0, width: 288, height: 360 });
    expect(cropRectangle(640, 360, 'portrait')).toEqual({
      left: 221,
      top: 4,
      width: 198,
      height: 352,
    });
    expect(cropRectangle(640, 360, 'landscape')).toEqual({
      left: 0,
      top: 0,
      width: 640,
      height: 360,
    });
  });

  it('clamps movement and locked resizing to the frame', () => {
    const square = { left: 180, top: 40, width: 200, height: 200 };
    expect(moveCrop(square, 1000, -1000, 640, 360)).toEqual({
      left: 440,
      top: 0,
      width: 200,
      height: 200,
    });
    expect(resizeCrop(square, 'se', 100, 20, 640, 360, 'square')).toEqual({
      left: 180,
      top: 40,
      width: 300,
      height: 300,
    });
    const narrowed = resizeCrop(square, 'nw', 1000, 1000, 640, 360, 'square');
    expect(narrowed.width).toBeGreaterThanOrEqual(32);
    expect(narrowed.width).toBe(narrowed.height);
    expect(narrowed.left).toBeGreaterThanOrEqual(0);
  });

  it('mirrors a displaced crop and remaps it through rotation', () => {
    const rect = { left: 40, top: 20, width: 200, height: 200 };
    expect(remapCrop(rect, 640, 360, 0, false, 0, true, 'square')).toEqual({
      left: 400,
      top: 20,
      width: 200,
      height: 200,
    });
    expect(remapCrop(rect, 640, 360, 0, false, 90, false, 'square')).toEqual({
      left: 140,
      top: 40,
      width: 200,
      height: 200,
    });
  });

  it('normalises bounds and even dimensions without losing a free crop', () => {
    expect(
      normalizeCrop(641, 361, 'free', { left: 500, top: -20, width: 201, height: 101 }),
    ).toEqual({ left: 441, top: 0, width: 200, height: 100 });
    expect(
      normalizeCrop(640, 360, '4:5', { left: 100, top: 20, width: 173, height: 212 }),
    ).toMatchObject({ width: 168, height: 210 });
  });

  it('keeps Original full frame uncropped and locks smaller rectangles to the frame ratio', () => {
    expect(normalizeCrop(1920, 1080, 'original')).toBeNull();
    expect(
      normalizeCrop(1920, 1080, 'original', { left: 0, top: 0, width: 1920, height: 1080 }),
    ).toBeNull();
    const resized = resizeCrop(
      { left: 0, top: 0, width: 1920, height: 1080 },
      'e',
      -2,
      0,
      1920,
      1080,
      'original',
    );
    expect(resized).toEqual({ left: 0, top: 9, width: 1888, height: 1062 });
    expect(normalizeCrop(1920, 1080, 'original', resized)).toEqual(resized);
    expect(moveCrop(resized, 20, 10, 1920, 1080)).toMatchObject({ width: 1888, height: 1062 });
  });

  it('uses even, near-continuous locked sizes when reduced Original units are coarse', () => {
    const resized = resizeCrop(
      { left: 0, top: 0, width: 1918, height: 1080 },
      'e',
      -2,
      0,
      1918,
      1080,
      'original',
    );
    expect(resized.width).toBe(1916);
    expect(resized.height % 2).toBe(0);
    expect(Math.abs(resized.width / resized.height - 1918 / 1080)).toBeLessThan(0.005);
    expect(normalizeCrop(1918, 1080, 'original', resized)).toEqual(resized);
  });

  it('refits a reduced Original crop after rotation', () => {
    const rect = { left: 32, top: 18, width: 1600, height: 900 };
    const rotated = remapCrop(rect, 1920, 1080, 0, false, 90, false, 'original');
    expect(rotated).not.toBeNull();
    expect(rotated!.width / rotated!.height).toBeCloseTo(1080 / 1920, 3);
    expect(rotated!.width).toBeLessThan(1080);
  });
});

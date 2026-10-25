import { describe, expect, it } from 'vitest';
import {
  autoGifSettings,
  gifBudgetError,
  gifCropGeometry,
  gifDimensions,
  gifFramePlan,
  gifFrameRates,
  gifOutputName,
  GIF_MAX_FRAMES,
  GIF_PIXEL_BUDGET,
  validateGifSettings,
  type GifSettings,
} from '../../src/core/gifExport';
import type { SourceInfo } from '../../src/core/types';

function source(over: Partial<NonNullable<SourceInfo['video']>> = {}): SourceInfo {
  return {
    name: 'clip.mp4',
    sizeBytes: 1_000_000,
    durationSec: 3,
    containerMime: 'video/mp4',
    video: {
      codec: 'avc',
      decodable: true,
      displayWidth: 640,
      displayHeight: 360,
      rotation: 0,
      fps: 30,
      bitrate: 1_000_000,
      ...over,
    },
    audio: null,
  };
}

describe('GIF settings', () => {
  it('names GIFs after the source without requiring an extension', () => {
    expect(gifOutputName('clip.mp4')).toBe('clip-animated.gif');
    expect(gifOutputName('clip')).toBe('clip-animated.gif');
  });

  it('requires decodable video', () => {
    expect(autoGifSettings({ ...source(), video: null })).toBeNull();
    expect(autoGifSettings(source({ decodable: false }))).toBeNull();
    expect(autoGifSettings(source())).not.toBeNull();
  });

  it('defaults to a small, short-loop friendly GIF', () => {
    expect(autoGifSettings(source({ displayWidth: 1920, displayHeight: 1080 }))).toMatchObject({
      size: 320,
      colors: 128,
    });
  });

  it('caps the long edge and frame rate to the source', () => {
    const small = source({ displayWidth: 240, displayHeight: 136, fps: 12 });
    const auto = autoGifSettings(small)!;
    expect(auto.size).toBeLessThanOrEqual(240);
    expect(auto.fps).toBeLessThanOrEqual(12);
    const invalid: GifSettings = {
      ...auto,
      size: 640,
      fps: 20,
      loop: 'invalid' as GifSettings['loop'],
      colors: 12 as GifSettings['colors'],
    };
    const valid = validateGifSettings(invalid, auto, small);
    expect(valid.size).toBeLessThanOrEqual(240);
    expect(valid.fps).toBeLessThanOrEqual(12);
    expect(['forever', 'once']).toContain(valid.loop);
    expect([64, 128, 256]).toContain(valid.colors);
  });

  it('preserves valid choices and the shared trim', () => {
    const src = source();
    const auto = autoGifSettings(src)!;
    const settings = validateGifSettings(
      { ...auto, trim: { start: 0.5, end: 2 }, size: 320, fps: 10, loop: 'once', colors: 64 },
      auto,
      src,
    );
    expect(settings).toMatchObject({
      trim: { start: 0.5, end: 2 },
      size: 320,
      fps: 10,
      loop: 'once',
      colors: 64,
    });
  });

  it('preserves the offered source rate for a 12 fps video', () => {
    const src = source({ fps: 12 });
    const auto = autoGifSettings(src)!;
    expect(gifFrameRates(src.video!.fps)).toEqual([5, 10, 12]);
    expect(validateGifSettings({ ...auto, fps: 12 }, auto, src).fps).toBe(12);
  });
});

describe('GIF frames', () => {
  it('scales the full oriented frame and an offset crop to the target width', () => {
    expect(
      gifCropGeometry(
        { width: 640, height: 360 },
        { left: 160, top: 60, width: 320, height: 240 },
        160,
      ),
    ).toEqual({
      width: 320,
      height: 180,
      crop: { left: 80, top: 30, width: 160, height: 120 },
    });
  });

  it('maps crop edges to the rounded canvas dimensions for a rotated frame', () => {
    const geometry = gifCropGeometry(
      { width: 359, height: 641 },
      { left: 59, top: 241, width: 300, height: 400 },
      160,
    );
    expect(geometry.width).toBe(191);
    expect(geometry.height).toBe(342);
    expect(geometry.crop.left).toBeCloseTo((59 * 191) / 359);
    expect(geometry.crop.top).toBeCloseTo((241 * 342) / 641);
    expect(geometry.crop.left + geometry.crop.width).toBeCloseTo(191);
    expect(geometry.crop.top + geometry.crop.height).toBeCloseTo(342);
  });

  it('samples from the trim start without crossing the end', () => {
    const plan = gifFramePlan({ start: 0.25, end: 1.25 }, 10);
    expect(plan.timestamps).toHaveLength(10);
    expect(plan.timestamps[0]).toBeCloseTo(0.25, 8);
    expect(plan.timestamps.at(-1)).toBeCloseTo(1.15, 8);
    expect(plan.timestamps.every((time) => time < 1.25)).toBe(true);
    expect(plan.delaysMs).toHaveLength(plan.timestamps.length);
    expect(plan.delaysMs.reduce((sum, delay) => sum + delay, 0)).toBe(1000);
  });

  it('accumulates centisecond rounding so total playback stays on the trim', () => {
    const plan = gifFramePlan({ start: 0.13, end: 1.43 }, 15);
    expect(plan.timestamps[0]).toBeCloseTo(0.13, 8);
    expect(plan.timestamps.every((time) => time < 1.43)).toBe(true);
    expect(plan.delaysMs.every((delay) => delay > 0 && delay % 10 === 0)).toBe(true);
    expect(
      Math.abs(plan.delaysMs.reduce((sum, delay) => sum + delay, 0) - 1300),
    ).toBeLessThanOrEqual(10);
    expect(new Set(plan.delaysMs).size).toBeGreaterThan(1);
  });

  it('applies the size to the long edge so portrait frames are not larger', () => {
    const portrait = source({ displayWidth: 720, displayHeight: 1280 });
    const settings = { ...autoGifSettings(portrait)!, size: 480 };
    expect(gifDimensions(settings, portrait, undefined)).toEqual({ width: 270, height: 480 });
  });

  it('keeps the aspect ratio, applies the crop, and uses even dimensions', () => {
    const settings = { ...autoGifSettings(source())!, size: 320 };
    expect(gifDimensions(settings, source(), undefined)).toEqual({ width: 320, height: 180 });
    expect(gifDimensions(settings, source(), { rotate: 0, flip: false, crop: 'square' })).toEqual({
      width: 320,
      height: 320,
    });
    const odd = source({ displayWidth: 641, displayHeight: 359 });
    const dimensions = gifDimensions({ ...settings, size: 480 }, odd, undefined);
    expect(dimensions.width % 2).toBe(0);
    expect(dimensions.height % 2).toBe(0);
  });

  it('rejects an excessive pixel and frame budget with useful advice', () => {
    expect(gifBudgetError(320, 180, 10)).toBeNull();
    expect(gifBudgetError(320, 180, 300, 30)).toBeNull();
    expect(gifBudgetError(320, 180, 301, 30.1)).toMatch(/at most 30 seconds/);
    expect(gifBudgetError(1, 1, GIF_MAX_FRAMES)).toBeNull();
    expect(gifBudgetError(1, 1, GIF_MAX_FRAMES + 1)).toBeTruthy();
    expect(gifBudgetError(1000, 1000, GIF_PIXEL_BUDGET / 1_000_000)).toBeNull();
    const reason = gifBudgetError(1000, 1000, GIF_PIXEL_BUDGET / 1_000_000 + 1);
    expect(reason).toBeTruthy();
    expect(reason).toMatch(/trim|frame rate|width|smaller|shorter/i);
  });
});

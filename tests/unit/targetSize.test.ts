import { Quality } from 'mediabunny';
import { describe, expect, it } from 'vitest';
import { autoSettings, targetVideoBitrate } from '../../src/core/autoSettings';
import { toConversionOptions } from '../../src/core/convert';
import { CONTAINER_OVERHEAD, estimateBytes } from '../../src/core/estimate';
import {
  applyTargetSize,
  retryTargetSize,
  targetSizeStatus,
  TARGET_FLOOR_RATIO,
  TARGET_SIZE_SAFETY,
  validTargetSize,
} from '../../src/core/targetSize';
import type { Capabilities, Settings, SourceInfo } from '../../src/core/types';
import { outputSize } from '../../src/core/videoGeometry';
import { settingsChangeCount, validateSettings } from '../../src/ui/controller';

const caps: Capabilities = {
  video: { avc: true, hevc: true, av1: true, vp9: true },
  audio: { aac: true, opus: true },
  aacViaFallback: false,
  fileStreamSave: false,
  shareFiles: false,
};
const source: SourceInfo = {
  name: 'clip.mp4',
  sizeBytes: 50_000_000,
  durationSec: 20,
  containerMime: 'video/mp4',
  video: {
    codec: 'avc',
    decodable: true,
    displayWidth: 1920,
    displayHeight: 1080,
    rotation: 0,
    fps: 30,
    bitrate: 20_000_000,
  },
  audio: { codec: 'aac', decodable: true, channels: 2, sampleRate: 48000, bitrate: 128_000 },
};
const auto = autoSettings(source, caps);
const base: Settings = { ...auto.settings, passthrough: false, targetSizeMB: 8 };
const apply = (settings: Settings) => applyTargetSize(settings, auto, source);
const targetForBudget = (budget: number) => (budget * 20 * 1.01) / (8 * 0.92 * 1_000_000);
const floor1080 = 1920 * 1080 * 30 * 0.07 * 0.4;

describe('target size budget', () => {
  it('uses decimal MB, mux overhead and eight percent encoder headroom', () => {
    const result = apply(base);
    expect(CONTAINER_OVERHEAD).toBe(1.01);
    expect(TARGET_SIZE_SAFETY).toBe(0.92);
    expect(result.video!.bitrate).toBe(Math.floor(((8_000_000 * 8) / 20 / 1.01) * 0.92 - 128_000));
    expect(estimateBytes(result, source).mid).toBeLessThanOrEqual(8_000_000 * 0.92);
    expect(result.audio).toEqual(base.audio);
  });

  it('leaves target-off bitrate, audio and geometry unchanged', () => {
    const settings = { ...base, targetSizeMB: null };
    expect(apply(settings)).toEqual(settings);
  });

  it.each(['aac', 'opus'] as const)(
    'steps %s audio to 96 kbps before reducing resolution',
    (codec) => {
      const result = apply({
        ...base,
        targetSizeMB: targetForBudget(floor1080 + 110_000),
        audio: { ...base.audio!, codec, copy: true },
      });
      expect(result.audio).toMatchObject({ codec, bitrate: 96_000, copy: false });
      expect(result.video).toMatchObject({ width: 1920, height: 1080 });
      expect(result.video!.bitrate).toBeGreaterThanOrEqual(floor1080);
    },
  );

  it('steps audio further to 64 kbps when 96 kbps still breaches the floor', () => {
    const result = apply({ ...base, targetSizeMB: targetForBudget(floor1080 + 80_000) });
    expect(result.audio).toMatchObject({ bitrate: 64_000, copy: false });
    expect(result.video).toMatchObject({ width: 1920, height: 1080 });
  });

  it('uses forty percent of codec auto BPP as the floor and steps to 720p', () => {
    expect(TARGET_FLOOR_RATIO).toBe(0.4);
    const result = apply({ ...base, targetSizeMB: targetForBudget(1_000_000) });
    expect(result.video).toMatchObject({ width: 1280, height: 720, bitrate: 936_000 });
    expect(result.video!.bitrate).toBeGreaterThanOrEqual(
      targetVideoBitrate('avc', 1280, 720, 30) * 0.4,
    );
    expect(targetSizeStatus(result, source).tight).toBe(false);
  });

  it('keeps the smallest size and warns when a target is too tight', () => {
    const result = apply({ ...base, targetSizeMB: 0.05 });
    expect(result.video).toMatchObject({ width: 854, height: 480, bitrate: 1 });
    expect(result.audio!.bitrate).toBe(64_000);
    expect(targetSizeStatus(result, source)).toEqual({ tight: true, alreadyUnder: false });
  });

  it('uses cropped and rotated output geometry for resolution steps', () => {
    const transform = { rotate: 90 as const, flip: false, crop: 'square' as const };
    const result = apply({
      ...base,
      targetSizeMB: 0.05,
      transform,
      video: { ...base.video!, width: 1080, height: 1080 },
    });
    expect(result.video).toMatchObject(outputSize(source.video!, 90, 'square', 854));
    expect(result.transform).toEqual(transform);
    const portrait = apply({
      ...base,
      targetSizeMB: 0.05,
      transform: { ...transform, crop: 'original' },
      video: { ...base.video!, width: 1080, height: 1920 },
    });
    expect(portrait.video).toMatchObject({ width: 480, height: 854 });
  });

  it('never upscales a smaller user resolution even with a generous budget', () => {
    for (const targetSizeMB of [0.05, 100]) {
      const result = apply({
        ...base,
        targetSizeMB,
        video: { ...base.video!, width: 640, height: 360 },
      });
      expect(result.video).toMatchObject({ width: 640, height: 360 });
    }
  });

  it('recalculates the budget for a shorter trim through controller validation', () => {
    const full = validateSettings(base, auto, caps, source);
    const trimmed = validateSettings({ ...full, trim: { start: 5, end: 15 } }, auto, caps, source);
    expect(trimmed.video!.bitrate).toBe(Math.floor(((8_000_000 * 8) / 10 / 1.01) * 0.92 - 128_000));
    expect(trimmed.video!.bitrate).toBeGreaterThan(full.video!.bitrate);
    expect(estimateBytes(trimmed, source).mid).toBeLessThanOrEqual(8_000_000);
  });

  it('keeps an already-under-target trimmed copy without re-encoding', () => {
    const settings = { ...base, passthrough: true, trim: { start: 0, end: 1 } };
    expect(apply(settings)).toEqual(settings);
    expect(targetSizeStatus(settings, source)).toEqual({ tight: false, alreadyUnder: true });
    expect(toConversionOptions(apply(settings)).video).toEqual({});
    const tooLarge = apply({ ...settings, targetSizeMB: 0.05 });
    expect(tooLarge.passthrough).toBe(false);
  });

  it('revalidates codec, fps, audio, container and crop under an active target', () => {
    const requested = { ...base, targetSizeMB: targetForBudget(1_200_000) };
    const validate = (settings: Settings) => validateSettings(settings, auto, caps, source);
    const initial = validate(requested);
    expect(initial.video!.width).toBe(1280);
    const codec = validate({ ...requested, video: { ...requested.video!, codec: 'av1' } });
    expect(codec.video).toMatchObject({ codec: 'av1', width: 1920, height: 1080 });
    const fps = validate({ ...requested, video: { ...requested.video!, fps: 15 } });
    expect(fps.video).toMatchObject({ fps: 15, width: 1920, height: 1080 });
    const silent = validate({ ...requested, audio: null });
    expect(silent.audio).toBeNull();
    expect(silent.video!.bitrate).toBe(1_200_000);
    expect(silent.video!.bitrate).toBeGreaterThan(initial.video!.bitrate);
    const webm = validate({ ...requested, container: 'webm' });
    expect(webm.container).toBe('webm');
    expect(webm.video!.codec).toBe('vp9');
    expect(webm.audio!.codec).toBe('opus');
    const cropped = validate({
      ...requested,
      transform: { rotate: 90, flip: false, crop: 'square' },
      video: { ...requested.video!, width: 1080, height: 1080 },
    });
    expect(cropped.video!.width).toBe(cropped.video!.height);
    expect(cropped.video!.width).toBeLessThanOrEqual(1080);
    for (const result of [codec, fps, silent, webm, cropped]) {
      expect(estimateBytes(result, source).mid).toBeLessThanOrEqual(
        requested.targetSizeMB * 1_000_000,
      );
    }
  });

  it('validates an already-under-target trimmed copy without changing its copy path', () => {
    const result = validateSettings(
      { ...base, passthrough: true, trim: { start: 0, end: 1 } },
      auto,
      caps,
      source,
    );
    expect(result.passthrough).toBe(true);
    expect(targetSizeStatus(result, source).alreadyUnder).toBe(true);
    expect(toConversionOptions(result).video).toEqual({});
  });

  it('never upscales a source below the smallest standard resolution', () => {
    const small: SourceInfo = {
      ...source,
      video: { ...source.video!, displayWidth: 640, displayHeight: 360 },
    };
    const smallAuto = autoSettings(small, caps);
    for (const targetSizeMB of [0.05, 100]) {
      const result = validateSettings(
        { ...smallAuto.settings, targetSizeMB, passthrough: false },
        smallAuto,
        caps,
        small,
      );
      expect(result.video).toMatchObject({ width: 640, height: 360 });
    }
  });

  it.each([undefined, null, 0, -1, 0.049, 4097, NaN, Infinity])(
    'rejects invalid target %s',
    (value) => {
      expect(validTargetSize(value)).toBeNull();
    },
  );

  it.each([0.05, 0.5, 25, 4096])('accepts target %s MB', (value) => {
    expect(validTargetSize(value)).toBe(value);
  });

  it('scales retries by target over actual times safety and accumulates retries', () => {
    const initial = apply(base);
    const retry = retryTargetSize(initial, 10_000_000);
    expect(retry.targetRetryScale).toBe((8 / 10) * 0.92);
    expect(apply(retry).video!.bitrate).toBe(
      Math.floor(((8_000_000 * 8 * 0.92) / 20 / 1.01 - 128_000) * ((8 / 10) * 0.92)),
    );
    expect(retryTargetSize(retry, 9_000_000).targetRetryScale).toBe(
      (8 / 10) * 0.92 * (8 / 9) * 0.92,
    );
  });

  it('counts a target and its derived audio/resolution reductions as one change', () => {
    const result = validateSettings({ ...base, targetSizeMB: 0.05 }, auto, caps, source);
    expect(result.video!.width).toBe(854);
    expect(result.audio!.bitrate).toBe(64_000);
    expect(settingsChangeCount(result, auto, caps, source)).toBe(1);
  });

  it('encodes a target at its bitrate in the default mode and always re-encodes', () => {
    const settings = apply(base);
    expect(toConversionOptions(settings).video).toMatchObject({
      quality: new Quality({ bitrate: settings.video!.bitrate }),
      forceTranscode: true,
    });
    expect(toConversionOptions({ ...settings, targetSizeMB: null }).video).toMatchObject({
      quality: new Quality({ bitrate: settings.video!.bitrate }),
    });
  });
});

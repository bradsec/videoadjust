import { defaultOverlays } from '../../src/core/overlays';
import { describe, expect, it } from 'vitest';
import { autoSettings, targetVideoBitrate } from '../../src/core/autoSettings';
import { estimateBytes } from '../../src/core/estimate';
import type { Capabilities, SourceInfo } from '../../src/core/types';
import { settingsChangeCount, validateSettings } from '../../src/ui/controller';

const caps: Capabilities = {
  video: { avc: true, hevc: false, av1: false, vp9: true },
  audio: { aac: true, opus: true },
  aacViaFallback: false,
  fileStreamSave: false,
  shareFiles: false,
};
const source: SourceInfo = {
  name: 'clip.mp4',
  sizeBytes: 100e6,
  durationSec: 20,
  containerMime: 'video/mp4',
  video: {
    codec: 'avc',
    decodable: true,
    displayWidth: 1920,
    displayHeight: 1080,
    rotation: 0,
    fps: 30,
    bitrate: 2e6,
  },
  audio: { codec: 'aac', decodable: true, channels: 2, sampleRate: 48000, bitrate: 96e3 },
};

describe('settings validation', () => {
  const auto = autoSettings(source, caps);
  it('keeps video copy eligible with processed audio and clamps fades to the trim', () => {
    const settings = validateSettings(
      {
        ...auto.settings,
        passthrough: true,
        trim: { start: 1, end: 3 },
        audioProcessing: { gainDb: 3, fadeIn: 2, fadeOut: 2 },
      },
      auto,
      caps,
      source,
    );
    expect(settings.passthrough).toBe(true);
    expect(settings.audio?.copy).toBe(false);
    expect(settings.audioProcessing).toMatchObject({ gainDb: 3, fadeIn: 1, fadeOut: 1 });
    expect(settingsChangeCount(settings, auto, caps, source)).toBe(1);
  });
  it('validates overlays and counts independently enabled layers', () => {
    const overlays = defaultOverlays();
    overlays.text.enabled = true;
    overlays.text.content = 'a'.repeat(600);
    overlays.text.opacity = 5;
    overlays.text.fontSize = -1;
    overlays.text.font = 'Remote font' as typeof overlays.text.font;
    overlays.image.enabled = true;
    overlays.image.position = { x: -1, y: 2 };
    const settings = validateSettings(
      { ...auto.settings, passthrough: true, overlays },
      auto,
      caps,
      source,
    );
    expect(settings.passthrough).toBe(false);
    expect(settings.overlays?.text.content).toHaveLength(500);
    expect(settings.overlays?.text.opacity).toBe(1);
    expect(settings.overlays?.text.fontSize).toBeGreaterThan(0);
    expect(settings.overlays?.text.font).toBe('Inter');
    expect(settings.overlays?.image.position).toEqual({ x: 0, y: 1 });
    expect(settingsChangeCount(settings, auto, caps, source)).toBe(2);
    settings.overlays!.text.enabled = false;
    settings.overlays!.image.enabled = false;
    expect(settingsChangeCount(settings, auto, caps, source)).toBe(0);
  });
  it('disables video passthrough for shorter keyframe intervals', () => {
    for (const keyFrameInterval of [1, 2] as const) {
      const settings = validateSettings(
        { ...auto.settings, passthrough: true, keyFrameInterval },
        auto,
        caps,
        source,
      );
      expect(settings.passthrough).toBe(false);
      expect(settings.keyFrameInterval).toBe(keyFrameInterval);
      expect(settingsChangeCount(settings, auto, caps, source)).toBe(1);
    }
    expect(
      validateSettings({ ...auto.settings, passthrough: true }, auto, caps, source).passthrough,
    ).toBe(true);
  });
  it('swaps dimensions for rotation, crops in rotated coordinates, and disables video passthrough', () => {
    const rotated = validateSettings(
      {
        ...auto.settings,
        passthrough: true,
        transform: { rotate: 90, flip: false, crop: 'original' },
      },
      auto,
      caps,
      source,
    );
    expect(rotated.video).toMatchObject({ width: 1080, height: 1920 });
    expect(rotated.passthrough).toBe(false);
    expect(settingsChangeCount(rotated, auto, caps, source)).toBe(1);
    const square = validateSettings(
      { ...rotated, transform: { rotate: 90, flip: true, crop: 'square' } },
      auto,
      caps,
      source,
    );
    expect(square.video).toMatchObject({ width: 1080, height: 1080 });
    expect(square.passthrough).toBe(false);
    for (const transform of [
      { rotate: 0 as const, flip: true, crop: 'original' as const },
      { rotate: 0 as const, flip: false, crop: 'square' as const },
    ]) {
      expect(
        validateSettings({ ...auto.settings, passthrough: true, transform }, auto, caps, source)
          .passthrough,
      ).toBe(false);
    }
    const tagsOnly = validateSettings(
      { ...auto.settings, passthrough: true, metadata: { title: 'New', strip: true } },
      auto,
      caps,
      source,
    );
    expect(tagsOnly.passthrough).toBe(true);
  });
  it('clamps a moved crop rectangle and sizes output from it', () => {
    const actual = validateSettings(
      {
        ...auto.settings,
        passthrough: true,
        transform: {
          rotate: 0,
          flip: false,
          crop: 'square',
          rect: { left: 3000, top: -20, width: 501, height: 301 },
        },
      },
      auto,
      caps,
      source,
    );
    expect(actual.transform?.rect).toEqual({ left: 1618, top: 0, width: 302, height: 302 });
    expect(actual.video).toMatchObject({ width: 302, height: 302 });
    expect(actual.passthrough).toBe(false);
  });
  it('keeps a full Original frame as passthrough but counts a reduced Original crop', () => {
    const full = validateSettings(
      {
        ...auto.settings,
        passthrough: true,
        transform: {
          rotate: 0,
          flip: false,
          crop: 'original',
          rect: { left: 0, top: 0, width: 1920, height: 1080 },
        },
      },
      auto,
      caps,
      source,
    );
    expect(full.transform?.rect).toBeNull();
    expect(full.video).toMatchObject({ width: 1920, height: 1080 });
    expect(full.passthrough).toBe(true);
    expect(settingsChangeCount(full, auto, caps, source)).toBe(0);
    expect(estimateBytes(full, source)).toEqual(
      estimateBytes(validateSettings(auto.settings, auto, caps, source), source),
    );

    const cropped = validateSettings(
      {
        ...auto.settings,
        passthrough: true,
        transform: {
          rotate: 0,
          flip: false,
          crop: 'original',
          rect: { left: 100, top: 50, width: 1600, height: 900 },
        },
      },
      auto,
      caps,
      source,
    );
    expect(cropped.transform?.crop).toBe('original');
    expect(cropped.transform?.rect).toMatchObject({ width: 1600, height: 900 });
    expect(cropped.video).toMatchObject({ width: 1600, height: 900 });
    expect(cropped.passthrough).toBe(false);
    expect(settingsChangeCount(cropped, auto, caps, source)).toBe(1);
  });
  it('bounds size, frame rate, video quality, and audio bitrate by source', () => {
    const actual = validateSettings(
      {
        ...auto.settings,
        video: { ...auto.settings.video!, width: 3840, height: 2160, fps: 60, bitrate: 99e6 },
        audio: { ...auto.settings.audio!, bitrate: 160e3 },
      },
      auto,
      caps,
      source,
    );
    expect(actual.video).toMatchObject({ width: 1920, height: 1080, fps: 30, bitrate: 2e6 });
    expect(actual.audio?.bitrate).toBe(96e3);
  });

  it('rejects unavailable codecs and forces Opus in WebM', () => {
    const hevc = validateSettings(
      { ...auto.settings, video: { ...auto.settings.video!, codec: 'hevc' } },
      auto,
      caps,
      source,
    );
    expect(hevc.video?.codec).toBe('avc');
    const webm = validateSettings({ ...auto.settings, container: 'webm' }, auto, caps, source);
    expect(webm.video?.codec).toBe('vp9');
    expect(webm.audio?.codec).toBe('opus');
    expect(webm.audio?.copy).toBe(false);
  });

  it('keeps trim and permits audio removal', () => {
    const actual = validateSettings(
      { ...auto.settings, trim: { start: 2, end: 10 }, audio: null },
      auto,
      caps,
      source,
    );
    expect(actual.trim).toEqual({ start: 2, end: 10 });
    expect(actual.audio).toBeNull();
  });

  it('never adds audio to a silent source or offers WebM without Opus', () => {
    const silent = { ...source, audio: null };
    const silentAuto = autoSettings(silent, caps);
    expect(
      validateSettings(
        { ...silentAuto.settings, audio: auto.settings.audio },
        silentAuto,
        caps,
        silent,
      ).audio,
    ).toBeNull();
    const noOpus = { ...caps, audio: { aac: true, opus: false } };
    expect(
      validateSettings({ ...auto.settings, container: 'webm' }, auto, noOpus, source).container,
    ).toBe('mp4');
  });
});

describe('settings change count', () => {
  it('counts codec, size, and frame rate changes without an extra quality change', () => {
    const rich = { ...source, video: { ...source.video!, bitrate: 12e6 } };
    const richCaps = { ...caps, video: { ...caps.video, hevc: true } };
    const auto = autoSettings(rich, richCaps);
    const original = validateSettings(auto.settings, auto, richCaps, rich);
    const changes = [{ codec: 'hevc' as const }, { width: 1280, height: 720 }, { fps: 24 }];
    for (const change of changes) {
      const nextVideo = { ...original.video!, ...change };
      const newBaseline = Math.min(
        targetVideoBitrate(nextVideo.codec, nextVideo.width, nextVideo.height, nextVideo.fps),
        rich.video.bitrate,
      );
      const requested = { ...original, video: { ...nextVideo, bitrate: newBaseline } };
      const effective = validateSettings(requested, auto, richCaps, rich);
      expect(settingsChangeCount(effective, auto, richCaps, rich)).toBe(1);
    }
  });

  it('treats the low-bitrate 1080p30 AAC fixture as automatic after validation', () => {
    const fixtureSource: SourceInfo = {
      name: 'land-1080p30-aac.mp4',
      sizeBytes: 185_500,
      durationSec: 3,
      containerMime: 'video/mp4',
      video: {
        codec: 'avc',
        decodable: true,
        displayWidth: 1920,
        displayHeight: 1080,
        rotation: 0,
        fps: 30,
        bitrate: 352_588.8,
      },
      audio: { codec: 'aac', decodable: true, channels: 2, sampleRate: 48000, bitrate: 128_000 },
    };
    const automatic = autoSettings(fixtureSource, caps);
    expect(automatic.alreadyOptimal).toBe(true);
    const effective = validateSettings(automatic.settings, automatic, caps, fixtureSource);
    expect(effective.video?.bitrate).not.toBe(automatic.settings.video?.bitrate);
    expect(settingsChangeCount(effective, automatic, caps, fixtureSource)).toBe(0);
    expect(
      settingsChangeCount(
        { ...effective, video: { ...effective.video!, bitrate: 200_000 } },
        automatic,
        caps,
        fixtureSource,
      ),
    ).toBe(1);
  });
});

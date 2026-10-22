import { describe, expect, it } from 'vitest';
import { autoSettings } from '../../src/core/autoSettings';
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

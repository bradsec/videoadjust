import { describe, expect, it } from 'vitest';
import { autoSettings, scaleToLongEdge, targetVideoBitrate } from '../../src/core/autoSettings';
import type { Capabilities, SourceInfo } from '../../src/core/types';

function fakeSource(over: {
  w?: number; h?: number; fps?: number; rotation?: 0 | 90 | 180 | 270;
  vCodec?: string | null; vBitrate?: number | null;
  channels?: number; aCodec?: string | null; aBitrate?: number | null;
  video?: null; audio?: null; mime?: string;
} = {}): SourceInfo {
  return {
    name: 'clip.mp4',
    sizeBytes: 10_000_000,
    durationSec: 20,
    containerMime: over.mime ?? 'video/mp4',
    video: over.video === null ? null : {
      codec: over.vCodec === undefined ? 'avc' : over.vCodec,
      decodable: true,
      displayWidth: over.w ?? 3840,
      displayHeight: over.h ?? 2160,
      rotation: over.rotation ?? 0,
      fps: over.fps ?? 60,
      bitrate: over.vBitrate === undefined ? 40_000_000 : over.vBitrate,
    },
    audio: over.audio === null ? null : {
      codec: over.aCodec === undefined ? 'aac' : over.aCodec,
      decodable: true,
      channels: over.channels ?? 2,
      sampleRate: 48000,
      bitrate: over.aBitrate === undefined ? 192_000 : over.aBitrate,
    },
  };
}

function allCaps(over: { video?: Partial<Capabilities['video']>; audio?: Partial<Capabilities['audio']> } = {}): Capabilities {
  return {
    video: { avc: true, hevc: true, av1: true, vp9: true, ...over.video },
    audio: { aac: true, opus: true, ...over.audio },
    aacViaFallback: false,
    fileStreamSave: true,
    shareFiles: true,
  };
}

describe('autoSettings', () => {
  it('caps 4K60 to 1080p30 avc/aac mp4', () => {
    const r = autoSettings(fakeSource(), allCaps());
    expect(r.settings.container).toBe('mp4');
    expect(r.settings.video).toMatchObject({ codec: 'avc', width: 1920, height: 1080, fps: 30 });
    expect(r.settings.audio).toMatchObject({ codec: 'aac', bitrate: 128000, channels: 2 });
    expect(r.alreadyOptimal).toBe(false);
  });

  it('does not upscale', () => {
    const r = autoSettings(fakeSource({ w: 1280, h: 720, fps: 30 }), allCaps());
    expect(r.settings.video).toMatchObject({ width: 1280, height: 720, fps: 30 });
  });

  it('applies the cap to the displayed long edge for portrait', () => {
    const a = autoSettings(fakeSource({ w: 1080, h: 1920, rotation: 90, fps: 30 }), allCaps());
    expect(a.settings.video).toMatchObject({ width: 1080, height: 1920 });
    const b = autoSettings(fakeSource({ w: 2160, h: 3840, fps: 30 }), allCaps());
    expect(b.settings.video).toMatchObject({ width: 1080, height: 1920 });
  });

  it('produces even dimensions', () => {
    const v = autoSettings(fakeSource({ w: 1921, h: 1081, fps: 30 }), allCaps()).settings.video!;
    expect(v.width % 2).toBe(0);
    expect(v.height % 2).toBe(0);
  });

  it('halves fps at 50 or more, keeps lower', () => {
    const fps = (f: number) => autoSettings(fakeSource({ fps: f }), allCaps()).settings.video!.fps;
    expect(fps(50)).toBe(25);
    expect(fps(24)).toBe(24);
    expect(fps(59.94)).toBe(59.94 / 2);
  });

  it('computes target bitrate from bits per pixel and clamps to source', () => {
    expect(targetVideoBitrate('avc', 1920, 1080, 30)).toBe(Math.round(1920 * 1080 * 30 * 0.07));
    const r = autoSettings(fakeSource({ vBitrate: 2_000_000 }), allCaps());
    expect(r.settings.video!.bitrate).toBe(2_000_000);
  });

  it('scaleToLongEdge scales by the long edge and rounds down to even', () => {
    expect(scaleToLongEdge(3840, 2160, 1920)).toEqual({ width: 1920, height: 1080 });
    expect(scaleToLongEdge(1000, 500, 1920)).toEqual({ width: 1000, height: 500 });
  });

  it('uses 96 kbps for mono', () => {
    const r = autoSettings(fakeSource({ channels: 1, aBitrate: 192_000 }), allCaps());
    expect(r.settings.audio).toMatchObject({ bitrate: 96000, channels: 1 });
  });

  it('copies aac audio already at or below target', () => {
    const r = autoSettings(fakeSource({ aBitrate: 96_000 }), allCaps());
    expect(r.settings.audio).toMatchObject({ copy: true, bitrate: 96000 });
  });

  it('handles missing video and audio', () => {
    expect(autoSettings(fakeSource({ video: null }), allCaps()).settings.video).toBeNull();
    expect(autoSettings(fakeSource({ audio: null }), allCaps()).settings.audio).toBeNull();
  });

  it('flags small low-bitrate avc/aac mp4 as already optimal', () => {
    const r = autoSettings(fakeSource({ w: 640, h: 360, fps: 30, vBitrate: 400_000, aBitrate: 64_000 }), allCaps());
    expect(r.alreadyOptimal).toBe(true);
    expect(r.settings.video).toMatchObject({ codec: 'avc', width: 640, height: 360 });
    const withCodecs = autoSettings(fakeSource({ w: 640, h: 360, fps: 30, vBitrate: 400_000,
      aBitrate: 64_000, mime: 'video/mp4; codecs="avc1.64001e, mp4a.40.2"' }), allCaps());
    expect(withCodecs.alreadyOptimal).toBe(true);
  });

  it('falls back to hevc with a note when avc is missing', () => {
    const r = autoSettings(fakeSource(), allCaps({ video: { avc: false } }));
    expect(r.settings.video!.codec).toBe('hevc');
    expect(r.settings.container).toBe('mp4');
    expect(r.notes.join(' ')).toContain('H.264');
  });

  it('uses webm and opus when only vp9 is available', () => {
    const caps = allCaps({ video: { avc: false, hevc: false, av1: false } });
    const r = autoSettings(fakeSource(), caps);
    expect(r.settings.container).toBe('webm');
    expect(r.settings.video!.codec).toBe('vp9');
    expect(r.settings.audio!.codec).toBe('opus');
  });

  it('uses opus in mp4 when aac is unavailable and notes compatibility', () => {
    const r = autoSettings(fakeSource({ aCodec: 'opus' }), allCaps({ audio: { aac: false } }));
    expect(r.settings.container).toBe('mp4');
    expect(r.settings.audio!.codec).toBe('opus');
    expect(r.notes.join(' ')).toMatch(/compatib/i);
  });

  it('lists size steps not above the source', () => {
    expect(autoSettings(fakeSource({ w: 1280, h: 720 }), allCaps()).sizeSteps).toEqual([1280, 854]);
    expect(autoSettings(fakeSource(), allCaps()).sizeSteps).toEqual([1920, 1280, 854]);
  });

  it('defaults trim to the full duration', () => {
    expect(autoSettings(fakeSource(), allCaps()).settings.trim).toEqual({ start: 0, end: 20 });
  });
});

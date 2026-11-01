import { describe, expect, it } from 'vitest';
import { needsPreviewProxy } from '../../src/core/previewProxy';
import type { SourceInfo } from '../../src/core/types';

const source: SourceInfo = {
  name: 'clip.mp4',
  sizeBytes: 100,
  durationSec: 2,
  containerMime: 'video/mp4',
  video: {
    codec: 'avc',
    codecString: 'avc1.64001f',
    decodable: true,
    displayWidth: 1920,
    displayHeight: 1080,
    rotation: 0,
    fps: 30,
    bitrate: 1_000_000,
    hdr: false,
  },
  audio: { codec: 'aac', decodable: true, channels: 2, sampleRate: 48000, bitrate: 128_000 },
};

describe('needsPreviewProxy', () => {
  it('keeps 8-bit SDR AAC on the original', () => {
    expect(needsPreviewProxy(source, () => 'probably')).toBe(false);
  });
  it('proxies HDR and 10-bit video when decodable', () => {
    expect(
      needsPreviewProxy({ ...source, video: { ...source.video!, hdr: true } }, () => 'probably'),
    ).toBe(true);
    expect(
      needsPreviewProxy(
        { ...source, video: { ...source.video!, codecString: 'av01.0.12M.10.0.110.09.16.09.0' } },
        () => 'probably',
      ),
    ).toBe(true);
    expect(
      needsPreviewProxy(
        { ...source, video: { ...source.video!, codecString: 'vp09.02.10.10' } },
        () => 'probably',
      ),
    ).toBe(true);
    expect(
      needsPreviewProxy(
        { ...source, video: { ...source.video!, codecString: 'avc1.6e001f' } },
        () => 'probably',
      ),
    ).toBe(true);
  });
  it('proxies decodable audio the element cannot play', () => {
    const dolby = {
      ...source,
      containerMime: 'video/mp4; codecs="avc1.64001f, ec-3"',
      audio: { ...source.audio!, codec: 'eac3' },
    };
    expect(needsPreviewProxy(dolby, () => '')).toBe(true);
    expect(needsPreviewProxy(dolby, () => 'probably')).toBe(false);
    expect(
      needsPreviewProxy({ ...dolby, audio: { ...dolby.audio, decodable: false } }, () => ''),
    ).toBe(false);
  });
  it('does not proxy an undecodable video', () => {
    expect(
      needsPreviewProxy(
        { ...source, video: { ...source.video!, hdr: true, decodable: false } },
        () => '',
      ),
    ).toBe(false);
  });
});

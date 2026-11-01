import { describe, expect, it } from 'vitest';
import type { SourceInfo } from '../../src/core/types';
import { compareByDefault } from '../../src/ui/compare';

const source = (width: number, height: number): SourceInfo => ({
  name: 'clip.mp4',
  sizeBytes: 100,
  durationSec: 2,
  containerMime: 'video/mp4',
  video: {
    codec: 'avc',
    decodable: true,
    displayWidth: width,
    displayHeight: height,
    rotation: 0,
    fps: 30,
    bitrate: 1_000_000,
  },
  audio: null,
});

describe('compareByDefault', () => {
  it('compares up to 1080p on either edge', () => {
    expect(compareByDefault(source(1920, 1080), false)).toBe(true);
    expect(compareByDefault(source(1080, 1920), false)).toBe(true);
  });
  it('starts without comparison above 1080p', () => {
    expect(compareByDefault(source(2560, 1440), false)).toBe(false);
    expect(compareByDefault(source(2160, 3840), false)).toBe(false);
  });
  it('starts without comparison when the preview used a copy', () => {
    expect(compareByDefault(source(1280, 720), true)).toBe(false);
  });
});

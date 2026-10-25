import { describe, expect, it } from 'vitest';
import { dbGain } from '../../src/core/audioProcess';
import { previewGain } from '../../src/ui/previewAudio';

describe('preview audio gain', () => {
  const target = {
    processing: { gainDb: -6, fadeIn: 1, fadeOut: 2 },
    trim: { start: 10, end: 20 },
    channels: 2,
  };

  it('is unity without a target', () => {
    expect(previewGain(null, 0, 5)).toBe(1);
  });

  it('follows export gain and fades on the kept range, in source time', () => {
    expect(previewGain(target, 0, 10)).toBe(0);
    expect(previewGain(target, 0, 10.5)).toBeCloseTo(dbGain(-6) * 0.5, 6);
    expect(previewGain(target, 0, 15)).toBeCloseTo(dbGain(-6), 6);
    expect(previewGain(target, 0, 19)).toBeCloseTo(dbGain(-6) * 0.5, 6);
  });

  it('adds the measured normalization gain to user gain', () => {
    expect(previewGain(target, 4, 15)).toBeCloseTo(dbGain(-2), 6);
  });
});

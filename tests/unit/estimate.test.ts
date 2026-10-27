import { describe, expect, it } from 'vitest';
import { estimateBytes } from '../../src/core/estimate';
import type { Settings } from '../../src/core/types';

const base: Settings = {
  container: 'mp4',
  passthrough: false,
  trim: { start: 0, end: 10 },
  video: { codec: 'avc', width: 1280, height: 720, fps: 30, bitrate: 4_000_000 },
  audio: { codec: 'aac', bitrate: 128_000, channels: 2, copy: false },
};

describe('estimateBytes', () => {
  it('uses source track bitrates for a trimmed copy', () => {
    const source = {
      video: { bitrate: 700_000 },
      audio: { bitrate: 96_000 },
    };
    expect(estimateBytes({ ...base, passthrough: true }, source).mid).toBeCloseTo(
      ((796_000 * 10) / 8) * 1.01,
    );
  });
  it('computes mid with 1% overhead and a 15% band', () => {
    const mid = (((4_000_000 + 128_000) * 10) / 8) * 1.01;
    const e = estimateBytes(base);
    expect(e.mid).toBeCloseTo(mid);
    expect(e.low).toBeCloseTo(mid * 0.85);
    expect(e.high).toBeCloseTo(mid * 1.15);
  });
  it('excludes absent tracks', () => {
    const e = estimateBytes({ ...base, audio: null });
    expect(e.mid).toBeCloseTo(((4_000_000 * 10) / 8) * 1.01);
    expect(estimateBytes({ ...base, video: null, audio: null }).mid).toBe(0);
  });
  it('returns 0 for a zero-length trim', () => {
    expect(estimateBytes({ ...base, trim: { start: 5, end: 5 } })).toEqual({
      low: 0,
      high: 0,
      mid: 0,
    });
  });
  it('uses the duration after cuts', () => {
    expect(estimateBytes({ ...base, cuts: [{ start: 2, end: 4 }] }).mid).toBeCloseTo(
      (((4_000_000 + 128_000) * 8) / 8) * 1.01,
    );
  });
});

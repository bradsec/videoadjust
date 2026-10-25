import { describe, expect, it } from 'vitest';
import { dbGain } from '../../src/core/audioProcess';
import { addedWaveformTime, scaledWaveformPeak, waveformRangePeak } from '../../src/ui/mixWaveform';

describe('audio mix waveform', () => {
  it('scales peaks by track, master and normalization gains before the ceiling', () => {
    expect(scaledWaveformPeak(0.5, 6, { gainDb: -3 }, 0, 10, 2)).toBeCloseTo(0.5 * dbGain(5));
    expect(scaledWaveformPeak(0.8, 12, {}, 5, 10)).toBeGreaterThan(1);
  });

  it('uses the master fade envelope in output time', () => {
    const settings = { fadeIn: 2, fadeOut: 2 };
    expect(scaledWaveformPeak(0.8, 0, settings, 0, 10)).toBe(0);
    expect(scaledWaveformPeak(0.8, 0, settings, 1, 10)).toBeCloseTo(0.4);
    expect(scaledWaveformPeak(0.8, 0, settings, 9, 10)).toBeCloseTo(0.4);
  });

  it('places added audio relative to the kept start and offset', () => {
    const trim = { start: 10, end: 20 };
    expect(addedWaveformTime(11, trim, 2, 3, false)).toBeNull();
    expect(addedWaveformTime(12, trim, 2, 3, false)).toBe(0);
    expect(addedWaveformTime(14, trim, 2, 3, false)).toBe(2);
    expect(addedWaveformTime(15, trim, 2, 3, false)).toBeNull();
  });

  it('repeats short added audio and cuts it at the kept end', () => {
    const trim = { start: 10, end: 20 };
    expect(addedWaveformTime(16, trim, 2, 3, true)).toBe(1);
    expect(addedWaveformTime(20, trim, 2, 3, true)).toBeNull();
    expect(addedWaveformTime(12, trim, 0, 0, true)).toBeNull();
  });

  it('preserves narrow peaks when several bins fit in one pixel, including loop boundaries', () => {
    const peaks = new Float32Array([0.8, 0.1, 0.2, 0.9]);
    expect(waveformRangePeak(peaks, 4, 0, 3)).toBeCloseTo(0.8);
    expect(waveformRangePeak(peaks, 4, 3.5, 4.5)).toBeCloseTo(0.9);
    expect(waveformRangePeak(peaks, 4, 2, 10)).toBeCloseTo(0.9);
  });
});

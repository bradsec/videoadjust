import { describe, expect, it } from 'vitest';
import { peaksFromSamples } from '../../src/ui/waveform';

describe('peaksFromSamples', () => {
  it('returns one peak per bin', () => {
    const peaks = peaksFromSamples([new Float32Array(1000).fill(0.5)], 10);
    expect(peaks).toHaveLength(10);
    expect([...peaks].every((p) => p === 0.5)).toBe(true);
  });

  it('takes the largest absolute value across channels and samples in each bin', () => {
    const left = new Float32Array([0.1, -0.2, 0.1, 0.1]);
    const right = new Float32Array([0, 0, 0.1, -0.9]);
    const peaks = peaksFromSamples([left, right], 2);
    expect(peaks[0]).toBeCloseTo(0.2);
    expect(peaks[1]).toBeCloseTo(0.9);
  });

  it('returns zeros for silence and for no channels', () => {
    expect([...peaksFromSamples([new Float32Array(64)], 4)]).toEqual([0, 0, 0, 0]);
    expect([...peaksFromSamples([], 3)]).toEqual([0, 0, 0]);
  });

  it('clamps to 0..1', () => {
    expect(peaksFromSamples([new Float32Array([-1.5, 0.2])], 2)[0]).toBe(1);
  });

  it('handles fewer samples than bins', () => {
    const peaks = peaksFromSamples([new Float32Array([0.4, 0.8])], 6);
    expect(peaks).toHaveLength(6);
    expect(Math.max(...peaks)).toBeCloseTo(0.8);
    expect(peaks.filter((p) => p > 0)).toHaveLength(2);
  });
});

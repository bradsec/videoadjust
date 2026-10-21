import { describe, expect, it } from 'vitest';
import { clampTrim, MIN_TRIM_SPAN } from '../../src/ui/trimBar';

describe('clampTrim', () => {
  it('keeps at least 0.1 seconds when end crosses start', () => {
    expect(MIN_TRIM_SPAN).toBe(0.1);
    expect(clampTrim({ start: 2, end: 1 }, 5, 'end')).toEqual({ start: 2, end: 2.1 });
  });
  it('keeps at least 0.1 seconds when start crosses end', () => {
    expect(clampTrim({ start: 3, end: 2 }, 5, 'start')).toEqual({ start: 1.9, end: 2 });
  });
  it('clamps negative and over-duration positions', () => {
    expect(clampTrim({ start: -2, end: 3 }, 5, 'start')).toEqual({ start: 0, end: 3 });
    expect(clampTrim({ start: 2, end: 9 }, 5, 'end')).toEqual({ start: 2, end: 5 });
  });
  it('uses the full clip when duration is shorter than the minimum', () => {
    expect(clampTrim({ start: 0.02, end: 0.04 }, 0.05, 'start')).toEqual({ start: 0, end: 0.05 });
  });
  it('keeps end inside the clip when start is dragged past duration', () => {
    expect(clampTrim({ start: 9, end: 4 }, 5, 'start')).toEqual({ start: 3.9, end: 4 });
  });
});

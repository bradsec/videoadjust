import { describe, expect, it } from 'vitest';
import { formatTimelineLabel, parseTimecode, pickTickStep } from '../../src/ui/timelineTicks';

describe('pickTickStep', () => {
  it.each([
    [3, 320, 1],
    [3, 1600, 0.25],
    [10, 320, 5],
    [10, 1600, 0.5],
    [229.5, 320, 60],
    [229.5, 1600, 15],
    [3600, 320, 900],
    [3600, 1600, 300],
    [10800, 320, 3600],
    [10800, 1600, 600],
  ])('picks a readable step for %is at %ipx', (duration, width, major) => {
    const step = pickTickStep(duration, width);
    expect(step.major).toBe(major);
    expect((step.major / duration) * width).toBeGreaterThanOrEqual(80);
    if (step.minor) expect((step.minor / duration) * width).toBeGreaterThanOrEqual(8);
  });
});

describe('formatTimelineLabel', () => {
  it('formats minutes, hours and optional tenths', () => {
    expect(formatTimelineLabel(65, 3599)).toBe('1:05');
    expect(formatTimelineLabel(3600, 3600)).toBe('1:00:00');
    expect(formatTimelineLabel(65.5, 3600, true)).toBe('0:01:05.5');
    expect(formatTimelineLabel(1.5, 10)).toBe('0:01.5');
    expect(formatTimelineLabel(1.5, 10, true)).toBe('0:01.5');
  });
});

describe('parseTimecode', () => {
  it.each([
    ['1:02:03.5', 3723.5],
    ['2:03', 123],
    ['75', 75],
    ['0:00', 0],
  ])('parses %s', (input, seconds) => expect(parseTimecode(input)).toBe(seconds));
  it.each(['1:75', '-1', 'abc', '', ' ', ' 1:02 ', '1:2', '1:02:75', '1:02.25'])(
    'rejects %j',
    (input) => {
      expect(parseTimecode(input)).toBeNull();
    },
  );
});

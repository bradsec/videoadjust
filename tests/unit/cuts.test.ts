import { describe, expect, it } from 'vitest';
import {
  keptDuration,
  keptRanges,
  normalizeCuts,
  outputToSource,
  sourceToOutput,
} from '../../src/core/cuts';

const trim = { start: 5, end: 40 };
const cuts = [
  { start: 10, end: 14 },
  { start: 30, end: 32 },
];

describe('cut sections', () => {
  it('sorts, clamps, merges touching ranges, and drops short or invalid cuts', () => {
    expect(
      normalizeCuts(
        [
          { start: 30, end: 32 },
          { start: 14, end: 16 },
          { start: 10, end: 14 },
          { start: 3, end: 6 },
          { start: 39.95, end: 40 },
          { start: NaN, end: 20 },
        ],
        trim,
      ),
    ).toEqual([
      { start: 5, end: 6 },
      { start: 10, end: 16 },
      { start: 30, end: 32 },
    ]);
  });

  it('limits the list to twenty normalized cuts', () => {
    const many = Array.from({ length: 25 }, (_, n) => ({ start: n, end: n + 0.5 }));
    expect(normalizeCuts(many, { start: 0, end: 30 })).toHaveLength(20);
  });
  it('does not remove the whole trim', () => {
    expect(normalizeCuts([{ start: 0, end: 10 }], { start: 0, end: 10 })).toEqual([]);
  });

  it('returns kept ranges and their total duration', () => {
    expect(keptRanges(trim, cuts)).toEqual([
      { start: 5, end: 10 },
      { start: 14, end: 30 },
      { start: 32, end: 40 },
    ]);
    expect(keptDuration(trim, cuts)).toBe(29);
  });

  it('maps time across two joins in both directions', () => {
    expect(sourceToOutput(5, trim, cuts)).toBe(0);
    expect(sourceToOutput(9, trim, cuts)).toBe(4);
    expect(sourceToOutput(12, trim, cuts)).toBeNull();
    expect(sourceToOutput(14, trim, cuts)).toBe(5);
    expect(sourceToOutput(35, trim, cuts)).toBe(24);
    expect(outputToSource(0, trim, cuts)).toBe(5);
    expect(outputToSource(5, trim, cuts)).toBe(14);
    expect(outputToSource(21, trim, cuts)).toBe(32);
    expect(outputToSource(29, trim, cuts)).toBe(40);
  });
});

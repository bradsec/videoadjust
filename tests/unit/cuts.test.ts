import { describe, expect, it } from 'vitest';
import {
  boundCuts,
  createJoinFade,
  keptDuration,
  keptRanges,
  normalizeCutFade,
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
  it('bounds stored cuts to the source without trimming them', () => {
    expect(
      boundCuts(
        [
          { start: -2, end: 2 },
          { start: 8, end: 12 },
          { start: NaN, end: 5 },
        ],
        10,
      ),
    ).toEqual([
      { start: 0, end: 2 },
      { start: 8, end: 10 },
    ]);
  });
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

describe('join fades', () => {
  const trim = { start: 0, end: 10 };
  const cuts = [{ start: 4, end: 6 }];

  it('dips to zero at each join and back over the fade duration', () => {
    const at = createJoinFade(trim, cuts, 1);
    expect(at(4)).toBe(0);
    expect(at(3.75)).toBeCloseTo(0.5, 6);
    expect(at(4.25)).toBeCloseTo(0.5, 6);
    expect(at(3.5)).toBe(1);
    expect(at(1)).toBe(1);
  });

  it('is constant without cuts or fade, and shortens the fade to fit short parts', () => {
    expect(createJoinFade(trim, [], 1)(5)).toBe(1);
    expect(createJoinFade(trim, cuts, 0)(4)).toBe(1);
    // Kept parts of 0.4 s and 9.4 s: half a fade is at most 0.2 s.
    const short = createJoinFade(trim, [{ start: 0.4, end: 1 }], 1);
    expect(short(0.2)).toBe(1);
    expect(short(0.3)).toBeCloseTo(0.5, 6);
  });

  it('normalizes fade durations to 0 or 0.1 to 1 second', () => {
    expect(normalizeCutFade(undefined)).toBe(0);
    expect(normalizeCutFade(Number.NaN)).toBe(0);
    expect(normalizeCutFade(-1)).toBe(0);
    expect(normalizeCutFade(0.05)).toBe(0.1);
    expect(normalizeCutFade(0.5)).toBe(0.5);
    expect(normalizeCutFade(3)).toBe(1);
  });
});

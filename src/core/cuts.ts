export type Cut = { start: number; end: number };
export type Trim = { start: number; end: number };

const MIN_CUT = 0.1;
const MAX_CUTS = 20;

export function boundCuts(cuts: readonly Cut[] | undefined, duration: number): Cut[] {
  return (cuts ?? [])
    .filter((cut) => Number.isFinite(cut.start) && Number.isFinite(cut.end))
    .map((cut) => ({
      start: Math.max(0, Math.min(duration, cut.start)),
      end: Math.max(0, Math.min(duration, cut.end)),
    }));
}

export function normalizeCuts(cuts: readonly Cut[] | undefined, trim: Trim): Cut[] {
  if (!cuts?.length || !Number.isFinite(trim.start) || !Number.isFinite(trim.end)) return [];
  const sorted = cuts
    .filter((cut) => Number.isFinite(cut.start) && Number.isFinite(cut.end))
    .map((cut) => ({
      start: Math.max(trim.start, Math.min(trim.end, cut.start)),
      end: Math.max(trim.start, Math.min(trim.end, cut.end)),
    }))
    .filter((cut) => cut.end - cut.start >= MIN_CUT - 1e-9)
    .sort((a, b) => a.start - b.start);
  const merged: Cut[] = [];
  for (const cut of sorted) {
    const previous = merged.at(-1);
    if (previous && cut.start <= previous.end) previous.end = Math.max(previous.end, cut.end);
    else if (merged.length < MAX_CUTS) merged.push({ ...cut });
  }
  let removed = merged.reduce((sum, cut) => sum + cut.end - cut.start, 0);
  while (merged.length && trim.end - trim.start - removed < MIN_CUT - 1e-9) {
    const cut = merged.pop()!;
    removed -= cut.end - cut.start;
  }
  return merged;
}

export function keptRanges(trim: Trim, cuts?: readonly Cut[]): Cut[] {
  const ranges: Cut[] = [];
  let start = trim.start;
  for (const cut of normalizeCuts(cuts, trim)) {
    if (cut.start > start) ranges.push({ start, end: cut.start });
    start = cut.end;
  }
  if (start < trim.end) ranges.push({ start, end: trim.end });
  return ranges;
}

export function keptDuration(trim: Trim, cuts?: readonly Cut[]): number {
  return keptRanges(trim, cuts).reduce((sum, range) => sum + range.end - range.start, 0);
}

export function sourceToOutput(time: number, trim: Trim, cuts?: readonly Cut[]): number | null {
  if (!Number.isFinite(time) || time < trim.start || time > trim.end) return null;
  let elapsed = 0;
  for (const range of keptRanges(trim, cuts)) {
    if (time < range.start) return null;
    if (time < range.end) return elapsed + time - range.start;
    elapsed += range.end - range.start;
  }
  return time === trim.end ? elapsed : null;
}

export function outputToSource(time: number, trim: Trim, cuts?: readonly Cut[]): number | null {
  if (!Number.isFinite(time) || time < 0) return null;
  let elapsed = 0;
  for (const range of keptRanges(trim, cuts)) {
    const end = elapsed + range.end - range.start;
    if (time < end) return range.start + time - elapsed;
    elapsed = end;
  }
  return time === elapsed && elapsed > 0 ? trim.end : null;
}

/** What the cut controls edit: the removed ranges and the fade through black at each join. */
export type CutSettings = { cuts: Cut[]; fade: number };

/** Fade length in seconds: 0 for a hard cut, otherwise 0.1 to 1. */
export function normalizeCutFade(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return Math.min(1, Math.max(0.1, value));
}

/**
 * Returns the picture or sound level at an output time: 0 at each join, rising linearly to 1
 * over half the fade on either side. Half a fade never exceeds half the shortest kept part,
 * so neighbouring fades cannot overlap.
 */
export function createJoinFade(
  trim: Trim,
  cuts: readonly Cut[] | undefined,
  fade: number,
): (outputTime: number) => number {
  const ranges = keptRanges(trim, cuts);
  if (ranges.length < 2 || fade <= 0) return () => 1;
  const half = Math.min(fade / 2, ...ranges.map((range) => (range.end - range.start) / 2));
  const joins: number[] = [];
  let elapsed = 0;
  for (const range of ranges.slice(0, -1)) joins.push((elapsed += range.end - range.start));
  return (time) => {
    let level = 1;
    for (const join of joins) level = Math.min(level, Math.abs(time - join) / half);
    return level;
  };
}

export function cutSettings(value: { cuts?: Cut[]; cutFade?: number }): CutSettings {
  return { cuts: value.cuts ?? [], fade: normalizeCutFade(value.cutFade) };
}

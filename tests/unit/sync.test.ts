import { describe, expect, it } from 'vitest';
import { DRIFT_SEC, needsResync } from '../../src/ui/compare';

describe('needsResync', () => {
  it('leaves small drift alone', () => {
    expect(needsResync(1.0, 1.05)).toBe(false);
    expect(needsResync(1.05, 1.0)).toBe(false);
  });
  it('resyncs drift above DRIFT_SEC in either direction', () => {
    expect(DRIFT_SEC).toBe(0.1);
    expect(needsResync(1.0, 1.2)).toBe(true);
    expect(needsResync(1.2, 1.0)).toBe(true);
  });
});

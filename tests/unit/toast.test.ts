import { describe, expect, it } from 'vitest';
import { toastDuration } from '../../src/ui/toast';

describe('toast timing', () => {
  it('keeps confirmations at least 5 s and longer messages long enough to read', () => {
    expect(toastDuration('Saved.', 'success')).toBe(5000);
    expect(toastDuration('x'.repeat(200), 'info')).toBe(12000);
  });
  it('never auto-dismisses errors', () => {
    expect(toastDuration('Could not save.', 'error')).toBeNull();
  });
});

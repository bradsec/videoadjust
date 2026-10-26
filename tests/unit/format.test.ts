import { describe, expect, it } from 'vitest';
import { formatBitrate, formatBytes, formatDuration } from '../../src/ui/format';
import { formatByteRange } from '../../src/ui/progress';

describe('format', () => {
  it('formats bytes in decimal units', () => {
    expect(formatBytes(18_400_000)).toBe('18.4 MB');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1_500)).toBe('1.5 kB');
    expect(formatBytes(2_100_000_000)).toBe('2.1 GB');
  });
  it('formats bitrate', () => {
    expect(formatBitrate(4_350_000)).toBe('4.35 Mbps');
    expect(formatBitrate(128_000)).toBe('128 kbps');
  });
  it('formats duration', () => {
    expect(formatDuration(75.5)).toBe('1:15.5');
    expect(formatDuration(5)).toBe('0:05');
    expect(formatDuration(3725)).toBe('1:02:05');
  });
  it('keeps one tenths digit when asked, so live counters hold their width', () => {
    const fixed = { tenths: true };
    expect(formatDuration(4, fixed)).toBe('0:04.0');
    expect(formatDuration(3.9, fixed)).toBe('0:03.9');
    expect(formatDuration(4.1, fixed)).toBe('0:04.1');
    expect(formatDuration(0, fixed)).toBe('0:00.0');
    expect(formatDuration(75.5, fixed)).toBe('1:15.5');
    expect(formatDuration(3725, fixed)).toBe('1:02:05.0');
    expect(formatDuration(-1, fixed)).toBe('0:00.0');
    const widths = [3.8, 3.9, 4, 4.1].map((t) => formatDuration(t, fixed).length);
    expect(new Set(widths).size).toBe(1);
  });
  it('floors hundredths and keeps two digits for a playhead counter', () => {
    const fixed = { hundredths: true };
    expect(formatDuration(1.0334, fixed)).toBe('0:01.03');
    expect(formatDuration(0, fixed)).toBe('0:00.00');
    expect(formatDuration(3723.456, fixed)).toBe('1:02:03.45');
    expect(
      new Set([0, 1.0334, 1.0667, 59.99, 60].map((t) => formatDuration(t, fixed).length)).size,
    ).toBe(1);
  });
  it('still drops a zero tenth by default', () => {
    expect(formatDuration(4, {})).toBe('0:04');
    expect(formatDuration(4, { tenths: false })).toBe('0:04');
  });
});

describe('formatByteRange', () => {
  it('writes a shared unit once', () => {
    expect(formatByteRange(18e6, 24e6)).toBe('18-24 MB');
    expect(formatByteRange(900e3, 1.2e6)).toBe('900 kB-1.2 MB');
  });
});

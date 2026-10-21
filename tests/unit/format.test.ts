import { describe, expect, it } from 'vitest';
import { formatBitrate, formatBytes, formatDuration } from '../../src/ui/format';

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
});

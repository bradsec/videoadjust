import type { Settings } from './types';

const CONTAINER_OVERHEAD = 1.01;
const LOW_FACTOR = 0.85;
const HIGH_FACTOR = 1.15;

export function estimateBytes(s: Settings): { low: number; high: number; mid: number } {
  const seconds = Math.max(0, s.trim.end - s.trim.start);
  const bps = (s.video?.bitrate ?? 0) + (s.audio?.bitrate ?? 0);
  const mid = (bps * seconds) / 8 * CONTAINER_OVERHEAD;
  return { low: mid * LOW_FACTOR, high: mid * HIGH_FACTOR, mid };
}

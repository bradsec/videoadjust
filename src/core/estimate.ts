import type { Settings, SourceInfo } from './types';

const CONTAINER_OVERHEAD = 1.01;
const LOW_FACTOR = 0.85;
const HIGH_FACTOR = 1.15;

export function estimateBytes(
  s: Settings,
  source?: {
    video?: Pick<NonNullable<SourceInfo['video']>, 'bitrate'> | null;
    audio?: Pick<NonNullable<SourceInfo['audio']>, 'bitrate'> | null;
  },
): { low: number; high: number; mid: number } {
  const seconds = Math.max(0, s.trim.end - s.trim.start);
  const videoBitrate = s.video
    ? s.passthrough
      ? (source?.video?.bitrate ?? s.video.bitrate)
      : s.video.bitrate
    : 0;
  const audioBitrate = s.audio
    ? s.passthrough
      ? (source?.audio?.bitrate ?? s.audio.bitrate)
      : s.audio.bitrate
    : 0;
  const bps = videoBitrate + audioBitrate;
  const mid = ((bps * seconds) / 8) * CONTAINER_OVERHEAD;
  return { low: mid * LOW_FACTOR, high: mid * HIGH_FACTOR, mid };
}

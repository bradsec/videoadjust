import { targetVideoBitrate } from './autoSettings';
import { CONTAINER_OVERHEAD, estimateBytes } from './estimate';
import type { AutoResult, Settings, SourceInfo } from './types';
import { outputSize } from './videoGeometry';

// Encoders can overshoot their requested bitrate; leave 8% headroom after mux overhead.
export const TARGET_SIZE_SAFETY = 0.92;
export const TARGET_FLOOR_RATIO = 0.4;

export function validTargetSize(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0.05 && value <= 4096
    ? value
    : null;
}

function floor(video: NonNullable<Settings['video']>): number {
  return targetVideoBitrate(video.codec, video.width, video.height, video.fps) * TARGET_FLOOR_RATIO;
}

export function targetSizeStatus(
  s: Settings,
  source: SourceInfo,
): { tight: boolean; alreadyUnder: boolean } {
  const target = validTargetSize(s.targetSizeMB);
  return {
    tight: !!target && !s.passthrough && !!s.video && s.video.bitrate < floor(s.video),
    alreadyUnder: !!target && s.passthrough && estimateBytes(s, source).mid <= target * 1e6,
  };
}

/** Apply after source, geometry, codec and trim validation. */
export function applyTargetSize(s: Settings, auto: AutoResult, source: SourceInfo): Settings {
  const target = validTargetSize(s.targetSizeMB);
  if (!target || !s.video || !source.video) return { ...s, targetSizeMB: target };
  if (targetSizeStatus(s, source).alreadyUnder) return s;
  const seconds = Math.max(0.1, s.trim.end - s.trim.start);
  const budget = (target * 1e6 * 8 * TARGET_SIZE_SAFETY) / seconds / CONTAINER_OVERHEAD;
  let video = { ...s.video };
  let audio = s.audio;
  for (const bitrate of [96_000, 64_000]) {
    if (audio && budget - audio.bitrate < floor(video) && audio.bitrate > bitrate)
      audio = { ...audio, bitrate, copy: false };
  }
  const scale = Number.isFinite(s.targetRetryScale)
    ? Math.max(0.000001, Math.min(1, s.targetRetryScale!))
    : 1;
  const bitrate = Math.max(
    1,
    Math.floor(Math.min(budget - (audio?.bitrate ?? 0), source.video.bitrate ?? Infinity) * scale),
  );
  for (const edge of [...auto.sizeSteps].sort((a, b) => b - a)) {
    if (bitrate >= floor(video)) break;
    if (edge >= Math.max(video.width, video.height)) continue;
    video = {
      ...video,
      ...outputSize(
        source.video,
        s.transform?.rotate ?? 0,
        s.transform?.crop ?? 'original',
        edge,
        s.transform?.rect,
        s.fit,
      ),
    };
  }
  return { ...s, targetSizeMB: target, passthrough: false, video: { ...video, bitrate }, audio };
}

export function retryTargetSize(s: Settings, actualBytes: number): Settings {
  if (!s.targetSizeMB || !s.video || actualBytes <= 0) return s;
  return {
    ...s,
    passthrough: false,
    targetRetryScale:
      (s.targetRetryScale ?? 1) *
      Math.min(1, (s.targetSizeMB * 1e6) / actualBytes) *
      TARGET_SIZE_SAFETY,
  };
}

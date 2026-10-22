import type {
  AudioCodecId,
  AutoResult,
  Capabilities,
  Container,
  Settings,
  SourceInfo,
  VideoCodecId,
} from './types';

export const LONG_EDGE_CAP = 1920;
export const SIZE_STEPS = [1920, 1280, 854];
export const BPP: Record<VideoCodecId, number> = { avc: 0.07, hevc: 0.045, av1: 0.04, vp9: 0.05 };
export const AUDIO_STEREO_BPS = 128_000;
export const AUDIO_MONO_BPS = 96_000;

const CODEC_ORDER: VideoCodecId[] = ['avc', 'hevc', 'vp9', 'av1'];
const MAX_FPS_KEPT = 50;

const even = (n: number): number => Math.max(2, Math.floor(n / 2) * 2);

/** Scale so the long edge is at most longEdge (never upscales); both sides end up even. */
export function scaleToLongEdge(
  w: number,
  h: number,
  longEdge: number,
): { width: number; height: number } {
  const scale = Math.min(1, longEdge / Math.max(w, h));
  return { width: even(Math.round(w * scale)), height: even(Math.round(h * scale)) };
}

export function targetVideoBitrate(codec: VideoCodecId, w: number, h: number, fps: number): number {
  return Math.round(w * h * fps * BPP[codec]);
}

export function autoSettings(src: SourceInfo, caps: Capabilities): AutoResult {
  const notes: string[] = [];

  const codec = CODEC_ORDER.find((c) => caps.video[c]) ?? 'avc';
  if (!caps.video[codec]) {
    notes.push('No video encoder was detected in this browser, so export may fail.');
  } else if (codec !== 'avc') {
    notes.push(
      `No H.264 encoder in this browser, so the video uses ${codec === 'hevc' ? 'H.265' : codec.toUpperCase()} instead.`,
    );
  }
  const container: Container = codec === 'vp9' ? 'webm' : 'mp4';
  if (container === 'webm')
    notes.push('The output is a WebM file because this browser can only encode VP9 video.');

  let video: Settings['video'] = null;
  let videoOptimal = true;
  if (src.video) {
    const sv = src.video;
    const { width, height } = scaleToLongEdge(sv.displayWidth, sv.displayHeight, LONG_EDGE_CAP);
    const fps = sv.fps >= MAX_FPS_KEPT ? sv.fps / 2 : sv.fps;
    const target = targetVideoBitrate(codec, width, height, fps);
    const bitrate = sv.bitrate !== null ? Math.min(target, sv.bitrate) : target;
    video = { codec, width, height, fps, bitrate };
    videoOptimal =
      sv.codec === 'avc' &&
      sv.displayWidth <= width &&
      sv.displayHeight <= height &&
      sv.fps < MAX_FPS_KEPT &&
      sv.bitrate !== null &&
      sv.bitrate <= target;
  }

  let audio: Settings['audio'] = null;
  let audioOptimal = true;
  if (src.audio) {
    const sa = src.audio;
    const acodec: AudioCodecId = caps.audio.aac && container === 'mp4' ? 'aac' : 'opus';
    if (acodec === 'opus' && container === 'mp4') {
      notes.push(
        'AAC is not available here, so the audio uses Opus, which has limited player compatibility inside MP4 files.',
      );
    }
    const channels = Math.min(sa.channels, 2);
    const target = channels === 1 ? AUDIO_MONO_BPS : AUDIO_STEREO_BPS;
    const capped = sa.bitrate !== null ? Math.min(target, sa.bitrate) : target;
    const copy =
      acodec === 'aac' && sa.codec === 'aac' && sa.bitrate !== null && sa.bitrate <= target;
    audio = { codec: acodec, bitrate: copy ? (sa.bitrate as number) : capped, channels, copy };
    audioOptimal = sa.codec === 'aac';
  }

  const longEdge = src.video ? Math.max(src.video.displayWidth, src.video.displayHeight) : 0;
  const sizeSteps = SIZE_STEPS.filter((s) => s <= longEdge);

  return {
    settings: {
      container,
      passthrough: false,
      trim: { start: 0, end: src.durationSec },
      keyFrameInterval: null,
      transform: { rotate: 0, flip: false, crop: 'original' },
      metadata: { title: '', strip: false },
      video,
      audio,
    },
    alreadyOptimal:
      videoOptimal &&
      audioOptimal &&
      src.containerMime.split(';', 1)[0]?.trim().toLowerCase() === 'video/mp4' &&
      container === 'mp4',
    sizeSteps,
    notes,
  };
}

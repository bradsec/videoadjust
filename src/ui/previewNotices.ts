import type { SourceInfo } from '../core/types';
import { playbackContainerMime } from './compare';
import { el } from './dom';

const SAMPLE_WIDTH = 32;
const SAMPLE_HEIGHT = 18;
// A video sample this bright shows a picture, so it needs no decoded frame to compare with.
const PICTURE_LEVEL = 48;
// The decoded frame's brightest channel must exceed the video sample's by this much (8-bit) to
// count as a missing picture. A relative margin, not a black level: real Chrome drew the black
// picture at 17 on one run, and dark footage is as dark in both samples.
const MISSING_MARGIN = 32;
// Presented frames must be this far apart in media time to count as separate positions.
const POSITION_GAP = 0.5;
const STRIKES = 2;
// Check up to ten filmstrip positions so a dark opening does not hide a later missing picture.
const MAX_CHECKS = 10;

/** Brightest RGB channel in RGBA pixels. */
export function peakLevel(pixels: Uint8ClampedArray): number {
  let peak = 0;
  for (let i = 0; i < pixels.length; i += 4)
    peak = Math.max(peak, pixels[i]!, pixels[i + 1]!, pixels[i + 2]!);
  return peak;
}

/**
 * Detects a <video> that presents frames but draws them black. Chrome 156 on Linux with NVIDIA
 * does this for 10-bit video while decoding in software. Each dim presented frame is compared
 * with a previously decoded filmstrip frame at the same time, so dark footage stays unflagged.
 * One correct-looking frame does not end the check: the same Chrome draws an occasional frame right.
 */
export function createPictureCheck(opts: {
  sampleVideo: () => Uint8ClampedArray | null;
  sampleReference: (time: number) => Uint8ClampedArray | null;
  onBroken: () => void;
}) {
  let strikes = 0;
  let checks = 0;
  let lastTime = -Infinity;
  let done = false;
  return {
    get done() {
      return done;
    },
    frame(mediaTime: number): void {
      if (done || Math.abs(mediaTime - lastTime) < POSITION_GAP) return;
      const reference = opts.sampleReference(mediaTime);
      if (!reference) return;
      const video = opts.sampleVideo();
      if (!video) return;
      lastTime = mediaTime;
      const level = peakLevel(video);
      if (level < PICTURE_LEVEL && peakLevel(reference) - level >= MISSING_MARGIN) strikes++;
      checks++;
      if (strikes >= STRIKES) {
        done = true;
        opts.onBroken();
      } else if (checks >= MAX_CHECKS) done = true;
    },
    stop() {
      done = true;
    },
  };
}

export function thumbnailAt<T>(frames: T[], duration: number, time: number): T | null {
  if (!frames.length || duration <= 0) return null;
  const index = Math.round((time * frames.length) / duration - 0.5);
  const center = (duration * (index + 0.5)) / frames.length;
  return Math.abs(time - center) <= 0.1 ? (frames[index] ?? null) : null;
}

function samplePixels(source: CanvasImageSource): Uint8ClampedArray | null {
  const canvas = document.createElement('canvas');
  canvas.width = SAMPLE_WIDTH;
  canvas.height = SAMPLE_HEIGHT;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  try {
    context.drawImage(source, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
    return context.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT).data;
  } catch {
    return null;
  }
}

/** True when the preview has no sound because the browser cannot play the audio codec. */
export function previewSoundUnavailable(video: HTMLVideoElement, source: SourceInfo): boolean {
  return !!source.audio && video.canPlayType(playbackContainerMime(source.containerMime)) === '';
}

export function mountPreviewNotices(
  video: HTMLVideoElement,
  source: SourceInfo,
  referenceAt: (time: number) => CanvasImageSource | null,
  onBroken?: () => void,
) {
  const fallback = el(
    'p',
    'note preview-note',
    'This browser cannot play the preview. Trimming still works with the handles and thumbnails. The trim Set buttons require a playable preview.',
  );
  fallback.hidden = true;
  const sound = el(
    'p',
    'note preview-audio-note',
    'Preview has no sound: this browser cannot play the audio. Export converts it.',
  );
  sound.hidden = !previewSoundUnavailable(video, source);
  const picture = el(
    'p',
    'note preview-picture-note',
    "This browser cannot show this video's picture. Export still works.",
  );
  picture.hidden = true;
  let black = false;
  const showPicture = () => {
    picture.hidden = false;
  };
  const blackCheck = createPictureCheck({
    sampleVideo: () => (video.videoWidth ? samplePixels(video) : null),
    sampleReference: (time) => {
      const frame = referenceAt(time);
      return frame ? samplePixels(frame) : null;
    },
    onBroken: () => {
      black = true;
      showPicture();
      onBroken?.();
    },
  });
  const supported = typeof video.requestVideoFrameCallback === 'function';
  let timer: number | undefined;
  let frame: number | undefined;
  const watch = () => {
    if (frame !== undefined) video.cancelVideoFrameCallback(frame);
    frame = video.requestVideoFrameCallback((_now, metadata) => {
      frame = undefined;
      clearTimeout(timer);
      if (!black) picture.hidden = true;
      blackCheck.frame(metadata.mediaTime ?? video.currentTime);
      if (!blackCheck.done && !video.paused) watch();
    });
  };
  // A play or seek that presents no frame within 5 s also means the picture is missing.
  const check = () => {
    if (!supported) return;
    clearTimeout(timer);
    watch();
    timer = window.setTimeout(showPicture, 5000);
  };
  video.addEventListener('play', check);
  video.addEventListener('seeked', check);
  return {
    fallback,
    sound,
    picture,
    proxyPlaying() {
      clearTimeout(timer);
      blackCheck.stop();
      if (frame !== undefined) video.cancelVideoFrameCallback(frame);
      sound.hidden = true;
      picture.hidden = true;
    },
    destroy() {
      clearTimeout(timer);
      blackCheck.stop();
      if (frame !== undefined) video.cancelVideoFrameCallback(frame);
      picture.hidden = true;
      video.removeEventListener('play', check);
      video.removeEventListener('seeked', check);
    },
  };
}

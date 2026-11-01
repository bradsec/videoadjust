import type { SourceInfo } from '../core/types';
import { playbackContainerMime } from './compare';
import { el } from './dom';

const SAMPLE_WIDTH = 32;
const SAMPLE_HEIGHT = 18;
// 8-bit channel level below which a sample counts as black (a transparent sample reads as 0).
const BLACK_LEVEL = 16;
// Presented frames must be this far apart in media time to count as separate positions.
const POSITION_GAP = 0.5;
const STRIKES = 2;
const MAX_CHECKS = 6;

/** Brightest RGB channel in RGBA pixels. */
export function peakLevel(pixels: Uint8ClampedArray): number {
  let peak = 0;
  for (let i = 0; i < pixels.length; i += 4)
    peak = Math.max(peak, pixels[i]!, pixels[i + 1]!, pixels[i + 2]!);
  return peak;
}

/**
 * Detects a <video> that presents frames but draws them black. Chrome 156 on Linux with NVIDIA
 * does this for 4K 10-bit video while decoding in software. Each presented frame is compared
 * with a frame Mediabunny decodes at the same time, so footage that is black stays unflagged.
 */
export function createPictureCheck(opts: {
  sampleVideo: () => Uint8ClampedArray | null;
  sampleDecoded: (time: number) => Promise<Uint8ClampedArray | null>;
  onBroken: () => void;
}) {
  let strikes = 0;
  let checks = 0;
  let lastTime = -Infinity;
  let busy = false;
  let done = false;
  return {
    get done() {
      return done;
    },
    async frame(mediaTime: number): Promise<void> {
      if (done || busy || Math.abs(mediaTime - lastTime) < POSITION_GAP) return;
      const video = opts.sampleVideo();
      if (!video) return;
      lastTime = mediaTime;
      if (peakLevel(video) >= BLACK_LEVEL) {
        done = true;
        return;
      }
      busy = true;
      try {
        const decoded = await opts.sampleDecoded(mediaTime);
        if (done) return;
        if (decoded && peakLevel(decoded) >= BLACK_LEVEL) strikes++;
      } catch (error) {
        console.warn('Could not decode a frame to check the preview picture', error);
      } finally {
        busy = false;
      }
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
  return (
    !!source.audio &&
    !source.audio.decodable &&
    video.canPlayType(playbackContainerMime(source.containerMime)) === ''
  );
}

export function mountPreviewNotices(
  video: HTMLVideoElement,
  source: SourceInfo,
  decodedFrameAt: (time: number) => Promise<CanvasImageSource | null>,
  onBroken: () => void,
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
    sampleDecoded: async (time) => {
      const frame = await decodedFrameAt(time);
      return frame ? samplePixels(frame) : null;
    },
    onBroken: () => {
      black = true;
      showPicture();
      onBroken();
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
      void blackCheck.frame(metadata.mediaTime ?? video.currentTime);
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
    pictureReady() {
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

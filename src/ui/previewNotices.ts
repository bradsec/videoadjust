import type { SourceInfo } from '../core/types';
import { el } from './dom';

export function mountPreviewNotices(video: HTMLVideoElement, source: SourceInfo) {
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
  sound.hidden = !(source.audio?.decodable && video.canPlayType(source.containerMime) === '');
  const picture = el(
    'p',
    'note preview-picture-note',
    "This browser cannot show this video's picture. Export still works.",
  );
  picture.hidden = true;
  let timer: number | undefined;
  let frame: number | undefined;
  const check = () => {
    if (typeof video.requestVideoFrameCallback !== 'function') return;
    clearTimeout(timer);
    if (frame !== undefined) video.cancelVideoFrameCallback(frame);
    frame = video.requestVideoFrameCallback(() => {
      frame = undefined;
      clearTimeout(timer);
      picture.hidden = true;
    });
    timer = window.setTimeout(() => {
      picture.hidden = false;
    }, 5000);
  };
  video.addEventListener('play', check);
  video.addEventListener('seeked', check);
  return {
    fallback,
    sound,
    picture,
    destroy() {
      clearTimeout(timer);
      if (frame !== undefined) video.cancelVideoFrameCallback(frame);
      picture.hidden = true;
      video.removeEventListener('play', check);
      video.removeEventListener('seeked', check);
    },
  };
}

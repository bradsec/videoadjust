import {
  captionAt,
  createCaptionRenderer,
  hasCaptions,
  normalizeCaptions,
  type CaptionSettings,
} from '../core/captions';
import { el } from './dom';

type Size = { width: number; height: number };

/** Draws the caption for the playhead on its own layer, redrawn only when the cue changes. */
export function mountCaptionPreview(video: HTMLVideoElement, frame: HTMLElement) {
  const canvas = el('canvas', 'live-preview-captions');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.hidden = true;
  frame.append(canvas);
  let captions: CaptionSettings | null = null;
  let layerAt: ReturnType<typeof createCaptionRenderer> | null = null;
  let key = '';
  let shownIndex = -2;
  let version = 0;
  let request = 0;

  async function draw(): Promise<void> {
    if (!captions || !layerAt) {
      canvas.hidden = true;
      return;
    }
    const index = captionAt(captions, video.currentTime);
    if (index === shownIndex) return;
    shownIndex = index;
    const current = ++version;
    let layer: OffscreenCanvas | null = null;
    try {
      layer = await layerAt(video.currentTime);
    } catch (error) {
      console.warn('Caption preview failed:', error);
    }
    if (current !== version) return;
    canvas.hidden = !layer;
    if (!layer) return;
    if (canvas.width !== layer.width) canvas.width = layer.width;
    if (canvas.height !== layer.height) canvas.height = layer.height;
    const context = canvas.getContext('2d');
    context?.clearRect(0, 0, canvas.width, canvas.height);
    context?.drawImage(layer, 0, 0);
  }
  // timeupdate fires only about four times a second; follow frames while playing.
  const tick = () => {
    void draw();
    request = video.paused ? 0 : requestAnimationFrame(tick);
  };
  const onPlay = () => {
    cancelAnimationFrame(request);
    tick();
  };
  const onTime = () => void draw();
  video.addEventListener('play', onPlay);
  video.addEventListener('seeked', onTime);
  video.addEventListener('timeupdate', onTime);

  return {
    update(value: CaptionSettings | undefined, output: Size) {
      const next = hasCaptions(value) ? normalizeCaptions(value) : null;
      const nextKey = next ? JSON.stringify([next, output.width, output.height]) : '';
      if (nextKey === key) return;
      key = nextKey;
      captions = next;
      shownIndex = -2;
      version++;
      layerAt = next ? createCaptionRenderer(output.width, output.height, next) : null;
      void draw();
    },
    destroy() {
      cancelAnimationFrame(request);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('seeked', onTime);
      video.removeEventListener('timeupdate', onTime);
      canvas.remove();
    },
  };
}

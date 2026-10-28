import {
  captionAt,
  createCaptionRenderer,
  hasCaptions,
  normalizeCaptions,
  type CaptionSettings,
} from '../core/captions';
import { createJoinFade, normalizeCutFade, sourceToOutput, type Cut } from '../core/cuts';
import { el } from './dom';

type Size = { width: number; height: number };
export type CutFadeTarget = { trim: { start: number; end: number }; cuts?: Cut[]; fade?: number };

/**
 * Time-driven preview layers: the caption for the playhead, redrawn only when the cue changes,
 * and the fade through black at cuts, which sits below overlays and captions as in export.
 */
export function mountCaptionPreview(video: HTMLVideoElement, frame: HTMLElement) {
  const canvas = el('canvas', 'live-preview-captions');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.hidden = true;
  frame.append(canvas);
  const shade = el('div', 'live-preview-fade');
  shade.hidden = true;
  frame.insertBefore(shade, frame.querySelector('.live-preview-overlay'));
  let levelAt: ((time: number) => number) | null = null;
  let fadeKey = '';
  let captions: CaptionSettings | null = null;
  let layerAt: ReturnType<typeof createCaptionRenderer> | null = null;
  let key = '';
  let shownIndex = -2;
  let version = 0;
  let request = 0;

  function drawShade(): void {
    const level = levelAt ? levelAt(video.currentTime) : 1;
    shade.hidden = level >= 1;
    shade.style.opacity = String(1 - level);
  }

  async function draw(): Promise<void> {
    drawShade();
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
    update(value: CaptionSettings | undefined, output: Size, cut?: CutFadeTarget) {
      const fade = normalizeCutFade(cut?.fade);
      const nextFade = cut && fade && cut.cuts?.length ? JSON.stringify([cut, fade]) : '';
      if (nextFade !== fadeKey) {
        fadeKey = nextFade;
        const at = nextFade ? createJoinFade(cut!.trim, cut!.cuts, fade) : null;
        // Inside a cut, before playback skips past it, the picture stays black.
        levelAt = at && ((time) => at(sourceToOutput(time, cut!.trim, cut!.cuts) ?? 0));
        drawShade();
      }
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
      shade.remove();
    },
  };
}

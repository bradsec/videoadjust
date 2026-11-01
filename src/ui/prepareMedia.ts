import { CanvasSink, type Input } from 'mediabunny';
import { exportCurrentFrame } from '../core/frameExport';
import { gifDimensions } from '../core/gifExport';
import type { OverlayAssets } from '../core/overlays';
import type { SourceInfo } from '../core/types';
import type { AppState } from './controller';
import { mountLivePreview } from './livePreview';
import { thumbnailAt } from './previewNotices';

export const thumbnails = async (
  state: Extract<AppState, { kind: 'prepare' }>,
  count: number,
  width: number,
  height: number,
  signal: AbortSignal,
): Promise<HTMLCanvasElement[]> => {
  const track = await state.input.getPrimaryVideoTrack();
  if (!track || signal.aborted) return [];
  const sink = new CanvasSink(track, { width, height, fit: 'cover' });
  const timestamps = Array.from(
    { length: count },
    (_, i) => (state.source.durationSec * (i + 0.5)) / count,
  );
  const canvases: HTMLCanvasElement[] = [];
  const frames = sink.canvasesAtTimestamps(timestamps);
  const stop = () => {
    void frames
      .return()
      .catch((error: unknown) => console.warn('Could not stop video thumbnails', error));
  };
  signal.addEventListener('abort', stop, { once: true });
  try {
    for await (const frame of frames) {
      if (signal.aborted) break;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      if (frame) {
        canvas.getContext('2d')?.drawImage(frame.canvas, 0, 0);
      }
      canvases.push(canvas);
    }
  } finally {
    signal.removeEventListener('abort', stop);
  }
  return canvases;
};

export function previewThumbnails(state: Extract<AppState, { kind: 'prepare' }>) {
  let frames: HTMLCanvasElement[] = [];
  return {
    referenceAt: (time: number) => thumbnailAt(frames, state.source.durationSec, time),
    thumbnails: async (count: number, width: number, height: number, signal: AbortSignal) => {
      const next = await thumbnails(state, count, width, height, signal);
      if (!signal.aborted) frames = next;
      return next;
    },
  };
}

export function frameOutput(state: Extract<AppState, { kind: 'prepare' }>) {
  return state.tool === 'gif' && state.gifSettings
    ? gifDimensions(state.gifSettings, state.source, state.settings.transform, state.settings.fit)
    : state.settings.video;
}

export async function exportOriginalFrame(
  input: Input,
  source: NonNullable<SourceInfo['video']>,
  settings: Parameters<typeof exportCurrentFrame>[2],
  assets: OverlayAssets,
  mime: 'image/png' | 'image/jpeg',
): Promise<Blob> {
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error('The source has no video track.');
  const frame = await new CanvasSink(track, {
    width: source.displayWidth,
    height: source.displayHeight,
    fit: 'contain',
  }).getCanvas(settings.timestamp);
  if (!frame) throw new Error('No source frame is available at this time.');
  return exportCurrentFrame(
    frame.canvas,
    { width: source.displayWidth, height: source.displayHeight },
    settings,
    assets,
    mime,
  );
}

export const onSpace = (
  event: KeyboardEvent,
  video: HTMLVideoElement,
  editorsHost: HTMLElement,
  livePreview: ReturnType<typeof mountLivePreview> | undefined,
) => {
  if (
    event.key !== ' ' ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.shiftKey ||
    event.repeat ||
    event.defaultPrevented ||
    !livePreview ||
    editorsHost.querySelector(':scope > :not([hidden])') ||
    document.querySelector('dialog[open], [aria-modal="true"]:not([hidden])')
  )
    return;
  const controls =
    'input, textarea, select, button, a[href], summary, [contenteditable], video, [role="button"], [role="slider"], [role="switch"], [role="checkbox"], [role="radio"], [role="tab"], [role="menuitem"], [role="option"], [role="combobox"], [role="textbox"], [role="separator"]';
  if (
    (event.target instanceof Element && event.target.closest(controls)) ||
    (document.activeElement instanceof Element && document.activeElement.closest(controls))
  )
    return;
  event.preventDefault();
  if (!livePreview.togglePlayback()) {
    if (video.paused)
      void video.play().catch((error: unknown) => console.warn('Could not play preview', error));
    else video.pause();
  }
};

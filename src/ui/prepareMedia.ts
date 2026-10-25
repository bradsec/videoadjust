import { CanvasSink } from 'mediabunny';
import type { AppState } from './controller';
import { mountLivePreview } from './livePreview';

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

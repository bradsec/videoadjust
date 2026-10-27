import { CanvasSink, type Input } from 'mediabunny';
import { scaleToLongEdge } from './autoSettings';
import { fitGeometry, paintFit, type FitSettings } from './fit';
import { renderOverlayLayer, type OverlayAssets } from './overlays';
import { createStyleRenderer, hasStyleEffects } from './style';
import type { Settings, SourceInfo, Rotation, CropRect } from './types';
import { normalizeCrop, rotatedSize } from './videoGeometry';

export interface GifSettings {
  trim: { start: number; end: number };
  /** Long edge in pixels, so a portrait frame is not larger than a landscape one. */
  size: number;
  fps: number;
  loop: 'forever' | 'once' | 'boomerang';
  colors: 256 | 128 | 64;
  compression: GifCompression;
}

export type GifCompression = 'quality' | 'balanced' | 'small';

// Per-channel difference from the shown image below which a pixel is left unchanged.
// 'quality' writes full frames: an exact match leaves camera noise scattered through the
// transparency, which made files larger than full frames.
export const GIF_CHANGE_THRESHOLD: Record<GifCompression, number | null> = {
  quality: null,
  balanced: 6,
  small: 16,
};

export const GIF_PIXEL_BUDGET = 80_000_000;
export const GIF_MAX_SECONDS = 30;
// 30 seconds at the highest offered rate, 20 fps.
export const GIF_MAX_FRAMES = 600;
const RATES = [5, 10, 15, 20];

export function gifFrameRates(sourceFps = 20): number[] {
  return [...new Set(RATES.map((n) => Math.min(n, sourceFps)))];
}

export function gifUnavailable(source: SourceInfo): string | null {
  if (!source.video) return 'This file has no video track';
  if (!source.video.decodable) return 'This browser cannot decode the video in this file';
  return null;
}

export function gifFrameSize(
  source: SourceInfo,
  transform?: Settings['transform'],
): { width: number; height: number } {
  const video = source.video;
  if (!video) throw new Error('GIF export needs a video track.');
  const rotated = rotatedSize(video.displayWidth, video.displayHeight, transform?.rotate ?? 0);
  return (
    normalizeCrop(rotated.width, rotated.height, transform?.crop ?? 'original', transform?.rect) ??
    rotated
  );
}

const longEdge = (n: number) => Math.max(2, Math.floor(n / 2) * 2);

export function autoGifSettings(source: SourceInfo): GifSettings | null {
  if (gifUnavailable(source) || !source.video) return null;
  return {
    trim: { start: 0, end: source.durationSec },
    size: longEdge(Math.min(320, Math.max(source.video.displayWidth, source.video.displayHeight))),
    fps: Math.min(10, source.video.fps),
    loop: 'forever',
    colors: 128,
    compression: 'balanced',
  };
}

export function validateGifSettings(
  value: GifSettings,
  auto: GifSettings,
  source: SourceInfo,
  transform?: Settings['transform'],
): GifSettings {
  const sourceFps = source.video?.fps ?? auto.fps;
  const size =
    Number.isInteger(value.size) && value.size >= 2 && value.size <= 640 && value.size % 2 === 0
      ? value.size
      : auto.size;
  const frame = gifFrameSize(source, transform);
  const fps =
    Number.isFinite(value.fps) && value.fps > 0 && gifFrameRates(sourceFps).includes(value.fps)
      ? value.fps
      : auto.fps;
  return {
    trim: value.trim,
    size: longEdge(Math.min(size, Math.max(frame.width, frame.height))),
    fps: Math.min(fps, sourceFps),
    loop: value.loop === 'once' || value.loop === 'boomerang' ? value.loop : 'forever',
    colors: value.colors === 64 || value.colors === 128 ? value.colors : 256,
    compression:
      value.compression === 'quality' || value.compression === 'small'
        ? value.compression
        : 'balanced',
  };
}

export function gifDimensions(
  settings: GifSettings,
  source: SourceInfo,
  transform?: Settings['transform'],
  fit?: FitSettings,
): { width: number; height: number } {
  const frame = gifFrameSize(source, transform);
  if (fit?.aspect && fit.aspect !== 'off') {
    const { width, height } = fitGeometry(frame, fit.aspect, settings.size);
    return { width, height };
  }
  return scaleToLongEdge(frame.width, frame.height, settings.size);
}

export function gifCropGeometry(
  rotated: { width: number; height: number },
  crop: CropRect,
  targetWidth: number,
): { width: number; height: number; crop: CropRect } {
  const scale = targetWidth / crop.width;
  const width = Math.max(1, Math.round(rotated.width * scale));
  const height = Math.max(1, Math.round(rotated.height * scale));
  const scaleX = width / rotated.width;
  const scaleY = height / rotated.height;
  return {
    width,
    height,
    crop: {
      left: crop.left * scaleX,
      top: crop.top * scaleY,
      width: crop.width * scaleX,
      height: crop.height * scaleY,
    },
  };
}

export function gifFramePlan(
  trim: GifSettings['trim'],
  fps: number,
  loop: GifSettings['loop'] = 'forever',
): { timestamps: number[]; delaysMs: number[] } {
  const duration = trim.end - trim.start;
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(fps) || fps <= 0)
    return { timestamps: [], delaysMs: [] };
  const count = gifFrameCount(trim, fps);
  const timestamps: number[] = [];
  const delaysMs: number[] = [];
  let previousCentiseconds = 0;
  for (let i = 0; i < count; i++) {
    timestamps.push(trim.start + i / fps);
    const boundary = Math.min(duration, (i + 1) / fps);
    const centiseconds = Math.round(boundary * 100);
    delaysMs.push((centiseconds - previousCentiseconds) * 10);
    previousCentiseconds = centiseconds;
  }
  if (loop === 'boomerang')
    for (let i = count - 2; i > 0; i--) {
      timestamps.push(timestamps[i]!);
      delaysMs.push(delaysMs[i]!);
    }
  return { timestamps, delaysMs };
}

export function gifFrameCount(
  trim: GifSettings['trim'],
  fps: number,
  loop: GifSettings['loop'] = 'forever',
): number {
  const duration = trim.end - trim.start;
  const count =
    Number.isFinite(duration) && duration > 0 && Number.isFinite(fps) && fps > 0
      ? Math.ceil(duration * fps - 1e-9)
      : 0;
  return loop === 'boomerang' && count > 1 ? count * 2 - 2 : count;
}

export function gifPlaybackSeconds(
  trim: GifSettings['trim'],
  fps: number,
  loop: GifSettings['loop'] = 'forever',
): number {
  const duration = trim.end - trim.start;
  const count = gifFrameCount(trim, fps);
  if (!count) return 0;
  const total = Math.round(duration * 100);
  if (loop !== 'boomerang' || count === 1) return total / 100;
  const first = Math.round(Math.min(duration, 1 / fps) * 100);
  const last = total - Math.round(Math.min(duration, (count - 1) / fps) * 100);
  return (2 * total - first - last) / 100;
}

export function gifBudgetError(
  width: number,
  height: number,
  frames: number,
  seconds = 0,
): string | null {
  if (seconds > GIF_MAX_SECONDS + 1e-6)
    return `GIFs can be at most ${GIF_MAX_SECONDS} seconds. Shorten the trim so the finished GIF is ${GIF_MAX_SECONDS} seconds or less.`;
  if (frames > 0 && frames <= GIF_MAX_FRAMES && width * height * frames <= GIF_PIXEL_BUDGET)
    return null;
  return `GIF export allows at most ${GIF_MAX_FRAMES} frames and ${GIF_PIXEL_BUDGET.toLocaleString()} total pixels. Trim shorter, lower the frame rate, or choose a smaller size.`;
}

export function gifOutputName(name: string): string {
  const dot = name.lastIndexOf('.');
  return `${dot > 0 ? name.slice(0, dot) : name}-animated.gif`;
}

export async function exportGif(
  input: Input,
  source: SourceInfo,
  settings: GifSettings,
  transform: Settings['transform'],
  signal: AbortSignal,
  onProgress: (progress: number) => void,
  overlays?: Settings['overlays'],
  assets: OverlayAssets = {},
  style?: Settings['style'],
  fit?: FitSettings,
): Promise<{ bytes: Uint8Array; styleDropped: boolean }> {
  const video = source.video;
  const track = await input.getPrimaryVideoTrack();
  if (!video || !track) throw new Error('GIF export needs a video track.');
  const { width, height } = gifDimensions(settings, source, transform, fit);
  const fitted =
    fit?.aspect && fit.aspect !== 'off'
      ? fitGeometry(gifFrameSize(source, transform), fit.aspect, settings.size)
      : null;
  const contentWidth = fitted?.content.width ?? width;
  const contentHeight = fitted?.content.height ?? height;
  const count = gifFrameCount(settings.trim, settings.fps, settings.loop);
  const budget = gifBudgetError(
    width,
    height,
    count,
    gifPlaybackSeconds(settings.trim, settings.fps, settings.loop),
  );
  if (budget) throw new Error(budget);
  const overlayLayer = await renderOverlayLayer(width, height, overlays, assets);
  const { timestamps, delaysMs } = gifFramePlan(settings.trim, settings.fps, settings.loop);
  const rotated = rotatedSize(video.displayWidth, video.displayHeight, transform?.rotate ?? 0);
  const crop = normalizeCrop(
    rotated.width,
    rotated.height,
    transform?.crop ?? 'original',
    transform?.rect,
  );
  const rotation = ((video.rotation + (transform?.rotate ?? 0)) % 360) as Rotation;
  const geometry = crop ? gifCropGeometry(rotated, crop, contentWidth) : null;
  const target = geometry
    ? new OffscreenCanvas(contentWidth, contentHeight).getContext('2d')
    : null;
  const fittedCanvas = fitted ? new OffscreenCanvas(width, height) : null;
  const fittedContext = fittedCanvas?.getContext('2d');
  let styleCanvas: OffscreenCanvas | undefined;
  let styleRenderer: ReturnType<typeof createStyleRenderer> | undefined;
  let styleUnavailable = false;
  if ((geometry && !target) || (fitted && !fittedContext))
    throw new Error('Canvas is unavailable for GIF export.');
  const sink = new CanvasSink(track, {
    width: geometry?.width ?? contentWidth,
    height: geometry?.height ?? contentHeight,
    fit: 'fill',
    rotation,
    flip: transform?.flip ?? false,
    poolSize: 2,
  });
  const worker = new Worker(new URL('./gifWorker.ts', import.meta.url), { type: 'module' });
  let workerError: Error | undefined;
  let rejectPending: ((error: Error) => void) | undefined;
  const onError = (event: ErrorEvent) => {
    workerError = new Error(event.message);
    rejectPending?.(workerError);
  };
  worker.addEventListener('error', onError);
  const abort = () => worker.terminate();
  signal.addEventListener('abort', abort, { once: true });
  const send = (message: object, transfer: Transferable[] = []) =>
    new Promise<Uint8Array | undefined>((resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException('GIF export canceled', 'AbortError'));
        return;
      }
      if (workerError) {
        reject(workerError);
        return;
      }
      const onMessage = (
        event: MessageEvent<{ type: string; bytes?: Uint8Array; message?: string }>,
      ) => {
        cleanup();
        if (event.data.type === 'error') reject(new Error(event.data.message));
        else resolve(event.data.bytes);
      };
      const onAbort = () => {
        cleanup();
        reject(new DOMException('GIF export canceled', 'AbortError'));
      };
      const cleanup = () => {
        worker.removeEventListener('message', onMessage);
        signal.removeEventListener('abort', onAbort);
        rejectPending = undefined;
      };
      rejectPending = (error) => {
        cleanup();
        reject(error);
      };
      worker.addEventListener('message', onMessage);
      signal.addEventListener('abort', onAbort, { once: true });
      worker.postMessage(message, transfer);
    });
  const frames = sink.canvasesAtTimestamps(timestamps);
  try {
    let i = 0;
    for await (const frame of frames) {
      if (signal.aborted) throw new DOMException('GIF export canceled', 'AbortError');
      if (!frame) throw new Error('A video frame could not be decoded for GIF export.');
      // Crop from a canvas: WebKit ignores VideoFrame source rectangles (see frameCrop.ts).
      if (geometry && target) {
        const rect = geometry.crop;
        target.clearRect(0, 0, contentWidth, contentHeight);
        target.drawImage(
          frame.canvas,
          rect.left,
          rect.top,
          rect.width,
          rect.height,
          0,
          0,
          contentWidth,
          contentHeight,
        );
      }
      const context = (target ?? frame.canvas.getContext('2d')) as
        CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
      if (!context) throw new Error('Canvas is unavailable for GIF export.');
      if (hasStyleEffects(style) && style && !styleUnavailable) {
        try {
          styleCanvas ??= new OffscreenCanvas(contentWidth, contentHeight);
          styleRenderer ??= createStyleRenderer(styleCanvas);
          styleRenderer.draw(context.canvas, contentWidth, contentHeight, timestamps[i], style);
          context.drawImage(styleCanvas, 0, 0);
        } catch (error) {
          styleUnavailable = true;
          console.warn('Video Style disabled during GIF export:', error);
        }
      }
      if (fitted && fittedContext) paintFit(fittedContext, context.canvas, fitted, fit!);
      const outputContext = fittedContext ?? context;
      if (overlayLayer) outputContext.drawImage(overlayLayer, 0, 0);
      // Copy pixels before the iterator can reuse its pooled canvas.
      const rgba = outputContext.getImageData(0, 0, width, height).data;
      await send(
        {
          type: 'frame',
          rgba,
          width,
          height,
          colors: settings.colors,
          threshold: GIF_CHANGE_THRESHOLD[settings.compression],
          delay: delaysMs[i],
          repeat: settings.loop === 'once' ? -1 : 0,
        },
        [rgba.buffer],
      );
      i++;
      onProgress(i / timestamps.length);
    }
    const bytes = await send({ type: 'finish' });
    if (!bytes) throw new Error('GIF encoder returned no bytes.');
    return { bytes, styleDropped: styleUnavailable };
  } finally {
    styleRenderer?.destroy();
    await frames.return();
    worker.terminate();
    worker.removeEventListener('error', onError);
    signal.removeEventListener('abort', abort);
  }
}

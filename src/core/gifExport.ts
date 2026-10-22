import { CanvasSink, type Input } from 'mediabunny';
import type { Settings, SourceInfo, Rotation, CropRect } from './types';
import { normalizeCrop, rotatedSize } from './videoGeometry';

export interface GifSettings {
  trim: { start: number; end: number };
  width: number;
  fps: number;
  loop: 'forever' | 'once';
  colors: 256 | 128 | 64;
}

export const GIF_PIXEL_BUDGET = 80_000_000;
export const GIF_MAX_FRAMES = 300;
const RATES = [5, 10, 15, 20];

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

export function autoGifSettings(source: SourceInfo): GifSettings | null {
  if (gifUnavailable(source) || !source.video) return null;
  return {
    trim: { start: 0, end: source.durationSec },
    width: Math.max(2, Math.floor(Math.min(480, source.video.displayWidth) / 2) * 2),
    fps: Math.min(10, source.video.fps),
    loop: 'forever',
    colors: 256,
  };
}

export function validateGifSettings(
  value: GifSettings,
  auto: GifSettings,
  source: SourceInfo,
  transform?: Settings['transform'],
): GifSettings {
  const sourceFps = source.video?.fps ?? auto.fps;
  const width =
    Number.isInteger(value.width) && value.width >= 2 && value.width <= 640 && value.width % 2 === 0
      ? value.width
      : auto.width;
  const fps =
    Number.isFinite(value.fps) && value.fps > 0 && RATES.includes(value.fps) ? value.fps : auto.fps;
  return {
    trim: value.trim,
    width: Math.max(2, Math.floor(Math.min(width, gifFrameSize(source, transform).width) / 2) * 2),
    fps: Math.min(fps, sourceFps),
    loop: value.loop === 'once' ? 'once' : 'forever',
    colors: value.colors === 64 || value.colors === 128 ? value.colors : 256,
  };
}

export function gifDimensions(
  settings: GifSettings,
  source: SourceInfo,
  transform?: Settings['transform'],
): { width: number; height: number } {
  const frame = gifFrameSize(source, transform);
  const width = Math.max(2, Math.floor(Math.min(settings.width, frame.width) / 2) * 2);
  const height = Math.max(2, Math.floor((frame.height * width) / frame.width / 2) * 2);
  return { width, height };
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
  return { timestamps, delaysMs };
}

export function gifFrameCount(trim: GifSettings['trim'], fps: number): number {
  const duration = trim.end - trim.start;
  return Number.isFinite(duration) && duration > 0 && Number.isFinite(fps) && fps > 0
    ? Math.ceil(duration * fps - 1e-9)
    : 0;
}

export function gifBudgetError(width: number, height: number, frames: number): string | null {
  if (frames > 0 && frames <= GIF_MAX_FRAMES && width * height * frames <= GIF_PIXEL_BUDGET)
    return null;
  return `GIF export allows at most ${GIF_MAX_FRAMES} frames and ${GIF_PIXEL_BUDGET.toLocaleString()} total pixels. Trim shorter, lower the frame rate, or choose a smaller width.`;
}

export function gifOutputName(name: string): string {
  const dot = name.lastIndexOf('.');
  return `${dot > 0 ? name.slice(0, dot) : name}-gif.gif`;
}

export async function exportGif(
  input: Input,
  source: SourceInfo,
  settings: GifSettings,
  transform: Settings['transform'],
  signal: AbortSignal,
  onProgress: (progress: number) => void,
): Promise<Uint8Array> {
  const video = source.video;
  const track = await input.getPrimaryVideoTrack();
  if (!video || !track) throw new Error('GIF export needs a video track.');
  const { width, height } = gifDimensions(settings, source, transform);
  const count = gifFrameCount(settings.trim, settings.fps);
  const budget = gifBudgetError(width, height, count);
  if (budget) throw new Error(budget);
  const { timestamps, delaysMs } = gifFramePlan(settings.trim, settings.fps);
  const rotated = rotatedSize(video.displayWidth, video.displayHeight, transform?.rotate ?? 0);
  const crop = normalizeCrop(
    rotated.width,
    rotated.height,
    transform?.crop ?? 'original',
    transform?.rect,
  );
  const rotation = ((video.rotation + (transform?.rotate ?? 0)) % 360) as Rotation;
  const geometry = crop ? gifCropGeometry(rotated, crop, width) : null;
  const target = geometry ? new OffscreenCanvas(width, height).getContext('2d') : null;
  if (geometry && !target) throw new Error('Canvas is unavailable for GIF export.');
  const sink = new CanvasSink(track, {
    width: geometry?.width ?? width,
    height: geometry?.height ?? height,
    fit: 'fill',
    rotation,
    flip: transform?.flip ?? false,
    poolSize: 2,
  });
  const worker = new Worker(new URL('./gifWorker.ts', import.meta.url), { type: 'module' });
  const abort = () => worker.terminate();
  signal.addEventListener('abort', abort, { once: true });
  const send = (message: object, transfer: Transferable[] = []) =>
    new Promise<Uint8Array | undefined>((resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException('GIF export canceled', 'AbortError'));
        return;
      }
      const onMessage = (
        event: MessageEvent<{ type: string; bytes?: Uint8Array; message?: string }>,
      ) => {
        cleanup();
        if (event.data.type === 'error') reject(new Error(event.data.message));
        else resolve(event.data.bytes);
      };
      const onError = (event: ErrorEvent) => {
        cleanup();
        reject(new Error(event.message));
      };
      const onAbort = () => {
        cleanup();
        reject(new DOMException('GIF export canceled', 'AbortError'));
      };
      const cleanup = () => {
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
        signal.removeEventListener('abort', onAbort);
      };
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);
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
        target.clearRect(0, 0, width, height);
        target.drawImage(
          frame.canvas,
          rect.left,
          rect.top,
          rect.width,
          rect.height,
          0,
          0,
          width,
          height,
        );
      }
      const context = (target ?? frame.canvas.getContext('2d')) as
        CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
      if (!context) throw new Error('Canvas is unavailable for GIF export.');
      // Copy pixels before the iterator can reuse its pooled canvas.
      const rgba = context.getImageData(0, 0, width, height).data;
      await send(
        {
          type: 'frame',
          rgba,
          width,
          height,
          colors: settings.colors,
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
    return bytes;
  } finally {
    await frames.return();
    worker.terminate();
    signal.removeEventListener('abort', abort);
  }
}

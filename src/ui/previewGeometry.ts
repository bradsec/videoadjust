import type { Settings } from '../core/types';
import { fitContent } from '../core/fit';
import { normalizeCrop, rotatedSize } from '../core/videoGeometry';

type Size = { width: number; height: number };

/** Whether the export would visibly differ from the source in resolution or frame rate. */
export function previewFidelity(
  settings: { output: Size; fps?: number | null; sourceFps?: number | null },
  frame: Size,
): { scaled: boolean; reduced: boolean } {
  return {
    scaled: settings.output.width * settings.output.height < frame.width * frame.height,
    reduced: !!settings.fps && !!settings.sourceFps && settings.fps < settings.sourceFps - 0.01,
  };
}

export function previewRenderSize(output: Size, display: Size, dpr: number): Size {
  const scale = Math.min(
    1,
    (display.width * dpr) / output.width,
    (display.height * dpr) / output.height,
  );
  return {
    width: Math.max(1, Math.min(output.width, Math.floor(output.width * scale))),
    height: Math.max(1, Math.min(output.height, Math.floor(output.height * scale))),
  };
}

export function previewFitFrame(
  source: Size,
  transform: Settings['transform'],
  fit: Settings['fit'],
  output: Size,
) {
  if (!fit || fit.aspect === 'off') return null;
  const rotated = rotatedSize(source.width, source.height, transform?.rotate ?? 0);
  const frame =
    normalizeCrop(rotated.width, rotated.height, transform?.crop ?? 'original', transform?.rect) ??
    rotated;
  return fitContent(frame, output);
}

export function previewFitDisplay(output: Size, container: Size) {
  const scale = Math.min(container.width / output.width, container.height / output.height);
  const width = output.width * scale;
  const height = output.height * scale;
  return {
    width,
    height,
    left: (container.width - width) / 2,
    top: (container.height - height) / 2,
  };
}

export function livePreviewGeometry(
  source: Size,
  transform: Settings['transform'],
  container: Size,
) {
  if (
    ![source.width, source.height, container.width, container.height].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  )
    return null;
  const rotate = transform?.rotate ?? 0;
  const rotated = rotatedSize(source.width, source.height, rotate);
  const crop = normalizeCrop(
    rotated.width,
    rotated.height,
    transform?.crop ?? 'original',
    transform?.rect,
  );
  const frame = crop ?? { left: 0, top: 0, ...rotated };
  const scale = Math.min(container.width / frame.width, container.height / frame.height);
  const width = frame.width * scale;
  const height = frame.height * scale;
  return {
    crop,
    width,
    height,
    left: (container.width - width) / 2,
    top: (container.height - height) / 2,
    videoWidth: source.width * scale,
    videoHeight: source.height * scale,
    // CSS applies these right to left: centre the source, rotate, then flip in output space.
    transform: `translate(${(rotated.width / 2 - frame.left) * scale}px, ${(rotated.height / 2 - frame.top) * scale}px) scaleX(${transform?.flip ? -1 : 1}) rotate(${rotate}deg) translate(-50%, -50%)`,
  };
}

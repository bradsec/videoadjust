import { renderOverlayLayer, type OverlayAssets } from './overlays';
import { createStyleRenderer, hasStyleEffects } from './style';
import type { Settings } from './types';
import { normalizeCrop, rotatedSize } from './videoGeometry';

type Size = { width: number; height: number };

export function drawPreparedFrame(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  input: CanvasImageSource,
  source: Size,
  output: Size,
  transform: Settings['transform'],
): void {
  const rotate = transform?.rotate ?? 0;
  const rotated = rotatedSize(source.width, source.height, rotate);
  const frame = normalizeCrop(
    rotated.width,
    rotated.height,
    transform?.crop ?? 'original',
    transform?.rect,
  ) ?? { left: 0, top: 0, ...rotated };
  context.setTransform(
    output.width / frame.width,
    0,
    0,
    output.height / frame.height,
    (-frame.left * output.width) / frame.width,
    (-frame.top * output.height) / frame.height,
  );
  context.clearRect(frame.left, frame.top, frame.width, frame.height);
  context.translate(rotated.width / 2, rotated.height / 2);
  context.scale(transform?.flip ? -1 : 1, 1);
  context.rotate((rotate * Math.PI) / 180);
  context.drawImage(input, -source.width / 2, -source.height / 2, source.width, source.height);
  context.setTransform(1, 0, 0, 1, 0, 0);
}

export async function exportCurrentFrame(
  input: HTMLVideoElement,
  source: Size,
  settings: {
    output: Size;
    timestamp: number;
    transform?: Settings['transform'];
    style?: Settings['style'];
    overlays?: Settings['overlays'];
  },
  assets: OverlayAssets = {},
  mime: 'image/png' | 'image/jpeg' = 'image/png',
): Promise<Blob> {
  const { width, height } = settings.output;
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable for saving a frame.');
  // Capture before waiting for fonts or image assets, so playback cannot change the chosen frame.
  drawPreparedFrame(context, input, source, settings.output, settings.transform);
  let renderer: ReturnType<typeof createStyleRenderer> | undefined;
  try {
    if (hasStyleEffects(settings.style) && settings.style) {
      const styled = new OffscreenCanvas(width, height);
      renderer = createStyleRenderer(styled);
      renderer.draw(canvas, width, height, settings.timestamp, settings.style);
      context.drawImage(styled, 0, 0);
    }
    const layer = await renderOverlayLayer(width, height, settings.overlays, assets);
    if (layer) context.drawImage(layer, 0, 0);
    return await canvas.convertToBlob({ type: mime, quality: 0.92 });
  } finally {
    renderer?.destroy();
  }
}

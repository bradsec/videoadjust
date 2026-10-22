import {
  registerVideoSampleTransformer,
  VideoSample,
  type VideoSampleTransformationDescription,
} from 'mediabunny';

// WebKit ignores the source rectangle when drawImage reads a VideoFrame, so Mediabunny's
// canvas crop squeezes the whole frame into the crop size. This transformer rotates and flips
// the whole frame onto a canvas first, then crops from that canvas, which WebKit honours.
// Mediabunny wraps a returned canvas in a new VideoFrame, so both canvases can be reused.
const canvases = new Map<string, OffscreenCanvasRenderingContext2D>();

function context2d(width: number, height: number): OffscreenCanvasRenderingContext2D | null {
  const key = `${width}x${height}`;
  let context = canvases.get(key);
  if (!context) {
    if (canvases.size >= 4) canvases.clear();
    context = new OffscreenCanvas(width, height).getContext('2d') ?? undefined;
    if (!context) return null;
    canvases.set(key, context);
  }
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, width, height);
  context.imageSmoothingQuality = 'high';
  return context;
}

export function cropViaCanvas(
  sample: VideoSample,
  d: VideoSampleTransformationDescription,
): VideoSample | null {
  const width = sample.squarePixelWidth;
  const height = sample.squarePixelHeight;
  const [rotatedWidth, rotatedHeight] = d.rotation % 180 === 0 ? [width, height] : [height, width];
  const crop = d.crop;
  if (
    crop.left === 0 &&
    crop.top === 0 &&
    crop.width >= rotatedWidth &&
    crop.height >= rotatedHeight
  )
    return null;
  const oriented = context2d(rotatedWidth, rotatedHeight);
  if (!oriented) return null;
  oriented.translate(rotatedWidth / 2, rotatedHeight / 2);
  if (d.flip) oriented.scale(-1, 1);
  oriented.rotate((d.rotation * Math.PI) / 180);
  oriented.drawImage(sample.toCanvasImageSource(), -width / 2, -height / 2, width, height);

  const target = context2d(d.width, d.height);
  if (!target) return null;
  if (d.alpha === 'discard') {
    target.fillStyle = 'black';
    target.fillRect(0, 0, d.width, d.height);
  }
  const scale =
    d.fit === 'contain'
      ? Math.min(d.width / crop.width, d.height / crop.height)
      : Math.max(d.width / crop.width, d.height / crop.height);
  const [drawWidth, drawHeight] =
    d.fit === 'fill' ? [d.width, d.height] : [crop.width * scale, crop.height * scale];
  target.drawImage(
    oriented.canvas,
    crop.left,
    crop.top,
    crop.width,
    crop.height,
    (d.width - drawWidth) / 2,
    (d.height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
  return new VideoSample(target.canvas, { timestamp: sample.timestamp, duration: sample.duration });
}

export function registerFrameCrop(): void {
  registerVideoSampleTransformer(cropViaCanvas);
}

export type FitAspect = 'off' | '9:16' | '1:1' | '4:5' | '16:9';
export type FitSettings = {
  aspect: FitAspect;
  background: 'blur' | 'black' | 'color';
  color: string;
};
export const DEFAULT_FIT: FitSettings = { aspect: 'off', background: 'blur', color: '#ffffff' };

type Size = { width: number; height: number };
export type FitGeometry = Size & {
  content: { left: number; top: number; width: number; height: number };
};
const RATIOS: Record<Exclude<FitAspect, 'off'>, number> = {
  '9:16': 9 / 16,
  '1:1': 1,
  '4:5': 4 / 5,
  '16:9': 16 / 9,
};
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
const floorEven = (n: number) => Math.max(2, Math.floor(n / 2) * 2);
const blurCanvases = new WeakMap<
  CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  OffscreenCanvas
>();

export function normalizeFit(value?: Partial<FitSettings>): FitSettings {
  return {
    aspect:
      value?.aspect &&
      (value.aspect === 'off' || Object.prototype.hasOwnProperty.call(RATIOS, value.aspect))
        ? value.aspect
        : 'off',
    background:
      value?.background === 'black' || value?.background === 'color' ? value.background : 'blur',
    color:
      typeof value?.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(value.color)
        ? value.color.toLowerCase()
        : DEFAULT_FIT.color,
  };
}

export function fitGeometry(frame: Size, aspect: FitAspect, longEdge: number): FitGeometry {
  const edge = Math.min(longEdge, Math.max(frame.width, frame.height));
  const ratio = aspect === 'off' ? frame.width / frame.height : RATIOS[aspect];
  const width = ratio >= 1 ? floorEven(edge) : even(floorEven(edge) * ratio);
  const height = ratio >= 1 ? even(floorEven(edge) / ratio) : floorEven(edge);
  return fitContent(frame, { width, height });
}

export function fitContent(frame: Size, output: Size): FitGeometry {
  const { width, height } = output;
  const scale = Math.min(1, width / frame.width, height / frame.height);
  const contentWidth = Math.min(width, floorEven(frame.width), even(frame.width * scale));
  const contentHeight = Math.min(height, floorEven(frame.height), even(frame.height * scale));
  return {
    width,
    height,
    content: {
      left: Math.floor((width - contentWidth) / 2),
      top: Math.floor((height - contentHeight) / 2),
      width: contentWidth,
      height: contentHeight,
    },
  };
}

export function paintFit(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  frame: CanvasImageSource,
  geometry: FitGeometry,
  fit: FitSettings,
): void {
  const { width, height, content } = geometry;
  context.save();
  if (fit.background === 'blur') {
    let small = blurCanvases.get(context);
    if (!small) {
      small = new OffscreenCanvas(1, 1);
      blurCanvases.set(context, small);
    }
    const smallScale = 48 / Math.max(width, height);
    const smallWidth = Math.max(1, Math.round(width * smallScale));
    const smallHeight = Math.max(1, Math.round(height * smallScale));
    if (small.width !== smallWidth) small.width = smallWidth;
    if (small.height !== smallHeight) small.height = smallHeight;
    const smallContext = small.getContext('2d');
    if (!smallContext) throw new Error('Canvas is unavailable for Fit blur.');
    smallContext.imageSmoothingEnabled = true;
    smallContext.imageSmoothingQuality = 'high';
    smallContext.fillStyle = '#000000';
    smallContext.fillRect(0, 0, smallWidth, smallHeight);
    const scale = Math.max(smallWidth / content.width, smallHeight / content.height);
    const backWidth = content.width * scale;
    const backHeight = content.height * scale;
    smallContext.drawImage(
      frame,
      (smallWidth - backWidth) / 2,
      (smallHeight - backHeight) / 2,
      backWidth,
      backHeight,
    );
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(small, 0, 0, width, height);
    context.fillStyle = 'rgba(0, 0, 0, 0.15)';
    context.fillRect(0, 0, width, height);
  } else {
    context.fillStyle = fit.background === 'black' ? '#000000' : fit.color;
    context.fillRect(0, 0, width, height);
  }
  context.drawImage(frame, content.left, content.top, content.width, content.height);
  context.restore();
}

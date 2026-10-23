import { customFontFamily, customFontId, isCustomFont, loadCustomFont } from './customFonts';
import { overlayFontSources } from './overlayFonts';

export const overlayFonts = ['Inter', 'Anton', 'Merriweather', 'JetBrains Mono', 'Caveat'] as const;
export const overlayAnchors = [
  'top-left',
  'top-center',
  'top-right',
  'center-left',
  'center',
  'center-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
] as const;
export type BundledFont = (typeof overlayFonts)[number];
/** A bundled family, or `custom:<id>` for a font the user saved in this browser. */
export type OverlayFont = BundledFont | `custom:${string}`;
export type OverlayAnchor = (typeof overlayAnchors)[number];
export type OverlayPosition = { x: number; y: number };
interface OverlayPlacement {
  enabled: boolean;
  anchor: OverlayAnchor;
  margin: number;
  position: OverlayPosition | null;
  opacity: number;
}
export interface TextOverlay extends OverlayPlacement {
  content: string;
  font: OverlayFont;
  weight: 400 | 700;
  color: string;
  fontSize: number;
  boxWidth: number;
  maxHeight: number;
  autoFit: boolean;
  align: 'left' | 'center' | 'right';
  legibility: 'none' | 'outline' | 'shadow' | 'box';
  legibilityColor: string;
  legibilityOpacity: number;
}
export interface ImageOverlay extends OverlayPlacement {
  scale: number;
}
export interface Overlays {
  text: TextOverlay;
  image: ImageOverlay;
}
export interface OverlayAssets {
  image?: ImageBitmap;
}
export interface OverlayBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface OverlayLayouts {
  text?: OverlayBounds;
  image?: OverlayBounds;
}
type DrawingContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function defaultOverlays(): Overlays {
  return {
    text: {
      enabled: false,
      content: '',
      font: 'Inter',
      weight: 700,
      color: '#ffffff',
      fontSize: 0.06,
      boxWidth: 0.8,
      maxHeight: 0.4,
      autoFit: true,
      align: 'center',
      legibility: 'outline',
      legibilityColor: '#000000',
      legibilityOpacity: 0.8,
      anchor: 'bottom-center',
      margin: 0.04,
      position: null,
      opacity: 1,
    },
    image: {
      enabled: false,
      scale: 0.25,
      anchor: 'top-right',
      margin: 0.04,
      position: null,
      opacity: 1,
    },
  };
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}
function number(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;
}
function choice<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return values.includes(value as T) ? (value as T) : fallback;
}
function color(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[\da-f]{6}$/i.test(value) ? value : fallback;
}
function placement(value: Record<string, unknown>, fallback: OverlayPlacement): OverlayPlacement {
  const position = record(value.position);
  return {
    enabled: value.enabled === true,
    anchor: choice(value.anchor, overlayAnchors, fallback.anchor),
    margin: number(value.margin, fallback.margin, 0, 0.45),
    opacity: number(value.opacity, fallback.opacity, 0, 1),
    position:
      typeof position.x === 'number' &&
      Number.isFinite(position.x) &&
      typeof position.y === 'number' &&
      Number.isFinite(position.y)
        ? { x: number(position.x, 0, 0, 1), y: number(position.y, 0, 0, 1) }
        : null,
  };
}
export function normalizeOverlays(value: unknown): Overlays {
  const defaults = defaultOverlays();
  const input = record(value);
  const text = record(input.text);
  const image = record(input.image);
  const font: OverlayFont =
    typeof text.font === 'string' && /^custom:[0-9a-f]{32}$/.test(text.font)
      ? (text.font as OverlayFont)
      : choice(text.font, overlayFonts, 'Inter');
  return {
    text: {
      ...placement(text, defaults.text),
      content: typeof text.content === 'string' ? text.content.slice(0, 500) : '',
      font,
      weight:
        font !== 'Anton' && text.weight === 700
          ? 700
          : text.weight === 400 || font === 'Anton'
            ? 400
            : defaults.text.weight,
      color: color(text.color, defaults.text.color),
      fontSize: number(text.fontSize, defaults.text.fontSize, 0.01, 0.5),
      boxWidth: number(text.boxWidth, defaults.text.boxWidth, 0.05, 1),
      maxHeight: number(text.maxHeight, defaults.text.maxHeight, 0.05, 1),
      autoFit: typeof text.autoFit === 'boolean' ? text.autoFit : defaults.text.autoFit,
      align: choice(text.align, ['left', 'center', 'right'], defaults.text.align),
      legibility: choice(
        text.legibility,
        ['none', 'outline', 'shadow', 'box'],
        defaults.text.legibility,
      ),
      legibilityColor: color(text.legibilityColor, defaults.text.legibilityColor),
      legibilityOpacity: number(text.legibilityOpacity, defaults.text.legibilityOpacity, 0, 1),
    },
    image: {
      ...placement(image, defaults.image),
      scale: number(image.scale, defaults.image.scale, 0.01, 1),
    },
  };
}

export function hasOverlays(overlays: Overlays): boolean {
  return (
    (overlays.text.enabled && overlays.text.content.trim().length > 0) || overlays.image.enabled
  );
}

export function positionOverlay(
  frameWidth: number,
  frameHeight: number,
  width: number,
  height: number,
  overlay: OverlayPlacement,
): OverlayBounds {
  const availableX = Math.max(0, frameWidth - width);
  const availableY = Math.max(0, frameHeight - height);
  const marginX = Math.min(availableX / 2, frameWidth * overlay.margin);
  const marginY = Math.min(availableY / 2, frameHeight * overlay.margin);
  const x = overlay.position
    ? overlay.position.x * frameWidth
    : overlay.anchor.endsWith('left')
      ? marginX
      : overlay.anchor.endsWith('right')
        ? availableX - marginX
        : availableX / 2;
  const y = overlay.position
    ? overlay.position.y * frameHeight
    : overlay.anchor.startsWith('top')
      ? marginY
      : overlay.anchor.startsWith('bottom')
        ? availableY - marginY
        : availableY / 2;
  return {
    x: Math.max(0, Math.min(availableX, x)),
    y: Math.max(0, Math.min(availableY, y)),
    width,
    height,
  };
}

export function wrapOverlayText(
  text: string,
  maxWidth: number,
  measure: (text: string) => number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = '';
    for (const word of paragraph.trim().split(/\s+/)) {
      if (!word) continue;
      const joined = line ? `${line} ${word}` : word;
      if (measure(joined) <= maxWidth) {
        line = joined;
        continue;
      }
      if (line) {
        lines.push(line);
        line = '';
      }
      for (const character of word) {
        if (line && measure(line + character) > maxWidth) {
          lines.push(line);
          line = '';
        }
        line += character;
      }
    }
    lines.push(line);
  }
  return lines;
}

export interface TextOverlayLayout extends OverlayBounds {
  lines: string[];
  fontSize: number;
  lineHeight: number;
  padding: number;
}
function fontStyle(text: TextOverlay, size: number): string {
  const family = isCustomFont(text.font) ? customFontFamily(customFontId(text.font)) : text.font;
  return `${text.font === 'Anton' ? 400 : text.weight} ${size}px "${family}"`;
}
export function layoutOverlayText(
  ctx: Pick<DrawingContext, 'font' | 'measureText'>,
  width: number,
  height: number,
  text: TextOverlay,
): TextOverlayLayout {
  const boxWidth = width * Math.min(text.boxWidth, 1 - 2 * text.margin);
  const maxHeight = height * Math.min(text.maxHeight, 1 - 2 * text.margin);
  function measure(size: number) {
    ctx.font = fontStyle(text, size);
    const padding = size * 0.2;
    const lines = wrapOverlayText(
      text.content,
      Math.max(0, boxWidth - padding * 2),
      (value) => ctx.measureText(value).width,
    );
    return {
      lines,
      padding,
      fontSize: size,
      lineHeight: size * 1.2,
      height: lines.length * size * 1.2 + padding * 2,
    };
  }
  let layout = measure(height * text.fontSize);
  if (text.autoFit) {
    let low = 0;
    let high = layout.fontSize;
    for (let i = 0; i < 24; i++) {
      const candidate = measure((low + high) / 2);
      const fits =
        candidate.height <= maxHeight &&
        candidate.lines.every(
          (line) => ctx.measureText(line).width <= boxWidth - candidate.padding * 2,
        );
      if (fits) low = candidate.fontSize;
      else high = candidate.fontSize;
    }
    layout = measure(low);
  }
  return { ...positionOverlay(width, height, boxWidth, layout.height, text), ...layout };
}

export function drawOverlays(
  ctx: DrawingContext,
  width: number,
  height: number,
  overlays: Overlays,
  assets: OverlayAssets = {},
): OverlayLayouts {
  const bounds: OverlayLayouts = {};
  ctx.save();
  try {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (overlays.image.enabled && assets.image) {
      const image = assets.image;
      const scale = Math.min((width * overlays.image.scale) / image.width, height / image.height);
      bounds.image = positionOverlay(
        width,
        height,
        image.width * scale,
        image.height * scale,
        overlays.image,
      );
      ctx.globalAlpha = overlays.image.opacity;
      ctx.drawImage(image, bounds.image.x, bounds.image.y, bounds.image.width, bounds.image.height);
    }
    const text = overlays.text;
    if (text.enabled && text.content.trim()) {
      const layout = layoutOverlayText(ctx, width, height, text);
      bounds.text = layout;
      ctx.font = fontStyle(text, layout.fontSize);
      ctx.textAlign = text.align;
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      const x =
        text.align === 'left'
          ? layout.x + layout.padding
          : text.align === 'right'
            ? layout.x + layout.width - layout.padding
            : layout.x + layout.width / 2;
      if (text.legibility === 'box') {
        ctx.globalAlpha = text.opacity * text.legibilityOpacity;
        ctx.fillStyle = text.legibilityColor;
        ctx.fillRect(layout.x, layout.y, layout.width, layout.height);
      }
      const legibilityColor = `${text.legibilityColor}${Math.round(text.legibilityOpacity * 255)
        .toString(16)
        .padStart(2, '0')}`;
      ctx.globalAlpha = text.opacity;
      ctx.fillStyle = text.color;
      ctx.strokeStyle = legibilityColor;
      ctx.lineWidth = layout.fontSize * 0.09;
      if (text.legibility === 'shadow') {
        ctx.shadowColor = legibilityColor;
        ctx.shadowBlur = layout.fontSize * 0.14;
        ctx.shadowOffsetX = layout.fontSize * 0.06;
        ctx.shadowOffsetY = layout.fontSize * 0.06;
      }
      layout.lines.forEach((line, index) => {
        const y = layout.y + layout.padding + layout.lineHeight * (index + 0.5);
        if (text.legibility === 'outline') ctx.strokeText(line, x, y);
        ctx.fillText(line, x, y);
      });
    }
  } finally {
    ctx.restore();
  }
  return bounds;
}

const fontLoads = new Map<string, Promise<void>>();

/** Loads the bundled font face the text overlay needs; canvas text falls back silently otherwise. */
export function ensureOverlayFonts(overlays: Overlays): Promise<void> {
  if (!overlays.text.enabled || !overlays.text.content.trim()) return Promise.resolve();
  const { font } = overlays.text;
  if (isCustomFont(font)) return loadCustomFont(customFontId(font));
  const weight = font === 'Anton' ? 400 : overlays.text.weight;
  const key = `${weight} ${font}`;
  let load = fontLoads.get(key);
  if (!load) {
    const face = new FontFace(font, `url("${overlayFontSources[font][weight]}")`, {
      weight: String(weight),
    });
    load = face.load().then(
      (loaded) => {
        document.fonts.add(loaded);
      },
      (error: unknown) => {
        fontLoads.delete(key);
        throw error;
      },
    );
    fontLoads.set(key, load);
  }
  return load;
}

/**
 * Draws the overlays once onto a transparent layer of the output size. Exports composite this
 * layer onto every frame, so text layout and image scaling run once, not per frame.
 */
export async function renderOverlayLayer(
  width: number,
  height: number,
  overlays: Overlays | undefined,
  assets: OverlayAssets = {},
): Promise<OffscreenCanvas | null> {
  if (!overlays || !hasOverlays(overlays)) return null;
  await ensureOverlayFonts(overlays);
  const layer = new OffscreenCanvas(width, height);
  const context = layer.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable for overlays.');
  drawOverlays(context, width, height, overlays, assets);
  return layer;
}

export async function decodeOverlayImage(file: Blob, rasterWidth = 4096): Promise<ImageBitmap> {
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(file.type)) {
    throw new Error('Choose a PNG, JPEG, WebP or SVG image.');
  }
  if (file.type !== 'image/svg+xml') return createImageBitmap(file);
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight)
      throw new Error('The SVG has no usable dimensions.');
    const scale = Math.min(
      Math.max(1, rasterWidth) / image.naturalWidth,
      8192 / image.naturalHeight,
    );
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not create an image canvas.');
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await createImageBitmap(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}

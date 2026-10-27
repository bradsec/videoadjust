import { defaultOverlays, drawOverlays, ensureOverlayFonts, type Overlays } from './overlays';

export type Caption = { start: number; end: number; text: string };
export type CaptionSettings = {
  cues: Caption[];
  size: 'small' | 'medium' | 'large';
  position: 'bottom' | 'top';
  background: 'outline' | 'box';
};
export const DEFAULT_CAPTIONS: CaptionSettings = {
  cues: [],
  size: 'medium',
  position: 'bottom',
  background: 'outline',
};
export const MAX_CAPTIONS = 2000;
const MAX_TEXT = 500;
// Font size as a fraction of the output's short edge, so portrait captions are not oversized.
const SIZES = { small: 0.045, medium: 0.06, large: 0.08 };

function oneOf<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return values.includes(value as T) ? (value as T) : fallback;
}

export function normalizeCaptions(value?: {
  [K in keyof CaptionSettings]?: unknown;
}): CaptionSettings {
  const cues = (Array.isArray(value?.cues) ? (value.cues as Partial<Caption>[]) : [])
    .filter(
      (cue): cue is Caption =>
        Number.isFinite(cue?.start) &&
        Number.isFinite(cue?.end) &&
        cue.start! >= 0 &&
        cue.end! > cue.start! &&
        typeof cue.text === 'string' &&
        cue.text.trim().length > 0,
    )
    .map((cue) => ({ start: cue.start, end: cue.end, text: cue.text.slice(0, MAX_TEXT) }))
    .sort((a, b) => a.start - b.start)
    .slice(0, MAX_CAPTIONS);
  return {
    cues,
    size: oneOf(value?.size, ['small', 'medium', 'large'], DEFAULT_CAPTIONS.size),
    position: oneOf(value?.position, ['bottom', 'top'], DEFAULT_CAPTIONS.position),
    background: oneOf(value?.background, ['outline', 'box'], DEFAULT_CAPTIONS.background),
  };
}

export function hasCaptions(value?: Partial<CaptionSettings>): boolean {
  return !!value?.cues?.length;
}

/** Index of the cue shown at a source time, or -1. Later cues win where cues overlap. */
export function captionAt(value: CaptionSettings, time: number): number {
  for (let i = value.cues.length - 1; i >= 0; i--) {
    const cue = value.cues[i]!;
    if (time >= cue.start && time < cue.end) return i;
  }
  return -1;
}

const TIME = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;

function seconds(value: string): number | null {
  const match = TIME.exec(value.trim());
  if (!match) return null;
  const [, h, m, s, ms] = match;
  return Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s) + Number(ms!.padEnd(3, '0')) / 1000;
}

/** Reads SRT or WebVTT text. Styling tags are removed; cue settings and notes are ignored. */
export function parseSubtitles(text: string): Caption[] {
  const cues: Caption[] = [];
  for (const block of text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)) {
    const lines = block.split('\n');
    const at = lines.findIndex((line) => line.includes('-->'));
    if (at < 0) continue;
    const [from, to] = lines[at]!.split('-->');
    const start = seconds(from ?? '');
    const end = seconds((to ?? '').trim().split(/\s+/)[0] ?? '');
    const body = lines
      .slice(at + 1)
      .join('\n')
      .replace(/<[^>]*>/g, '')
      .trim();
    if (start !== null && end !== null && end > start && body)
      cues.push({ start, end, text: body });
  }
  return cues;
}

export function captionOverlays(
  value: CaptionSettings,
  text: string,
  width: number,
  height: number,
): Overlays {
  const overlays = defaultOverlays();
  overlays.text = {
    ...overlays.text,
    enabled: true,
    content: text,
    fontSize: (SIZES[value.size] * Math.min(width, height)) / height,
    boxWidth: 0.9,
    maxHeight: 0.3,
    anchor: value.position === 'top' ? 'top-center' : 'bottom-center',
    margin: 0.05,
    legibility: value.background,
    legibilityOpacity: value.background === 'box' ? 0.6 : 0.8,
  };
  return overlays;
}

/**
 * Renders caption layers at one output size. Cues play in order, so a small cache keeps each
 * layer for the frames that show it without holding a canvas per cue.
 */
export function createCaptionRenderer(width: number, height: number, value: CaptionSettings) {
  const cache = new Map<number, OffscreenCanvas>();
  return async function layerAt(time: number): Promise<OffscreenCanvas | null> {
    const index = captionAt(value, time);
    if (index < 0) return null;
    let layer = cache.get(index);
    if (!layer) {
      const overlays = captionOverlays(value, value.cues[index]!.text, width, height);
      await ensureOverlayFonts(overlays);
      layer = new OffscreenCanvas(width, height);
      const context = layer.getContext('2d');
      if (!context) throw new Error('Canvas is unavailable for captions.');
      drawOverlays(context, width, height, overlays);
      if (cache.size >= 4) cache.delete(cache.keys().next().value!);
      cache.set(index, layer);
    }
    return layer;
  };
}

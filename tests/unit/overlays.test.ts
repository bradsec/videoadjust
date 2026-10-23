import { describe, expect, it } from 'vitest';
import { CUSTOM_FONT_MAX_BYTES, customFontError } from '../../src/core/customFonts';
import {
  defaultOverlays,
  hasOverlays,
  layoutOverlayText,
  normalizeOverlays,
  positionOverlay,
  wrapOverlayText,
  type TextOverlay,
} from '../../src/core/overlays';

// Every character is half the font size wide, so text widths are easy to predict.
function fakeContext() {
  let size = 10;
  return {
    get font() {
      return `${size}px`;
    },
    set font(value: string) {
      size = Number(/([\d.]+)px/.exec(value)![1]);
    },
    measureText: (text: string) => ({ width: text.length * size * 0.5 }) as TextMetrics,
  };
}

function text(over: Partial<TextOverlay> = {}): TextOverlay {
  return { ...defaultOverlays().text, enabled: true, content: 'Hello', ...over };
}

describe('overlay placement', () => {
  const placement = { ...defaultOverlays().image, margin: 0.1 };

  it('anchors to corners and centres with a margin of the frame size', () => {
    expect(positionOverlay(1000, 500, 100, 50, { ...placement, anchor: 'top-left' })).toEqual({
      x: 100,
      y: 50,
      width: 100,
      height: 50,
    });
    expect(
      positionOverlay(1000, 500, 100, 50, { ...placement, anchor: 'bottom-right' }),
    ).toMatchObject({ x: 800, y: 400 });
    expect(positionOverlay(1000, 500, 100, 50, { ...placement, anchor: 'center' })).toMatchObject({
      x: 450,
      y: 225,
    });
  });

  it('uses a dragged position as a fraction of the frame and keeps it inside', () => {
    const moved = { ...placement, position: { x: 0.5, y: 0.5 } };
    expect(positionOverlay(1000, 500, 100, 50, moved)).toMatchObject({ x: 500, y: 250 });
    const outside = { ...placement, position: { x: 1, y: 1 } };
    expect(positionOverlay(1000, 500, 100, 50, outside)).toMatchObject({ x: 900, y: 450 });
  });

  it('keeps the same relative position at any output size', () => {
    const a = positionOverlay(1920, 1080, 192, 108, { ...placement, anchor: 'bottom-center' });
    const b = positionOverlay(640, 360, 64, 36, { ...placement, anchor: 'bottom-center' });
    expect(a.x / 1920).toBeCloseTo(b.x / 640);
    expect(a.y / 1080).toBeCloseTo(b.y / 360);
  });
});

describe('overlay text', () => {
  it('wraps words to the width, keeps line breaks, and splits words longer than a line', () => {
    const measure = (value: string) => value.length;
    expect(wrapOverlayText('one two three', 7, measure)).toEqual(['one two', 'three']);
    expect(wrapOverlayText('a\nb', 10, measure)).toEqual(['a', 'b']);
    expect(wrapOverlayText('abcdefghij', 4, measure)).toEqual(['abcd', 'efgh', 'ij']);
  });

  it('sizes text relative to frame height so it looks the same at every export size', () => {
    const big = layoutOverlayText(fakeContext(), 1920, 1080, text({ autoFit: false }));
    const small = layoutOverlayText(fakeContext(), 640, 360, text({ autoFit: false }));
    expect(big.fontSize / 1080).toBeCloseTo(small.fontSize / 360);
  });

  it('auto fit shrinks long text to fit the box height, and leaves short text alone', () => {
    const long = text({ content: 'word '.repeat(120), fontSize: 0.2, maxHeight: 0.3 });
    const fitted = layoutOverlayText(fakeContext(), 1000, 1000, long);
    expect(fitted.height).toBeLessThanOrEqual(300 + 1e-6);
    expect(fitted.fontSize).toBeLessThan(200);
    const unfitted = layoutOverlayText(fakeContext(), 1000, 1000, { ...long, autoFit: false });
    expect(unfitted.fontSize).toBe(200);
    const short = layoutOverlayText(fakeContext(), 1000, 1000, text({ fontSize: 0.05 }));
    expect(short.fontSize).toBeCloseTo(50, 0);
  });
});

describe('overlay settings', () => {
  it('clamps numbers, allowlists fonts and colours, caps text length and drops bad positions', () => {
    const value = normalizeOverlays({
      text: {
        enabled: true,
        content: 'x'.repeat(900),
        font: 'Comic Sans',
        color: 'red',
        opacity: 5,
        fontSize: -1,
        position: { x: 'a', y: 0 },
      },
      image: { enabled: true, scale: 9, position: { x: 2, y: -1 } },
    });
    expect(value.text.content).toHaveLength(500);
    expect(value.text.font).toBe('Inter');
    expect(value.text.color).toBe('#ffffff');
    expect(value.text.opacity).toBe(1);
    expect(value.text.fontSize).toBe(0.01);
    expect(value.text.position).toBeNull();
    expect(value.image.scale).toBe(1);
    expect(value.image.position).toEqual({ x: 1, y: 0 });
  });

  it('keeps a saved user font id and rejects malformed ones', () => {
    const id = 'a'.repeat(32);
    expect(normalizeOverlays({ text: { font: `custom:${id}` } }).text.font).toBe(`custom:${id}`);
    expect(normalizeOverlays({ text: { font: 'custom:../x' } }).text.font).toBe('Inter');
  });

  it('accepts only font files within the size limit', () => {
    const file = (name: string, size = 10) => ({ name, size }) as unknown as File;
    expect(customFontError(file('Hand.WOFF2'))).toBeNull();
    expect(customFontError(file('hand.otf'))).toBeNull();
    expect(customFontError(file('hand.svg'))).toMatch(/TTF, OTF, WOFF or WOFF2/);
    expect(customFontError(file('big.ttf', CUSTOM_FONT_MAX_BYTES + 1))).toMatch(/10 MB/);
  });

  it('uses the single Anton weight', () => {
    expect(normalizeOverlays({ text: { font: 'Anton', weight: 700 } }).text.weight).toBe(400);
  });

  it('counts enabled text only when it has content', () => {
    const overlays = defaultOverlays();
    expect(hasOverlays(overlays)).toBe(false);
    overlays.text.enabled = true;
    overlays.text.content = '  ';
    expect(hasOverlays(overlays)).toBe(false);
    overlays.text.content = 'Hi';
    expect(hasOverlays(overlays)).toBe(true);
  });
});

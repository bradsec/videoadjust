import { applyPalette, quantize, type GifPalette } from 'gifenc';

export type GifFrame = { index: Uint8Array; palette: GifPalette; transparentIndex: number | null };

// Above this share of changed pixels a delta frame is larger than a full one: scattered
// transparent pixels break the runs LZW compresses well, as measured on noisy footage.
const FULL_FRAME_SHARE = 0.5;

/**
 * Returns an encoder that writes each frame after the first as a delta: pixels within
 * `threshold` (per channel) of what the viewer already sees become transparent, so the
 * frame stores only what changed. A null threshold writes every frame in full. Frames are
 * meant to be written with dispose 1, leaving the previous image in place.
 */
export function createDeltaEncoder(
  colors: number,
  threshold: number | null,
): (rgba: Uint8ClampedArray) => GifFrame {
  // The image on screen after the last frame. Comparing against this rather than the
  // previous source frame keeps slow drifts from staying hidden under the threshold.
  let shown: Uint8ClampedArray | null = null;

  const full = (rgba: Uint8ClampedArray, pixels: number): GifFrame => {
    const palette = quantize(rgba, colors);
    const index = applyPalette(rgba, palette);
    shown ??= new Uint8ClampedArray(rgba.length);
    for (let p = 0; p < pixels; p++) shown.set(palette[index[p]!]!, p * 4);
    return { index, palette, transparentIndex: null };
  };

  return (rgba) => {
    const pixels = rgba.length / 4;
    if (!shown || threshold === null) return full(rgba, pixels);
    const changed: number[] = [];
    for (let p = 0, o = 0; p < pixels; p++, o += 4) {
      if (
        Math.abs(rgba[o]! - shown[o]!) > threshold ||
        Math.abs(rgba[o + 1]! - shown[o + 1]!) > threshold ||
        Math.abs(rgba[o + 2]! - shown[o + 2]!) > threshold
      )
        changed.push(p);
    }
    if (changed.length > pixels * FULL_FRAME_SHARE) return full(rgba, pixels);
    if (!changed.length)
      return { index: new Uint8Array(pixels), palette: [[0, 0, 0]], transparentIndex: 0 };
    const subset = new Uint8ClampedArray(changed.length * 4);
    changed.forEach((p, i) => subset.set(rgba.subarray(p * 4, p * 4 + 4), i * 4));
    // One slot stays free for transparency; it is added after mapping so no changed
    // pixel can land on it.
    const palette = quantize(subset, colors - 1);
    const mapped = applyPalette(subset, palette);
    const transparentIndex = palette.length;
    const index = new Uint8Array(pixels).fill(transparentIndex);
    changed.forEach((p, i) => {
      index[p] = mapped[i]!;
      shown!.set(palette[mapped[i]!]!, p * 4);
    });
    return { index, palette: [...palette, [0, 0, 0]], transparentIndex };
  };
}

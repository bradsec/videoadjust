import { applyPalette, quantize } from 'gifenc';

self.onmessage = (
  event: MessageEvent<{
    rgba: Uint8ClampedArray;
    width: number;
    height: number;
    colors: number;
    version: number;
  }>,
) => {
  const { rgba, width, height, colors, version } = event.data;
  // shortcut: delta-frame trails are not simulated; add disposal tracking if previews need them.
  const palette = quantize(rgba, colors);
  const indices = applyPalette(rgba, palette);
  for (let i = 0; i < indices.length; i++) rgba.set(palette[indices[i]!]!, i * 4);
  self.postMessage({ rgba, width, height, version }, { transfer: [rgba.buffer] });
};

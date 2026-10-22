import { GIFEncoder } from 'gifenc';
import { createDeltaEncoder, type GifFrame } from './gifDelta';

const gif = GIFEncoder();
let encode: ((rgba: Uint8ClampedArray) => GifFrame) | undefined;

self.onmessage = (
  event: MessageEvent<
    | {
        type: 'frame';
        rgba: Uint8ClampedArray;
        width: number;
        height: number;
        colors: number;
        threshold: number | null;
        delay: number;
        repeat: number;
      }
    | { type: 'finish' }
  >,
) => {
  try {
    if (event.data.type === 'finish') {
      gif.finish();
      const bytes = gif.bytes();
      self.postMessage({ type: 'done', bytes }, { transfer: [bytes.buffer] });
      return;
    }
    const { rgba, width, height, colors, threshold, delay, repeat } = event.data;
    encode ??= createDeltaEncoder(colors, threshold);
    const { index, palette, transparentIndex } = encode(rgba);
    // Dispose 1 keeps the previous image, which the transparent pixels let show through.
    gif.writeFrame(index, width, height, {
      palette,
      delay,
      repeat,
      dispose: 1,
      transparent: transparentIndex !== null,
      transparentIndex: transparentIndex ?? 0,
    });
    self.postMessage({ type: 'frame' });
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

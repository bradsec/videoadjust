import { GIFEncoder, applyPalette, quantize } from 'gifenc';

const gif = GIFEncoder();

self.onmessage = (
  event: MessageEvent<
    | {
        type: 'frame';
        rgba: Uint8ClampedArray;
        width: number;
        height: number;
        colors: number;
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
    const { rgba, width, height, colors, delay, repeat } = event.data;
    const palette = quantize(rgba, colors);
    const index = applyPalette(rgba, palette);
    gif.writeFrame(index, width, height, { palette, delay, repeat, dispose: 2 });
    self.postMessage({ type: 'frame' });
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

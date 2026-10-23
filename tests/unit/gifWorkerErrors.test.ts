import { afterEach, expect, it, vi } from 'vitest';
import type { Input } from 'mediabunny';
import { autoGifSettings, exportGif } from '../../src/core/gifExport';
import type { SourceInfo } from '../../src/core/types';

const { frames } = vi.hoisted(() => ({ frames: vi.fn() }));
vi.mock('mediabunny', () => ({
  CanvasSink: class {
    canvasesAtTimestamps = frames;
  },
}));

afterEach(() => vi.unstubAllGlobals());

it.each(['before the first frame', 'while sending a frame'])(
  'rejects a worker failure %s',
  async (timing) => {
    let fail: () => void;
    const terminate = vi.fn();
    vi.stubGlobal(
      'Worker',
      class extends EventTarget {
        constructor() {
          super();
          fail = () =>
            this.dispatchEvent(Object.assign(new Event('error'), { message: 'Worker failed' }));
        }
        terminate = terminate;
        postMessage() {
          if (timing === 'while sending a frame') fail();
        }
      },
    );
    frames.mockImplementation(async function* () {
      if (timing === 'before the first frame') fail();
      yield {
        canvas: {
          getContext: () => ({ getImageData: () => ({ data: new Uint8ClampedArray(4) }) }),
        },
      };
    });
    const source: SourceInfo = {
      name: 'clip.mp4',
      sizeBytes: 100,
      durationSec: 0.1,
      containerMime: 'video/mp4',
      video: {
        codec: 'avc',
        decodable: true,
        displayWidth: 2,
        displayHeight: 2,
        rotation: 0,
        fps: 10,
        bitrate: 1000,
      },
      audio: null,
    };
    const input = { getPrimaryVideoTrack: async () => ({}) } as unknown as Input;
    const abort = new AbortController();
    const result = exportGif(
      input,
      source,
      autoGifSettings(source)!,
      undefined,
      abort.signal,
      vi.fn(),
    ).catch((error: unknown) => error);
    try {
      expect(
        await Promise.race([result, new Promise((resolve) => setTimeout(resolve, 0, 'pending'))]),
      ).toEqual(new Error('Worker failed'));
      expect(terminate).toHaveBeenCalledOnce();
    } finally {
      abort.abort();
      await result;
    }
  },
);

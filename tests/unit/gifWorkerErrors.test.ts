import { afterEach, expect, it, vi } from 'vitest';
import type { Input } from 'mediabunny';
import { autoGifSettings, exportGif } from '../../src/core/gifExport';
import type { SourceInfo } from '../../src/core/types';
import * as styles from '../../src/core/style';

const { frames } = vi.hoisted(() => ({ frames: vi.fn() }));
vi.mock('mediabunny', () => ({
  CanvasSink: class {
    canvasesAtTimestamps = frames;
  },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('returns GIF bytes with one visible-warning flag after a style failure', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const renderer = vi.spyOn(styles, 'createStyleRenderer').mockImplementation(() => {
    throw new Error('context lost');
  });
  vi.stubGlobal('OffscreenCanvas', class {});
  vi.stubGlobal(
    'Worker',
    class extends EventTarget {
      terminate() {}
      postMessage(message: { type: string }) {
        queueMicrotask(() =>
          this.dispatchEvent(
            new MessageEvent('message', {
              data:
                message.type === 'finish'
                  ? { type: 'done', bytes: new Uint8Array([1, 2]) }
                  : { type: 'ready' },
            }),
          ),
        );
      }
    },
  );
  frames.mockImplementation(async function* () {
    for (let i = 0; i < 2; i++)
      yield {
        canvas: {
          getContext: () => ({
            getImageData: () => ({ data: new Uint8ClampedArray(16) }),
          }),
        },
      };
  });
  const source: SourceInfo = {
    name: 'clip.mp4',
    sizeBytes: 100,
    durationSec: 0.2,
    containerMime: 'video/mp4',
    audio: null,
    video: {
      codec: 'avc',
      decodable: true,
      displayWidth: 2,
      displayHeight: 2,
      rotation: 0,
      fps: 10,
      bitrate: 1000,
    },
  };
  const input = { getPrimaryVideoTrack: async () => ({}) } as unknown as Input;
  expect(
    await exportGif(
      input,
      source,
      autoGifSettings(source)!,
      undefined,
      new AbortController().signal,
      () => {},
      undefined,
      {},
      styles.normalizeStyle({ id: 'mono' }),
    ),
  ).toEqual({ bytes: new Uint8Array([1, 2]), styleDropped: true });
  expect(renderer).toHaveBeenCalledTimes(1);
  expect(warn).toHaveBeenCalledTimes(1);
});

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

import type { ConversionVideoOptions, VideoSample } from 'mediabunny';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toConversionOptions } from '../../src/core/convert';
import * as renderer from '../../src/core/overlays';
import type { Settings } from '../../src/core/types';

const settings: Settings = {
  container: 'mp4',
  passthrough: true,
  trim: { start: 0, end: 1 },
  video: { codec: 'avc', width: 320, height: 320, fps: 10, bitrate: 800_000 },
  audio: null,
  transform: { rotate: 90, flip: true, crop: 'square' },
};
const source = {
  name: 'bands.mp4',
  sizeBytes: 100,
  durationSec: 1,
  containerMime: 'video/mp4',
  audio: null,
  video: {
    codec: 'avc',
    decodable: true,
    displayWidth: 640,
    displayHeight: 360,
    rotation: 0 as const,
    fps: 10,
    bitrate: 800_000,
  },
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('overlay conversion', () => {
  it('uses output dimensions after rotation and crop and reuses its canvas', async () => {
    const overlays = renderer.defaultOverlays();
    overlays.text.enabled = true;
    overlays.text.content = 'Export';
    const context = { clearRect: vi.fn(), drawImage: vi.fn() };
    const canvases: { width: number; height: number; getContext: () => typeof context }[] = [];
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        constructor(
          public width: number,
          public height: number,
        ) {
          canvases.push(this);
        }
        getContext() {
          return context;
        }
      },
    );
    const layer = { overlay: true } as unknown as OffscreenCanvas;
    const render = vi.spyOn(renderer, 'renderOverlayLayer').mockResolvedValue(layer);
    const draw = vi.fn();
    const options = toConversionOptions({ ...settings, overlays }, source)
      .video as ConversionVideoOptions;
    expect(options).toMatchObject({
      forceTranscode: true,
      allowTransformationMetadata: false,
      processedWidth: 320,
      processedHeight: 320,
    });
    const sample = { draw } as unknown as VideoSample;
    const first = await options.process!(sample);
    const second = await options.process!(sample);
    expect(first).toBe(second);
    expect(canvases).toHaveLength(1);
    expect(canvases[0]).toMatchObject({ width: 320, height: 320 });
    // The layer is rendered once and composited onto every frame.
    expect(render).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledWith(320, 320, overlays, {});
    expect(draw).toHaveBeenCalledWith(context, 0, 0, 320, 320);
    expect(context.drawImage).toHaveBeenCalledTimes(2);
    expect(context.drawImage).toHaveBeenCalledWith(layer, 0, 0);
  });

  it('forces encoding for overlays alone and preserves passthrough when disabled', () => {
    const overlays = renderer.defaultOverlays();
    const plain = { ...settings, transform: undefined, overlays };
    expect(toConversionOptions(plain).video).toEqual({});
    overlays.text.enabled = true;
    overlays.text.content = 'Export';
    expect(toConversionOptions(plain).video).toMatchObject({
      forceTranscode: true,
      processedWidth: 320,
      processedHeight: 320,
      process: expect.any(Function),
    });
  });
});

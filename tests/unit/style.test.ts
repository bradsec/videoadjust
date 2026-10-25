import {
  BufferTarget,
  Conversion,
  ConversionCanceledError,
  Mp4OutputFormat,
  type ConversionVideoOptions,
  type Input,
  type VideoSample,
} from 'mediabunny';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { shrinkJob, startConversion, toConversionOptions } from '../../src/core/convert';
import * as overlays from '../../src/core/overlays';
import type { Settings } from '../../src/core/types';
import * as styleRenderer from '../../src/core/style';
import {
  grainCellSize,
  hasStyle,
  hasStyleEffects,
  normalizeStyle,
  STYLE_PRESETS,
  styleUniforms,
  type StyleId,
} from '../../src/core/style';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('video styles', () => {
  it('applies colour correction with None and preserves copy eligibility at neutral', () => {
    const neutral = normalizeStyle();
    const corrected = normalizeStyle({
      correction: { exposure: 1, contrast: 1.2, saturation: 0.8, temperature: -0.3 },
    });
    expect(hasStyle(neutral)).toBe(false);
    expect(hasStyleEffects(neutral)).toBe(false);
    expect(hasStyleEffects(corrected)).toBe(true);
    expect(styleUniforms(corrected).correction).toEqual([2, 1.2, 0.8, -0.3]);
    expect(styleUniforms({ ...corrected, id: 'vhs', intensity: 0 }).kind).toBe(0);
    const base: Settings = {
      container: 'mp4',
      passthrough: true,
      trim: { start: 0, end: 1 },
      video: { codec: 'avc', width: 320, height: 180, fps: 10, bitrate: 800000 },
      audio: null,
    };
    expect(shrinkJob({ ...base, style: neutral }).copiesVideo).toBe(true);
    expect(shrinkJob({ ...base, style: corrected }).options.video).toMatchObject({
      forceTranscode: true,
      process: expect.any(Function),
    });
    expect(
      normalizeStyle({
        correction: { exposure: Infinity, contrast: -5, saturation: 9, temperature: -3 },
      }).correction,
    ).toEqual({ exposure: 0, contrast: 0, saturation: 2, temperature: -1 });
  });
  it('reports a dropped style once and keeps exporting frames', async () => {
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        getContext() {
          return { clearRect: vi.fn(), drawImage: vi.fn() };
        }
      },
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const renderer = vi.spyOn(styleRenderer, 'createStyleRenderer').mockImplementation(() => {
      throw new Error('context lost');
    });
    const job = shrinkJob({
      container: 'mp4',
      passthrough: true,
      trim: { start: 0, end: 1 },
      video: { codec: 'avc', width: 320, height: 180, fps: 10, bitrate: 800_000 },
      audio: null,
      style: normalizeStyle({ id: 'mono' }),
    });
    const process = (job.options.video as ConversionVideoOptions).process!;
    const sample = { timestamp: 0, draw: vi.fn() } as unknown as VideoSample;
    await process(sample);
    await process(sample);
    expect(job.styleDropped).toBe(true);
    expect(renderer).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });
  it('makes large grain clearly coarser at preview and export resolutions', () => {
    for (const height of [360, 1080]) {
      const fine = grainCellSize(0, height);
      const coarse = grainCellSize(1, height);
      expect(coarse / fine).toBeGreaterThanOrEqual(3);
      expect(fine).toBeGreaterThanOrEqual(1);
    }
    expect(grainCellSize(1, 1080) / grainCellSize(1, 360)).toBe(3);
  });

  it.each(['success', 'failure', 'cancellation'] as const)(
    'destroys export renderer after %s',
    async (outcome) => {
      const events: string[] = [];
      const destroy = vi.fn(() => events.push('destroy'));
      vi.stubGlobal(
        'OffscreenCanvas',
        class {
          constructor(
            public width: number,
            public height: number,
          ) {}
          getContext() {
            return { clearRect: vi.fn(), drawImage: vi.fn() };
          }
        },
      );
      vi.spyOn(styleRenderer, 'createStyleRenderer').mockReturnValue({
        draw: vi.fn(() => events.push('draw')),
        destroy,
      });
      const job = shrinkJob({
        container: 'mp4',
        passthrough: false,
        trim: { start: 0, end: 1 },
        video: { codec: 'avc', width: 320, height: 180, fps: 10, bitrate: 800_000 },
        audio: null,
        style: normalizeStyle({ id: 'mono' }),
      });
      const input = {
        getPrimaryVideoTrack: async () => null,
        getPrimaryAudioTrack: async () => null,
      } as unknown as Input;
      vi.spyOn(Conversion, 'init').mockResolvedValue({
        isValid: true,
        discardedTracks: [],
        cancel: vi.fn(),
        execute: async () => {
          await (job.options.video as ConversionVideoOptions).process!({
            timestamp: 0,
            draw: vi.fn(),
          } as unknown as VideoSample);
          events.push('frame complete');
          if (outcome === 'failure') throw new Error('encode failed');
          if (outcome === 'cancellation') {
            await cancel();
            throw new ConversionCanceledError();
          }
        },
      } as unknown as Conversion);
      const task = startConversion({
        input,
        job,
        format: new Mp4OutputFormat(),
        target: new BufferTarget(),
        onProgress: vi.fn(),
      });
      const cancel = task.cancel;
      if (outcome === 'failure') await expect(task.done).rejects.toThrow('encode failed');
      else if (outcome === 'cancellation')
        await expect(task.done).rejects.toBeInstanceOf(ConversionCanceledError);
      else await expect(task.done).resolves.toBeUndefined();
      expect(events).toEqual(['draw', 'frame complete', 'destroy']);
      expect(destroy).toHaveBeenCalledTimes(1);
    },
  );

  it('defines None and ten distinct presets with usable detail ranges', () => {
    expect(STYLE_PRESETS.map((preset) => preset.id)).toEqual([
      'none',
      'cinematic',
      'grain',
      'vhs',
      'bloom',
      'aberration',
      'vignette',
      'mono',
      'duotone',
      'glitch',
      'diffusion',
    ]);
    for (const preset of STYLE_PRESETS) {
      expect(preset.label).toBeTruthy();
      expect(preset.defaultDetail).toBeGreaterThanOrEqual(preset.detailMin);
      expect(preset.defaultDetail).toBeLessThanOrEqual(preset.detailMax);
      expect(preset.detailStep).toBeGreaterThan(0);
    }
  });

  it('normalizes invalid values and clamps intensity and detail', () => {
    const defaults = normalizeStyle();
    expect(defaults.id).toBe('none');
    expect(normalizeStyle({ id: 'missing' as StyleId })).toEqual(defaults);
    expect(
      normalizeStyle({
        id: 'duotone',
        intensity: 2,
        detail: -1,
        colorA: '#ABCDEF',
        colorB: 'red',
      }),
    ).toEqual({
      id: 'duotone',
      intensity: 1,
      detail: 0,
      colorA: '#abcdef',
      colorB: defaults.colorB,
      correction: defaults.correction,
    });
    expect(normalizeStyle({ id: 'grain', intensity: NaN, detail: Infinity })).toMatchObject({
      intensity: defaults.intensity,
      detail: STYLE_PRESETS.find((preset) => preset.id === 'grain')!.defaultDetail,
    });
  });

  it('treats None and zero intensity as pass-through', () => {
    expect(hasStyle(normalizeStyle())).toBe(false);
    expect(hasStyle(normalizeStyle({ id: 'grain', intensity: 0 }))).toBe(false);
    expect(hasStyle(normalizeStyle({ id: 'grain', intensity: 0.01 }))).toBe(true);
  });

  it('maps preset order and hex colours to shader uniforms', () => {
    const style = normalizeStyle({
      id: 'duotone',
      intensity: 0.6,
      detail: 0.3,
      colorA: '#000080',
      colorB: '#ff8040',
    });
    expect(styleUniforms(style)).toEqual({
      kind: STYLE_PRESETS.findIndex((preset) => preset.id === 'duotone'),
      intensity: 0.6,
      detail: 0.3,
      colorA: [0, 0, 128 / 255],
      colorB: [1, 128 / 255, 64 / 255],
      correction: [1, 1, 1, 0],
    });
  });

  it('forces encoding only for an active style and draws it before overlays', async () => {
    const base: Settings = {
      container: 'mp4',
      passthrough: true,
      trim: { start: 2, end: 4 },
      video: { codec: 'avc', width: 320, height: 180, fps: 10, bitrate: 800_000 },
      audio: null,
    };
    expect(toConversionOptions({ ...base, style: normalizeStyle() }).video).toEqual({});
    expect(
      toConversionOptions({ ...base, style: normalizeStyle({ id: 'grain', intensity: 0 }) }).video,
    ).toEqual({});

    const order: string[] = [];
    const context = {
      clearRect: vi.fn(),
      drawImage: vi.fn((image: unknown) => {
        order.push(image === layer ? 'overlay' : 'style');
      }),
    };
    const canvases: OffscreenCanvas[] = [];
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        constructor(
          public width: number,
          public height: number,
        ) {
          canvases.push(this as unknown as OffscreenCanvas);
        }
        getContext() {
          return context;
        }
      },
    );
    const layer = {} as OffscreenCanvas;
    vi.spyOn(overlays, 'renderOverlayLayer').mockResolvedValue(layer);
    vi.spyOn(styleRenderer, 'createStyleRenderer').mockReturnValue({
      draw: vi.fn((_input, _width, _height, time) => order.push(`style:${time}`)),
      destroy: vi.fn(),
    });
    const overlay = overlays.defaultOverlays();
    overlay.text.enabled = true;
    overlay.text.content = 'Top';
    const chosen = normalizeStyle({ id: 'grain' });
    const options = toConversionOptions({ ...base, style: chosen, overlays: overlay })
      .video as ConversionVideoOptions;
    expect(options).toMatchObject({
      forceTranscode: true,
      allowTransformationMetadata: false,
      processedWidth: 320,
      processedHeight: 180,
    });
    const sample = {
      timestamp: 1.25,
      draw: vi.fn(() => order.push('source')),
    } as unknown as VideoSample;
    await options.process!(sample);
    expect(canvases).toHaveLength(2);
    expect(order).toEqual(['source', 'style:3.25', 'style', 'overlay']);
    expect(styleRenderer.createStyleRenderer).toHaveBeenCalledWith(canvases[1]);
  });
});

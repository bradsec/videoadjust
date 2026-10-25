import { describe, expect, it, vi } from 'vitest';
import { ConversionCanceledError, Mp3OutputFormat, Quality, type Input } from 'mediabunny';
import type { AudioFormat } from '../../src/core/audioExtract';
import { defaultOverlays } from '../../src/core/overlays';
import { normalizeStyle } from '../../src/core/style';
import type { AddedAudio } from '../../src/core/audioMix';
import { audioExtractJob, ConversionInvalidError } from '../../src/core/convert';
import { autoSettings, targetVideoBitrate } from '../../src/core/autoSettings';
import type { Capabilities, Settings, SourceInfo } from '../../src/core/types';
import {
  createController,
  allSettingsChangeCount,
  LARGE_FILE_BYTES,
  type AppDeps,
  type AppState,
} from '../../src/ui/controller';

const caps: Capabilities = {
  video: { avc: true, hevc: false, av1: false, vp9: false },
  audio: { aac: true, opus: true },
  aacViaFallback: false,
  fileStreamSave: false,
  shareFiles: false,
};

const info = (name: string): SourceInfo => ({
  name,
  sizeBytes: 10,
  durationSec: 3,
  containerMime: 'video/mp4',
  video: {
    codec: 'avc',
    decodable: true,
    displayWidth: 1920,
    displayHeight: 1080,
    rotation: 0,
    fps: 30,
    bitrate: 4e6,
  },
  audio: null,
});

const fakeFile = (name: string, size = 10) => ({ name, size }) as File;
const fakeInput = () =>
  ({ dispose: vi.fn() }) as unknown as Input & { dispose: ReturnType<typeof vi.fn> };

/** readSource stub whose promises resolve or reject when the test says so. */
function setup(probe: AppDeps['probeCapabilities'] = () => Promise.resolve(caps)) {
  const pending: {
    name: string;
    input: ReturnType<typeof fakeInput>;
    resolve(): void;
    reject(e: unknown): void;
  }[] = [];
  const readSource = vi.fn((file: File) => {
    const input = fakeInput();
    return new Promise<{ info: SourceInfo; input: Input }>((resolve, reject) => {
      pending.push({
        name: file.name,
        input,
        resolve: () => resolve({ info: info(file.name), input }),
        reject,
      });
    });
  });
  // openSink never settles here, standing in for a save picker left open.
  const deps = {
    probeCapabilities: probe,
    canEncodeVideo: vi.fn(async () => true),
    readSource,
    startConversion: vi.fn(),
    openSink: vi.fn(() => new Promise(() => {})),
    ensureMp3Encoder: vi.fn(async () => {}),
  } as unknown as AppDeps;
  const ctl = createController(deps, () => {});
  return { ctl, pending, readSource };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const big = () => fakeFile('big.mp4', LARGE_FILE_BYTES + 1);

describe('stale source loads', () => {
  it('a later large-file warning is not overridden by an earlier read finishing', async () => {
    const { ctl, pending } = setup();
    ctl.dispatch({ type: 'pick', file: fakeFile('a.mp4') });
    await flush();
    ctl.dispatch({ type: 'pick', file: big() });
    expect(ctl.getState()).toMatchObject({ kind: 'drop', notice: { tone: 'warn' } });

    pending[0]!.resolve();
    await flush();
    expect(ctl.getState()).toMatchObject({ kind: 'drop', notice: { tone: 'warn' } });
    expect(pending[0]!.input.dispose).toHaveBeenCalledTimes(1);
  });

  it('dismissing a notice while a read is pending drops the late result', async () => {
    const { ctl, pending } = setup();
    ctl.dispatch({ type: 'pick', file: fakeFile('a.mp4') });
    await flush();
    ctl.dispatch({ type: 'dismissNotice' });
    pending[0]!.resolve();
    await flush();
    expect(ctl.getState()).toEqual({ kind: 'drop' });
    expect(pending[0]!.input.dispose).toHaveBeenCalledTimes(1);
  });

  it('reset drops the late result', async () => {
    const { ctl, pending } = setup();
    ctl.dispatch({ type: 'pick', file: fakeFile('a.mp4') });
    await flush();
    ctl.dispatch({ type: 'reset' });
    pending[0]!.resolve();
    await flush();
    expect(ctl.getState()).toEqual({ kind: 'drop' });
  });

  it('the newest pick wins and the older Input is disposed', async () => {
    const { ctl, pending } = setup();
    ctl.dispatch({ type: 'pick', file: fakeFile('a.mp4') });
    await flush();
    ctl.dispatch({ type: 'pick', file: fakeFile('b.mp4') });
    await flush();
    pending[1]!.resolve();
    await flush();
    pending[0]!.resolve();
    await flush();
    expect(ctl.getState()).toMatchObject({ kind: 'prepare', file: { name: 'b.mp4' } });
    expect(pending[0]!.input.dispose).toHaveBeenCalledTimes(1);
    expect(pending[1]!.input.dispose).not.toHaveBeenCalled();
  });

  it('disposes the prepare Input when leaving prepare', async () => {
    const { ctl, pending } = setup();
    ctl.dispatch({ type: 'pick', file: fakeFile('a.mp4') });
    await flush();
    pending[0]!.resolve();
    await flush();
    expect(ctl.getState().kind).toBe('prepare');
    ctl.dispatch({ type: 'reset' });
    expect(pending[0]!.input.dispose).toHaveBeenCalledTimes(1);
  });
});

describe('audio mix state', () => {
  it('keeps the pending audio read busy across tool and track changes', () => {
    const ctl = createController(
      { readAddedAudio: () => new Promise(() => {}) } as unknown as AppDeps,
      () => {},
    );
    const source = {
      ...info('clip.mp4'),
      audio: { codec: 'aac', decodable: true, channels: 2, sampleRate: 48000, bitrate: 128000 },
    };
    ctl.dispatch({
      type: 'loaded',
      file: fakeFile(source.name),
      source,
      input: fakeInput(),
      auto: autoSettings(source, caps),
      caps,
    });
    ctl.dispatch({ type: 'addAudio', file: fakeFile('music.mp4') });
    ctl.dispatch({ type: 'setTool', tool: 'audio' });
    expect(ctl.getState()).toMatchObject({ kind: 'prepare', addingAudio: true });
    ctl.dispatch({ type: 'setMix', value: { original: { include: true, volumeDb: -6 } } });
    expect(ctl.getState()).toMatchObject({ kind: 'prepare', addingAudio: true });
    ctl.dispatch({ type: 'export' });
    expect(ctl.getState()).toMatchObject({ kind: 'prepare', addingAudio: true });
    ctl.dispatch({ type: 'reset' });
  });
  it('shares tracks and master across tools, enables extraction for added-only audio, and disposes removed inputs', async () => {
    const added = {
      file: fakeFile('music.mp4'),
      input: fakeInput(),
      duration: 2,
      channels: 1,
      sampleRate: 48000,
    } as AddedAudio;
    const ctl = createController(
      {
        readAddedAudio: async () => added,
      } as unknown as AppDeps,
      () => {},
    );
    const source = info('silent.mp4');
    ctl.dispatch({
      type: 'loaded',
      file: fakeFile(source.name),
      source,
      input: fakeInput(),
      auto: autoSettings(source, caps),
      caps,
    });
    ctl.dispatch({ type: 'addAudio', file: added.file });
    await flush();
    expect(ctl.getState()).toMatchObject({
      kind: 'prepare',
      addedAudio: added,
      audioSettings: { copy: false },
    });
    ctl.dispatch({
      type: 'setMix',
      value: {
        original: { include: false, volumeDb: -6 },
        added: { volumeDb: -3, offset: 1, loop: true },
      },
    });
    ctl.dispatch({
      type: 'setAudioProcessing',
      value: { gainDb: -2, fadeIn: 0, fadeOut: 0, normalize: null },
    });
    const state = ctl.getState();
    if (state.kind !== 'prepare') throw new Error('Expected prepare');
    expect(state.settings.mix).toEqual(state.audioSettings!.mix);
    expect(state.settings.audioProcessing).toEqual(state.audioSettings!.audioProcessing);
    ctl.dispatch({ type: 'setTool', tool: 'audio' });
    expect(ctl.getState()).toMatchObject({ tool: 'audio' });
    const neutralOriginal = { ...state.settings.mix!, original: { include: true, volumeDb: 0 } };
    ctl.dispatch({ type: 'setMix', value: neutralOriginal });
    expect(ctl.getState()).toMatchObject({
      addedAudio: added,
      settings: { mix: neutralOriginal },
      audioSettings: { mix: neutralOriginal },
    });
    ctl.dispatch({ type: 'removeAddedAudio' });
    expect(added.input.dispose).toHaveBeenCalledOnce();
    expect(ctl.getState()).toMatchObject({
      tool: 'shrink',
      settings: { audio: null },
      audioSettings: null,
    });
  });

  it('disposes a late added file after reset and reports decode errors', async () => {
    let resolve!: (added: AddedAudio) => void;
    const readAddedAudio = vi.fn(
      () =>
        new Promise<AddedAudio>((done) => {
          resolve = done;
        }),
    );
    const ctl = createController({ readAddedAudio } as unknown as AppDeps, () => {});
    const source = info('silent.mp4');
    const load = () =>
      ctl.dispatch({
        type: 'loaded',
        file: fakeFile(source.name),
        source,
        input: fakeInput(),
        auto: autoSettings(source, caps),
        caps,
      });
    load();
    ctl.dispatch({ type: 'addAudio', file: fakeFile('music.mp4') });
    ctl.dispatch({ type: 'reset' });
    const added = {
      file: fakeFile('music.mp4'),
      input: fakeInput(),
      duration: 2,
      channels: 1,
      sampleRate: 48000,
    } as AddedAudio;
    resolve(added);
    await flush();
    expect(added.input.dispose).toHaveBeenCalledOnce();
    expect(ctl.getState()).toEqual({ kind: 'drop' });
    readAddedAudio.mockRejectedValueOnce(new Error('This file has no decodable audio.'));
    load();
    ctl.dispatch({ type: 'addAudio', file: fakeFile('bad.mp4') });
    await flush();
    expect(ctl.getState()).toMatchObject({
      kind: 'prepare',
      notice: { tone: 'error', message: 'This file has no decodable audio.' },
    });
  });
});

describe('capability probe', () => {
  it('retries after a rejected probe instead of caching the rejection', async () => {
    const probe = vi
      .fn<AppDeps['probeCapabilities']>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(caps);
    const { ctl, pending, readSource } = setup(probe);
    ctl.dispatch({ type: 'pick', file: fakeFile('a.mp4') });
    await flush();
    expect(ctl.getState()).toMatchObject({ kind: 'drop', notice: { tone: 'error' } });
    expect(readSource).not.toHaveBeenCalled();

    ctl.dispatch({ type: 'pick', file: fakeFile('a.mp4') });
    await flush();
    pending[0]!.resolve();
    await flush();
    expect(ctl.getState().kind).toBe('prepare');
    expect(probe).toHaveBeenCalledTimes(2);
  });
});

describe('trim changes', () => {
  it('updates prepare settings and clamps a crossing handle', async () => {
    const { ctl, pending } = setup();
    ctl.dispatch({ type: 'pick', file: fakeFile('a.mp4') });
    await flush();
    pending[0]!.resolve();
    await flush();
    ctl.dispatch({ type: 'setTrim', value: { start: 0, end: -1 } });
    expect(ctl.getState()).toMatchObject({
      kind: 'prepare',
      settings: { trim: { start: 0, end: 0.1 } },
    });
  });
});

describe('prepare settings', () => {
  it('carries trimmed-copy mode through the export action', () => {
    const { ctl } = setup();
    const source = {
      ...info('small.mp4'),
      video: { ...info('small.mp4').video!, bitrate: 300_000 },
    };
    const auto = autoSettings(source, caps);
    expect(auto.alreadyOptimal).toBe(true);
    expect(auto.settings.passthrough).toBe(false);
    ctl.dispatch({
      type: 'loaded',
      file: fakeFile('small.mp4'),
      source,
      input: fakeInput(),
      auto,
      caps,
    });
    expect(ctl.getState()).toMatchObject({ kind: 'prepare', settings: { passthrough: true } });
    const state = ctl.getState();
    if (state.kind !== 'prepare') throw new Error('Expected prepare state');
    ctl.dispatch({ type: 'setSettings', value: { ...state.settings, passthrough: false } });
    expect(ctl.getState()).toMatchObject({ kind: 'prepare', settings: { passthrough: false } });
    ctl.dispatch({ type: 'setSettings', value: { ...state.settings, passthrough: true } });
    ctl.dispatch({ type: 'export' });
    expect(ctl.getState()).toMatchObject({ kind: 'prepare', settings: { passthrough: true } });
  });
  it('validates settings through the controller action', async () => {
    const { ctl, pending } = setup();
    ctl.dispatch({ type: 'pick', file: fakeFile('a.mp4') });
    await flush();
    pending[0]!.resolve();
    await flush();
    const state = ctl.getState();
    expect(state.kind).toBe('prepare');
    if (state.kind !== 'prepare') return;
    ctl.dispatch({
      type: 'setSettings',
      value: {
        ...state.settings,
        video: {
          ...state.settings.video!,
          codec: 'hevc',
          width: 3840,
          height: 2160,
          bitrate: 99e6,
        },
        trim: { start: -5, end: 99 },
      },
    });
    expect(ctl.getState()).toMatchObject({
      kind: 'prepare',
      settings: {
        video: { codec: 'avc', width: 1920, height: 1080, bitrate: 4e6 },
        trim: { start: 0, end: 3 },
      },
    });
  });

  it('preserves quality percent when codec, size, or frame rate changes', () => {
    const { ctl } = setup();
    const source = { ...info('clip.mp4'), video: { ...info('clip.mp4').video!, bitrate: 12e6 } };
    const available = { ...caps, video: { ...caps.video, hevc: true } };
    ctl.dispatch({
      type: 'loaded',
      file: fakeFile('clip.mp4'),
      source,
      input: fakeInput(),
      auto: autoSettings(source, available),
      caps: available,
    });
    const initial = ctl.getState();
    if (initial.kind !== 'prepare') throw new Error('Expected prepare state');
    const baseline = initial.settings.video!.bitrate;
    ctl.dispatch({
      type: 'setSettings',
      value: {
        ...initial.settings,
        video: { ...initial.settings.video!, bitrate: Math.round(baseline * 0.75) },
      },
    });
    for (const change of [{ codec: 'hevc' as const }, { width: 1280, height: 720 }, { fps: 24 }]) {
      const before = ctl.getState();
      if (before.kind !== 'prepare') throw new Error('Expected prepare state');
      ctl.dispatch({
        type: 'setSettings',
        value: { ...before.settings, video: { ...before.settings.video!, ...change } },
      });
      const after = ctl.getState();
      if (after.kind !== 'prepare') throw new Error('Expected prepare state');
      const v = after.settings.video!;
      expect(v.bitrate).toBeCloseTo(
        targetVideoBitrate(v.codec, v.width, v.height, v.fps) * 0.75,
        -1,
      );
    }
  });
});

describe('export flow', () => {
  const source = (over: Partial<SourceInfo> = {}): SourceInfo => ({
    ...info('clip.mov'),
    sizeBytes: 1_000_000,
    ...over,
  });

  function exportSetup(
    opts: {
      fileStreamSave?: boolean;
      deviceMemoryGB?: number;
      src?: SourceInfo;
      outputBytes?: number;
      openSink?: AppDeps['openSink'];
      ensureMp3Encoder?: AppDeps['ensureMp3Encoder'];
      name?: string;
    } = {},
  ) {
    const src = opts.src ?? source();
    const capabilities = { ...caps, fileStreamSave: opts.fileStreamSave ?? false };
    let resolveDone!: () => void;
    let rejectDone!: (e: unknown) => void;
    let progress!: (p: number, bytes: number) => void;
    const job = { cancel: vi.fn(async () => {}) };
    const startConversion = vi.fn((args: { onProgress(p: number, b: number): void }) => {
      progress = args.onProgress;
      return {
        ...job,
        done: new Promise<void>((res, rej) => {
          resolveDone = res;
          rejectDone = rej;
        }),
      };
    });
    const blob = new Blob([new Uint8Array(opts.outputBytes ?? 1000)], { type: 'video/mp4' });
    const sink = {
      target: {},
      finish: vi.fn(async () => (opts.fileStreamSave ? null : blob)),
      abort: vi.fn(async () => {}),
    };
    const openSink = opts.openSink ?? vi.fn(async () => sink);
    const outInput = fakeInput();
    const readSource = vi.fn(async (file: File) => ({
      info: { ...src, name: file.name, sizeBytes: file.size, containerMime: 'video/mp4' },
      input: outInput,
    }));
    const canEncodeVideo = vi.fn(async () => true);
    const ensureMp3Encoder = vi.fn(opts.ensureMp3Encoder ?? (async () => {}));
    const deps = {
      probeCapabilities: () => Promise.resolve(capabilities),
      canEncodeVideo,
      readSource,
      startConversion,
      openSink,
      ensureMp3Encoder,
      deviceMemoryGB: opts.deviceMemoryGB,
    } as unknown as AppDeps;
    const ctl = createController(deps, () => {});
    const input = fakeInput();
    ctl.dispatch({
      type: 'loaded',
      file: fakeFile(opts.name ?? 'clip.mov', src.sizeBytes),
      source: src,
      input,
      auto: autoSettings(src, capabilities),
      caps: capabilities,
    });
    return {
      ctl,
      sink,
      job,
      openSink,
      startConversion,
      canEncodeVideo,
      ensureMp3Encoder,
      readSource,
      outInput,
      input,
      resolve: () => resolveDone(),
      reject: (e: unknown) => rejectDone(e),
      progress: (p: number, b: number) => progress(p, b),
    };
  }

  it('runs export through working to result with a smaller output', async () => {
    const t = exportSetup();
    const settings = (
      t.ctl.getState() as Extract<ReturnType<typeof t.ctl.getState>, { kind: 'prepare' }>
    ).settings;
    t.ctl.dispatch({ type: 'export' });
    await flush();
    expect(t.openSink).toHaveBeenCalledWith(
      { kind: 'memory', warn: false },
      'clip-small.mp4',
      'video/mp4',
    );
    expect(t.ctl.getState()).toMatchObject({
      kind: 'working',
      outputName: 'clip-small.mp4',
      progress: 0,
    });
    t.progress(0.5, 400);
    expect(t.ctl.getState()).toMatchObject({ kind: 'working', progress: 0.5, bytes: 400 });
    t.resolve();
    await flush();
    await flush();
    const state = t.ctl.getState();
    expect(state).toMatchObject({
      kind: 'result',
      settings,
      notSmaller: false,
      output: { sizeBytes: 1000, info: { sizeBytes: 1000, name: 'clip-small.mp4' } },
    });
    if (state.kind !== 'result') throw new Error('Expected result');
    expect(state.output.url).toMatch(/^blob:/);
    expect(t.outInput.dispose).toHaveBeenCalledTimes(1);
    expect(t.input.dispose).not.toHaveBeenCalled();
  });

  it('carries a dropped-style warning and analysis phase to the result', async () => {
    const t = exportSetup();
    t.ctl.dispatch({ type: 'export' });
    await flush();
    const args = t.startConversion.mock.calls[0]![0] as Parameters<AppDeps['startConversion']>[0];
    args.onProgress(0.5, 0, 'analysis');
    expect(t.ctl.getState()).toMatchObject({ kind: 'working', phase: 'analysis', progress: 0.5 });
    Object.defineProperty(args.job, 'styleDropped', { get: () => true });
    t.resolve();
    await flush();
    await flush();
    expect(t.ctl.getState()).toMatchObject({ kind: 'result', styleDropped: true });
  });

  it('stops before opening a sink when the chosen encoder settings are unavailable', async () => {
    const t = exportSetup({
      src: source({ video: { ...info('clip.mov').video!, bitrate: 8_000_000 } }),
    });
    t.canEncodeVideo.mockResolvedValue(false);
    t.ctl.dispatch({ type: 'export' });
    await flush();
    expect(t.openSink).not.toHaveBeenCalled();
    expect(t.ctl.getState()).toMatchObject({
      kind: 'prepare',
      notice: { tone: 'error', message: expect.stringContaining('H.264') },
    });
    expect(t.canEncodeVideo).toHaveBeenCalledWith('avc', {
      width: 1920,
      height: 1080,
      frameRate: 30,
    });
  });

  it('exports a trimmed video copy without probing an unavailable encoder', async () => {
    const src = source({ video: { ...info('clip.mov').video!, bitrate: 300_000 } });
    const t = exportSetup({ src });
    t.canEncodeVideo.mockResolvedValue(false);
    expect(t.ctl.getState()).toMatchObject({ settings: { passthrough: true } });
    t.ctl.dispatch({ type: 'export' });
    await flush();
    expect(t.canEncodeVideo).not.toHaveBeenCalled();
    expect(t.startConversion).toHaveBeenCalledWith(
      expect.objectContaining({
        job: expect.objectContaining({ options: expect.objectContaining({ video: {} }) }),
      }),
    );
    expect(t.ctl.getState()).toMatchObject({ kind: 'working' });
  });

  it('passes 30 fps and the lowest quality after re-encode, 854 size, quality, and 64 kbps audio', async () => {
    const src = source({
      name: 'land-1080p30-aac.mp4',
      sizeBytes: 185_500,
      video: { ...info('clip.mov').video!, bitrate: 353_309.3333333333 },
      audio: { codec: 'aac', decodable: true, channels: 2, sampleRate: 48_000, bitrate: 128_000 },
    });
    const t = exportSetup({ src });
    const change = (update: (settings: Settings) => Settings) => {
      const state = t.ctl.getState();
      if (state.kind !== 'prepare') throw new Error('Expected prepare state');
      t.ctl.dispatch({ type: 'setSettings', value: update(state.settings) });
    };

    change((settings) => ({ ...settings, passthrough: false }));
    change((settings) => ({
      ...settings,
      video: { ...settings.video!, width: 854, height: 480 },
    }));
    change((settings) => ({
      ...settings,
      video: { ...settings.video!, bitrate: Math.round((src.video!.bitrate! * 25) / 100) },
    }));
    change((settings) => ({
      ...settings,
      audio: { ...settings.audio!, bitrate: 64_000, copy: false },
    }));

    t.ctl.dispatch({ type: 'export' });
    await flush();
    const args = t.startConversion.mock.calls[0]?.[0] as Parameters<AppDeps['startConversion']>[0];
    expect(args.job.options.video).toMatchObject({
      codec: 'avc',
      width: 854,
      height: 480,
      frameRate: 30,
      quality: new Quality({ bitrate: 88_327 }),
    });
    expect(args.job.options.audio).toMatchObject({
      codec: 'aac',
      quality: new Quality({ bitrate: 64_000 }),
    });
    expect(args.job.options.video).toEqual({
      width: 854,
      height: 480,
      fit: 'contain',
      frameRate: 30,
      codec: 'avc',
      quality: new Quality({ bitrate: 88_327 }),
    });
  });

  it('flags an output that is not smaller than the source', async () => {
    const t = exportSetup({ outputBytes: 1_000_000 });
    t.ctl.dispatch({ type: 'export' });
    await flush();
    t.resolve();
    await flush();
    await flush();
    expect(t.ctl.getState()).toMatchObject({ kind: 'result', notSmaller: true });
  });

  it('returns to prepare with settings kept and no notice when the picker is cancelled', async () => {
    const openSink = vi.fn(async () => {
      throw new DOMException('The user aborted a request.', 'AbortError');
    }) as unknown as AppDeps['openSink'];
    const t = exportSetup({ fileStreamSave: true, openSink });
    const before = t.ctl.getState();
    t.ctl.dispatch({ type: 'export' });
    await flush();
    const after = t.ctl.getState();
    expect(after.kind).toBe('prepare');
    if (after.kind !== 'prepare' || before.kind !== 'prepare') return;
    expect(after.settings).toEqual(before.settings);
    expect(after.notice).toBeUndefined();
    expect(t.startConversion).not.toHaveBeenCalled();
  });

  it('warns before a large in-memory export and continues on confirm', async () => {
    const big = source({ durationSec: 4000 });
    const t = exportSetup({ src: big, deviceMemoryGB: 1 });
    t.ctl.dispatch({ type: 'export' });
    await flush();
    expect(t.openSink).not.toHaveBeenCalled();
    expect(t.ctl.getState()).toMatchObject({
      kind: 'prepare',
      notice: {
        tone: 'warn',
        confirm: 'memory',
        message: expect.stringContaining('Trim it shorter or choose a smaller size to be safe.'),
      },
    });
    t.ctl.dispatch({ type: 'export', confirmed: true });
    await flush();
    expect(t.openSink).toHaveBeenCalledWith(
      { kind: 'memory', warn: true },
      'clip-small.mp4',
      'video/mp4',
    );
    expect(t.ctl.getState().kind).toBe('working');
  });

  it('a settings or trim change drops a pending memory confirm', async () => {
    const warned = async () => {
      const t = exportSetup({ src: source({ durationSec: 4000 }), deviceMemoryGB: 1 });
      t.ctl.dispatch({ type: 'export' });
      await flush();
      const s = t.ctl.getState();
      expect(s).toMatchObject({ kind: 'prepare', notice: { confirm: 'memory' } });
      if (s.kind !== 'prepare') throw new Error('expected prepare');
      return { t, s };
    };
    // The confirm was for the old estimate; a new export must ask again.
    const a = await warned();
    a.t.ctl.dispatch({ type: 'setSettings', value: { ...a.s.settings, container: 'webm' } });
    expect(a.t.ctl.getState()).toMatchObject({ kind: 'prepare', notice: undefined });
    const b = await warned();
    b.t.ctl.dispatch({ type: 'setTrim', value: { start: 0, end: 100 } });
    expect(b.t.ctl.getState()).toMatchObject({ kind: 'prepare', notice: undefined });
  });

  it('cancel returns to prepare with settings kept', async () => {
    const t = exportSetup();
    const before = t.ctl.getState();
    t.ctl.dispatch({ type: 'export' });
    await flush();
    t.ctl.dispatch({ type: 'cancel' });
    expect(t.job.cancel).toHaveBeenCalledTimes(1);
    // Back to prepare without waiting for the job to settle.
    expect(t.ctl.getState()).toMatchObject({ kind: 'prepare' });
    t.reject(new ConversionCanceledError());
    await flush();
    const after = t.ctl.getState();
    expect(after).toMatchObject({ kind: 'prepare' });
    if (after.kind !== 'prepare' || before.kind !== 'prepare') return;
    expect(after.settings).toEqual(before.settings);
    expect(after.notice).toBeUndefined();
    expect(t.input.dispose).not.toHaveBeenCalled();
  });

  it('aborts a file-stream sink on cancel and says a partial file may remain', async () => {
    const t = exportSetup({ fileStreamSave: true });
    t.ctl.dispatch({ type: 'export' });
    await flush();
    expect(t.openSink).toHaveBeenCalledWith({ kind: 'file-stream' }, 'clip-small.mp4', 'video/mp4');
    t.ctl.dispatch({ type: 'cancel' });
    // The abort must reach the file before Mediabunny closes (and so commits) it.
    expect(t.sink.abort).toHaveBeenCalled();
    expect(t.sink.abort.mock.invocationCallOrder[0]!).toBeLessThan(
      t.job.cancel.mock.invocationCallOrder[0]!,
    );
    t.reject(new ConversionCanceledError());
    await flush();
    expect(t.ctl.getState()).toMatchObject({
      kind: 'prepare',
      notice: { message: expect.stringContaining('partial file may remain') },
    });
  });

  it('aborts a file-stream sink when the conversion is invalid', async () => {
    const t = exportSetup({ fileStreamSave: true });
    t.ctl.dispatch({ type: 'export' });
    await flush();
    t.reject(new ConversionInvalidError([{ track: 'video', reason: 'no_encodable_target_codec' }]));
    await flush();
    expect(t.sink.abort).toHaveBeenCalled();
    expect(t.ctl.getState()).toMatchObject({
      kind: 'prepare',
      notice: {
        tone: 'error',
        title: 'This video cannot be exported with these settings',
        message: expect.stringContaining('partial file may remain'),
      },
    });
  });

  it('describes a file-stream output from the settings and bytes written', async () => {
    const t = exportSetup({ fileStreamSave: true });
    t.ctl.dispatch({ type: 'export' });
    await flush();
    t.progress(1, 5000);
    t.resolve();
    await flush();
    await flush();
    expect(t.readSource).not.toHaveBeenCalled();
    expect(t.ctl.getState()).toMatchObject({
      kind: 'result',
      output: {
        blob: null,
        url: null,
        sizeBytes: 5000,
        info: { sizeBytes: 5000, video: { codec: 'avc', displayWidth: 1920, displayHeight: 1080 } },
      },
    });
  });

  async function toResult(t: ReturnType<typeof exportSetup>) {
    t.ctl.dispatch({ type: 'export' });
    await flush();
    t.resolve();
    await flush();
    await flush();
    const s = t.ctl.getState();
    if (s.kind !== 'result') throw new Error('Expected result');
    return s;
  }

  it('retries an oversized target with a lower bitrate and preserves the target across tabs', async () => {
    const t = exportSetup({ outputBytes: 400_000 });
    const initial = t.ctl.getState();
    if (initial.kind !== 'prepare') throw new Error('Expected prepare');
    expect(allSettingsChangeCount(initial)).toBe(0);
    t.ctl.dispatch({
      type: 'setSettings',
      value: { ...initial.settings, targetSizeMB: 0.2, passthrough: false },
    });
    const result = await toResult(t);
    const bitrate = result.settings.video!.bitrate;
    t.ctl.dispatch({ type: 'smaller' });
    const retry = t.ctl.getState();
    if (retry.kind !== 'prepare') throw new Error('Expected prepare');
    expect(retry.settings.targetSizeMB).toBe(0.2);
    expect(retry.settings.video!.bitrate).toBe(Math.floor(bitrate * 0.5 * 0.92));
    t.ctl.dispatch({ type: 'setTool', tool: 'gif' });
    t.ctl.dispatch({ type: 'setTool', tool: 'shrink' });
    expect(t.ctl.getState()).toMatchObject({ settings: retry.settings });
    t.ctl.dispatch({ type: 'setSettings', value: { ...retry.settings, targetSizeMB: 0.3 } });
    const retargeted = t.ctl.getState();
    if (retargeted.kind !== 'prepare') throw new Error('Expected prepare');
    expect(retargeted.settings.targetRetryScale).toBeUndefined();
    t.ctl.dispatch({ type: 'setSettings', value: { ...retry.settings } });
    t.ctl.dispatch({ type: 'setTrim', value: { start: 0, end: 1.5 } });
    const trimmed = t.ctl.getState();
    if (trimmed.kind !== 'prepare') throw new Error('Expected prepare');
    expect(trimmed.settings.video!.bitrate).toBeGreaterThan(bitrate);
    expect(trimmed.settings.targetRetryScale).toBeUndefined();
  });

  it('Make it smaller picks the next size step and revokes the output URL', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const t = exportSetup({ outputBytes: 1_000_000 });
    const result = await toResult(t);
    t.ctl.dispatch({ type: 'smaller' });
    expect(t.ctl.getState()).toMatchObject({
      kind: 'prepare',
      settings: { passthrough: false, video: { width: 1280, height: 720 } },
    });
    expect(revoke).toHaveBeenCalledWith(result.output.url);
    expect(t.input.dispose).not.toHaveBeenCalled();
    revoke.mockRestore();
  });

  it('Make it smaller lowers quality when no smaller size exists, and says so', async () => {
    const small = source({
      video: { ...info('x').video!, displayWidth: 640, displayHeight: 360, bitrate: 340_000 },
    });
    const t = exportSetup({ src: small, outputBytes: 1_000_000 });
    const result = await toResult(t);
    const before = result.settings.video!.bitrate;
    t.ctl.dispatch({ type: 'smaller' });
    const s = t.ctl.getState();
    expect(s).toMatchObject({
      kind: 'prepare',
      settings: { video: { width: 640, height: 360 } },
      notice: { message: expect.stringContaining('quality') },
    });
    if (s.kind !== 'prepare') return;
    expect(s.settings.video!.bitrate).toBe(Math.round(before * 0.75));
  });

  it('Start over revokes the output URL and disposes the source Input', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const t = exportSetup();
    const result = await toResult(t);
    t.ctl.dispatch({ type: 'reset' });
    expect(t.ctl.getState()).toEqual({ kind: 'drop' });
    expect(revoke).toHaveBeenCalledWith(result.output.url);
    expect(t.input.dispose).toHaveBeenCalledTimes(1);
    revoke.mockRestore();
  });

  describe('extract audio', () => {
    const withAudio = (over: Partial<SourceInfo> = {}) =>
      source({
        audio: { codec: 'aac', decodable: true, channels: 2, sampleRate: 48_000, bitrate: 128_000 },
        ...over,
      });
    type Prepare = Extract<AppState, { kind: 'prepare' }>;
    const prepare = (t: ReturnType<typeof exportSetup>): Prepare => {
      const s = t.ctl.getState();
      if (s.kind !== 'prepare') throw new Error(`Expected prepare, got ${s.kind}`);
      return s;
    };
    const audioSetup = (opts: Parameters<typeof exportSetup>[0] = {}) => {
      const t = exportSetup({ src: withAudio(), name: 'x.mov', ...opts });
      t.ctl.dispatch({ type: 'setTool', tool: 'audio' });
      return t;
    };
    const setFormat = (t: ReturnType<typeof exportSetup>, format: AudioFormat) =>
      t.ctl.dispatch({
        type: 'setAudioSettings',
        value: { ...prepare(t).audioSettings!, format },
      });

    it('starts on Shrink with automatic audio settings', () => {
      const t = exportSetup({ src: withAudio() });
      expect(prepare(t)).toMatchObject({
        tool: 'shrink',
        audioAuto: { format: 'mp3', bitrate: 128_000, channels: 2, trim: { start: 0, end: 3 } },
      });
      expect(prepare(t).audioSettings).toEqual(prepare(t).audioAuto);
    });

    it('disables the audio tool for a source without audio', () => {
      const t = exportSetup();
      expect(prepare(t)).toMatchObject({ tool: 'shrink', audioAuto: null, audioSettings: null });
      t.ctl.dispatch({ type: 'setTool', tool: 'audio' });
      expect(prepare(t).tool).toBe('shrink');
    });

    it('keeps Shrink and audio overrides across tool switches', () => {
      const t = exportSetup({ src: withAudio() });
      const shrink = prepare(t).settings;
      t.ctl.dispatch({
        type: 'setSettings',
        value: { ...shrink, video: { ...shrink.video!, width: 1280, height: 720 } },
      });
      const shrinkChanged = prepare(t).settings;
      t.ctl.dispatch({ type: 'setTool', tool: 'audio' });
      t.ctl.dispatch({
        type: 'setAudioSettings',
        value: { ...prepare(t).audioSettings!, format: 'm4a', bitrate: 96_000 },
      });
      const audioChanged = prepare(t).audioSettings;
      expect(audioChanged).toMatchObject({ format: 'm4a', bitrate: 96_000 });
      t.ctl.dispatch({ type: 'setTool', tool: 'shrink' });
      expect(prepare(t)).toMatchObject({ tool: 'shrink', audioSettings: audioChanged });
      expect(prepare(t).settings).toEqual(shrinkChanged);
      t.ctl.dispatch({ type: 'setTool', tool: 'audio' });
      expect(prepare(t)).toMatchObject({ tool: 'audio', audioSettings: audioChanged });
      expect(prepare(t).settings).toEqual(shrinkChanged);
    });

    it('shares the trim between both tools', () => {
      const t = audioSetup();
      t.ctl.dispatch({ type: 'setTrim', value: { start: 1, end: 2 } });
      expect(prepare(t)).toMatchObject({
        settings: { trim: { start: 1, end: 2 } },
        audioSettings: { trim: { start: 1, end: 2 } },
      });
    });

    it.each(['shrink', 'audio', 'gif'] as const)(
      'restores full trim from %s across all tools',
      (tool) => {
        const t = audioSetup();
        t.ctl.dispatch({ type: 'setTool', tool });
        t.ctl.dispatch({ type: 'setTrim', value: { start: 1, end: 2 } });
        const fullTrim = { start: 0, end: prepare(t).source.durationSec };
        t.ctl.dispatch({ type: 'setTrim', value: fullTrim });
        expect(prepare(t)).toMatchObject({
          tool,
          settings: { trim: fullTrim },
          audioSettings: { trim: fullTrim },
          gifSettings: { trim: fullTrim },
        });
      },
    );

    it('ignores trim in audio settings changes', () => {
      const t = audioSetup();
      t.ctl.dispatch({ type: 'setTrim', value: { start: 1, end: 2 } });
      t.ctl.dispatch({
        type: 'setAudioSettings',
        value: { ...prepare(t).audioSettings!, bitrate: 96_000, trim: { start: 0, end: 3 } },
      });
      expect(prepare(t)).toMatchObject({
        settings: { trim: { start: 1, end: 2 } },
        audioSettings: { bitrate: 96_000, trim: { start: 1, end: 2 } },
      });
    });

    it('ignores trim in Shrink settings changes', () => {
      const t = audioSetup();
      t.ctl.dispatch({ type: 'setTrim', value: { start: 1, end: 2 } });
      t.ctl.dispatch({
        type: 'setSettings',
        value: { ...prepare(t).settings, trim: { start: 0, end: 3 } },
      });
      expect(prepare(t)).toMatchObject({
        settings: { trim: { start: 1, end: 2 } },
        audioSettings: { trim: { start: 1, end: 2 } },
      });
    });

    it('validates audio settings and ignores their trim', () => {
      const t = audioSetup();
      t.ctl.dispatch({
        type: 'setAudioSettings',
        value: { ...prepare(t).audioSettings!, bitrate: 12_345, trim: { start: -1, end: 99 } },
      });
      expect(prepare(t).audioSettings).toMatchObject({
        bitrate: 128_000,
        trim: { start: 0, end: 3 },
      });
    });

    it('exports MP3 after loading the encoder, before the sink opens', async () => {
      const t = audioSetup();
      const settings = prepare(t).audioSettings!;
      t.ctl.dispatch({ type: 'export' });
      await flush();
      expect(t.ensureMp3Encoder).toHaveBeenCalledTimes(1);
      expect(t.openSink).toHaveBeenCalledWith(
        { kind: 'memory', warn: false },
        'x-audio.mp3',
        'audio/mpeg',
      );
      expect(t.ensureMp3Encoder.mock.invocationCallOrder[0]!).toBeLessThan(
        (t.openSink as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!,
      );
      expect(t.canEncodeVideo).not.toHaveBeenCalled();
      const args = t.startConversion.mock.calls[0]?.[0] as Parameters<
        AppDeps['startConversion']
      >[0];
      expect(args.job).toEqual(audioExtractJob(settings));
      expect(args.format).toBeInstanceOf(Mp3OutputFormat);
      expect(t.ctl.getState()).toMatchObject({
        kind: 'working',
        tool: 'audio',
        outputName: 'x-audio.mp3',
      });
    });

    it('exports M4A without loading the MP3 encoder', async () => {
      const t = audioSetup();
      setFormat(t, 'm4a');
      t.ctl.dispatch({ type: 'export' });
      await flush();
      expect(t.ensureMp3Encoder).not.toHaveBeenCalled();
      expect(t.openSink).toHaveBeenCalledWith(
        { kind: 'memory', warn: false },
        'x-audio.m4a',
        'audio/mp4',
      );
    });

    it('stops with a notice and no sink when the MP3 encoder cannot load', async () => {
      const t = audioSetup({
        ensureMp3Encoder: async () => {
          throw new Error('no encoder');
        },
      });
      const before = prepare(t).audioSettings;
      t.ctl.dispatch({ type: 'export' });
      await flush();
      expect(t.openSink).not.toHaveBeenCalled();
      expect(prepare(t)).toMatchObject({
        tool: 'audio',
        audioSettings: before,
        notice: {
          tone: 'error',
          title: 'MP3 encoding is unavailable',
          message: 'The MP3 encoder could not be loaded. Choose M4A or WAV, or try again.',
        },
      });
    });

    it('warns before a large in-memory audio export', async () => {
      const t = audioSetup({ src: withAudio({ durationSec: 4000 }), deviceMemoryGB: 1 });
      setFormat(t, 'wav');
      t.ctl.dispatch({ type: 'export' });
      await flush();
      expect(t.openSink).not.toHaveBeenCalled();
      expect(prepare(t)).toMatchObject({ notice: { tone: 'warn', confirm: 'memory' } });
      t.ctl.dispatch({ type: 'setTool', tool: 'shrink' });
      expect(prepare(t).notice).toBeUndefined();
      t.ctl.dispatch({ type: 'setTool', tool: 'audio' });
      t.ctl.dispatch({ type: 'export', confirmed: true });
      await flush();
      expect(t.openSink).toHaveBeenCalledWith(
        { kind: 'memory', warn: true },
        'x-audio.wav',
        'audio/wav',
      );
    });

    it('an audio settings change drops a pending memory confirm', async () => {
      const t = audioSetup({ src: withAudio({ durationSec: 4000 }), deviceMemoryGB: 1 });
      setFormat(t, 'wav');
      t.ctl.dispatch({ type: 'export' });
      await flush();
      expect(prepare(t)).toMatchObject({ notice: { confirm: 'memory' } });
      t.ctl.dispatch({
        type: 'setAudioSettings',
        value: { ...prepare(t).audioSettings!, channels: 1 },
      });
      expect(prepare(t).notice).toBeUndefined();
    });

    it('names the format when the conversion fails', async () => {
      const t = audioSetup();
      t.ctl.dispatch({ type: 'export' });
      await flush();
      t.reject(new Error('boom'));
      await flush();
      expect(prepare(t)).toMatchObject({
        tool: 'audio',
        notice: {
          tone: 'error',
          title: 'The MP3 export failed',
          message: expect.stringContaining('another format'),
        },
      });
    });

    it('ignores a tool switch while working', async () => {
      const t = audioSetup();
      t.ctl.dispatch({ type: 'export' });
      await flush();
      t.ctl.dispatch({ type: 'setTool', tool: 'shrink' });
      expect(t.ctl.getState()).toMatchObject({ kind: 'working', tool: 'audio' });
    });

    describe('while the MP3 encoder loads', () => {
      const pendingSetup = () => {
        let loaded!: () => void;
        const t = audioSetup({
          ensureMp3Encoder: () =>
            new Promise<void>((resolve) => {
              loaded = resolve;
            }),
        });
        t.ctl.dispatch({ type: 'export' });
        return { t, loaded: () => loaded() };
      };

      it('marks the export pending and ignores a second Export', async () => {
        const { t, loaded } = pendingSetup();
        await flush();
        expect(prepare(t).exporting).toBe(true);
        t.ctl.dispatch({ type: 'export' });
        await flush();
        expect(t.ensureMp3Encoder).toHaveBeenCalledTimes(1);
        loaded();
        await flush();
        expect(t.openSink).toHaveBeenCalledTimes(1);
        expect(t.ctl.getState().kind).toBe('working');
      });

      const changes: [string, (t: ReturnType<typeof exportSetup>) => void][] = [
        ['a tab switch', (t) => t.ctl.dispatch({ type: 'setTool', tool: 'shrink' })],
        ['a trim change', (t) => t.ctl.dispatch({ type: 'setTrim', value: { start: 1, end: 3 } })],
        [
          'an audio settings change',
          (t) =>
            t.ctl.dispatch({
              type: 'setAudioSettings',
              value: { ...prepare(t).audioSettings!, bitrate: 192_000 },
            }),
        ],
        [
          'a Shrink settings change',
          (t) => t.ctl.dispatch({ type: 'setSettings', value: prepare(t).settings }),
        ],
      ];
      it.each(changes)('%s drops the pending export', async (_, change) => {
        const { t, loaded } = pendingSetup();
        await flush();
        change(t);
        expect(prepare(t).exporting).toBeFalsy();
        loaded();
        await flush();
        expect(t.openSink).not.toHaveBeenCalled();
        expect(t.ctl.getState().kind).toBe('prepare');
        const tool = prepare(t).tool;
        t.ctl.dispatch({ type: 'export' });
        await flush();
        if (tool === 'audio') loaded();
        await flush();
        expect(t.openSink).toHaveBeenCalledTimes(1);
      });
    });

    it.each([
      [
        'a tab switch',
        (t: ReturnType<typeof exportSetup>) => t.ctl.dispatch({ type: 'setTool', tool: 'shrink' }),
      ],
      [
        'a trim change',
        (t: ReturnType<typeof exportSetup>) =>
          t.ctl.dispatch({ type: 'setTrim', value: { start: 1, end: 3 } }),
      ],
      [
        'an audio settings change',
        (t: ReturnType<typeof exportSetup>) =>
          t.ctl.dispatch({
            type: 'setAudioSettings',
            value: { ...prepare(t).audioSettings!, bitrate: 192_000 },
          }),
      ],
      [
        'a Shrink settings change',
        (t: ReturnType<typeof exportSetup>) =>
          t.ctl.dispatch({ type: 'setSettings', value: prepare(t).settings }),
      ],
    ])('%s aborts a sink opened after the change', async (_, change) => {
      let resolveSink!: (sink: Awaited<ReturnType<AppDeps['openSink']>>) => void;
      const openSink = vi.fn(
        () =>
          new Promise<Awaited<ReturnType<AppDeps['openSink']>>>((resolve) => {
            resolveSink = resolve;
          }),
      );
      const t = audioSetup({ openSink });
      t.ctl.dispatch({ type: 'export' });
      await flush();
      expect(openSink).toHaveBeenCalledTimes(1);
      change(t);
      expect(prepare(t).exporting).toBeFalsy();
      resolveSink(t.sink as unknown as Awaited<ReturnType<AppDeps['openSink']>>);
      await flush();
      expect(t.sink.abort).toHaveBeenCalledTimes(1);
      expect(t.startConversion).not.toHaveBeenCalled();
      expect(t.ctl.getState().kind).toBe('prepare');
    });

    it('suggests a lower bitrate, not a smaller size, in the memory warning', async () => {
      const t = audioSetup({ src: withAudio({ durationSec: 4000 }), deviceMemoryGB: 1 });
      setFormat(t, 'wav');
      t.ctl.dispatch({ type: 'export' });
      await flush();
      const message = prepare(t).notice?.message ?? '';
      expect(message).not.toContain('smaller size');
      expect(message).toContain('lower bitrate or another format');
    });

    it('names the audio in an invalid-conversion notice', async () => {
      const t = audioSetup();
      t.ctl.dispatch({ type: 'export' });
      await flush();
      t.reject(
        new ConversionInvalidError([{ track: 'audio', reason: 'undecodable_source_codec' }]),
      );
      await flush();
      expect(prepare(t).notice).toMatchObject({
        tone: 'error',
        title: 'This audio cannot be extracted with these settings',
      });
    });

    it('Make it smaller lowers the audio bitrate and stays on the audio tool', async () => {
      const t = audioSetup({ outputBytes: 1_000_000 });
      await toResult(t);
      t.ctl.dispatch({ type: 'smaller' });
      expect(prepare(t)).toMatchObject({
        tool: 'audio',
        audioSettings: { bitrate: 96_000 },
        notice: { title: 'Settings changed to make it smaller' },
      });
    });

    it('Make it smaller at the lowest bitrate leaves settings unchanged', async () => {
      const t = audioSetup({ outputBytes: 1_000_000 });
      t.ctl.dispatch({
        type: 'setAudioSettings',
        value: { ...prepare(t).audioSettings!, bitrate: 64_000 },
      });
      const before = prepare(t).audioSettings;
      await toResult(t);
      t.ctl.dispatch({ type: 'smaller' });
      expect(prepare(t)).toMatchObject({
        tool: 'audio',
        audioSettings: before,
        notice: { title: 'This is as small as these settings go' },
      });
    });

    it('a tool switch from the result returns to prepare on that tool', async () => {
      const revoke = vi.spyOn(URL, 'revokeObjectURL');
      const t = audioSetup();
      const result = await toResult(t);
      t.ctl.dispatch({ type: 'setTool', tool: 'shrink' });
      expect(prepare(t)).toMatchObject({ tool: 'shrink' });
      expect(prepare(t).notice).toBeUndefined();
      expect(revoke).toHaveBeenCalledWith(result.output.url);
      revoke.mockRestore();
    });

    it('describes a file-stream audio output from the settings and bytes written', async () => {
      const t = audioSetup({ fileStreamSave: true });
      t.ctl.dispatch({ type: 'setTrim', value: { start: 1, end: 2.5 } });
      t.ctl.dispatch({ type: 'export' });
      await flush();
      t.progress(1, 4000);
      t.resolve();
      await flush();
      await flush();
      expect(t.readSource).not.toHaveBeenCalled();
      const s = t.ctl.getState();
      if (s.kind !== 'result') throw new Error('Expected result');
      expect(s.output).toMatchObject({ blob: null, url: null, sizeBytes: 4000 });
      expect(s.output.info).toEqual({
        name: 'x-audio.mp3',
        sizeBytes: 4000,
        durationSec: 1.5,
        containerMime: 'audio/mpeg',
        video: null,
        audio: { codec: 'mp3', decodable: true, channels: 2, sampleRate: 48_000, bitrate: 128_000 },
      });
    });

    it('reports the PCM bitrate for a file-stream WAV output', async () => {
      const t = audioSetup({ fileStreamSave: true });
      const s0 = t.ctl.getState();
      if (s0.kind !== 'prepare' || !s0.audioSettings) throw new Error('Expected prepare');
      t.ctl.dispatch({ type: 'setAudioSettings', value: { ...s0.audioSettings, format: 'wav' } });
      t.ctl.dispatch({ type: 'export' });
      await flush();
      t.progress(1, 4000);
      t.resolve();
      await flush();
      await flush();
      const s = t.ctl.getState();
      if (s.kind !== 'result') throw new Error('Expected result');
      expect(s.output.info.audio).toMatchObject({ codec: 'pcm-s16', bitrate: 48_000 * 2 * 16 });
    });

    it('reset clears both tools', async () => {
      const t = audioSetup();
      await toResult(t);
      t.ctl.dispatch({ type: 'reset' });
      expect(t.ctl.getState()).toEqual({ kind: 'drop' });
    });
  });
});

describe('reset all', () => {
  it.each(['shrink', 'audio', 'gif'] as const)(
    'restores load-time defaults and keeps the file and %s tab',
    async (tool) => {
      const added = {
        file: fakeFile('music.mp4'),
        input: fakeInput(),
        duration: 2,
        channels: 1,
        sampleRate: 48000,
      };
      const ctl = createController(
        { readAddedAudio: async () => added } as unknown as AppDeps,
        () => {},
      );
      const source = {
        ...info('clip.mp4'),
        audio: { codec: 'aac', decodable: true, channels: 2, sampleRate: 48000, bitrate: 128000 },
      };
      const input = fakeInput();
      const file = fakeFile(source.name);
      ctl.dispatch({ type: 'loaded', file, input, source, caps, auto: autoSettings(source, caps) });
      const initial = ctl.getState();
      if (initial.kind !== 'prepare') throw new Error('Expected prepare');
      expect(allSettingsChangeCount(initial)).toBe(0);

      ctl.dispatch({ type: 'setTrim', value: { start: 0.5, end: 2 } });
      const overlays = defaultOverlays();
      overlays.text.enabled = true;
      overlays.text.content = 'Reset this caption';
      ctl.dispatch({
        type: 'setSettings',
        value: {
          ...initial.settings,
          overlays,
          trimPrecision: 'exact',
          metadata: { title: 'changed', strip: true },
          transform: { rotate: 90, flip: true, crop: 'square' },
          style: {
            id: 'grain',
            intensity: 0.7,
            detail: 0.4,
            colorA: '#172448',
            colorB: '#f5bd69',
            correction: { exposure: 1 },
          },
        },
      });
      ctl.dispatch({
        type: 'setAudioSettings',
        value: { ...initial.audioSettings!, format: 'wav', channels: 1 },
      });
      ctl.dispatch({
        type: 'setGifSettings',
        value: { ...initial.gifSettings!, colors: 64, loop: 'once', compression: 'small' },
      });
      ctl.dispatch({
        type: 'setAudioProcessing',
        value: { gainDb: -6, fadeIn: 0.2, fadeOut: 0.3, normalize: -16 },
      });
      ctl.dispatch({ type: 'addAudio', file: added.file });
      await flush();
      ctl.dispatch({
        type: 'setMix',
        value: {
          original: { include: false, volumeDb: -3 },
          added: { volumeDb: -6, offset: 0.5, loop: true },
        },
      });
      ctl.dispatch({ type: 'setTool', tool });
      const changed = ctl.getState();
      if (changed.kind !== 'prepare') throw new Error('Expected prepare');
      expect(allSettingsChangeCount(changed)).toBeGreaterThan(0);

      ctl.dispatch({ type: 'resetAll' });
      const reset = ctl.getState();
      if (reset.kind !== 'prepare') throw new Error('Expected prepare');
      expect(allSettingsChangeCount(reset)).toBe(0);
      expect(reset.settings).toEqual(initial.settings);
      expect(reset.audioAuto).toEqual(initial.audioAuto);
      expect(reset.audioSettings).toEqual(initial.audioSettings);
      expect(reset.gifSettings).toEqual(initial.gifSettings);
      expect(reset.file).toBe(file);
      expect(reset.input).toBe(input);
      expect(reset.tool).toBe(tool);
      expect(reset.addedAudio).toBeUndefined();
      expect(reset.overlayAssets).toBeUndefined();

      expect(added.input.dispose).toHaveBeenCalledOnce();
      expect(input.dispose).not.toHaveBeenCalled();
    },
  );
});

it('resetAll aborts pending added audio and disposes its late result', async () => {
  let finish!: (audio: AddedAudio) => void;
  let signal!: AbortSignal;
  const ctl = createController(
    {
      readAddedAudio: (_file, value) => {
        signal = value;
        return new Promise<AddedAudio>((resolve) => {
          finish = resolve;
        });
      },
    } as AppDeps,
    () => {},
  );
  const source = info('clip.mp4');
  ctl.dispatch({
    type: 'loaded',
    file: fakeFile(source.name),
    source,
    input: fakeInput(),
    auto: autoSettings(source, caps),
    caps,
  });
  ctl.dispatch({ type: 'addAudio', file: fakeFile('music.mp4') });
  ctl.dispatch({ type: 'resetAll' });
  const reset = ctl.getState();
  expect(signal.aborted).toBe(true);
  const added = {
    file: fakeFile('music.mp4'),
    input: fakeInput(),
    duration: 2,
    channels: 1,
    sampleRate: 48000,
  };
  finish(added);
  await flush();
  expect(ctl.getState()).toBe(reset);
  expect(added.input.dispose).toHaveBeenCalledOnce();
});

it('resetAll keeps an added-only audio tab selected but prevents extraction without audio', async () => {
  const added = {
    file: fakeFile('music.mp4'),
    input: fakeInput(),
    duration: 2,
    channels: 1,
    sampleRate: 48000,
  };
  const startConversion = vi.fn();
  const ctl = createController(
    { readAddedAudio: async () => added, startConversion } as unknown as AppDeps,
    () => {},
  );
  const source = info('silent.mp4');
  ctl.dispatch({
    type: 'loaded',
    file: fakeFile(source.name),
    source,
    input: fakeInput(),
    auto: autoSettings(source, caps),
    caps,
  });
  ctl.dispatch({ type: 'addAudio', file: added.file });
  await flush();
  ctl.dispatch({ type: 'setTool', tool: 'audio' });
  ctl.dispatch({ type: 'resetAll' });
  expect(ctl.getState()).toMatchObject({ tool: 'audio', audioAuto: null, audioSettings: null });
  const reset = ctl.getState();
  ctl.dispatch({ type: 'export' });
  expect(ctl.getState()).toBe(reset);
  expect(startConversion).not.toHaveBeenCalled();
});

it('resetAll does not change settings while an export is starting', async () => {
  const { ctl, pending } = setup();
  ctl.dispatch({ type: 'pick', file: fakeFile('clip.mp4') });
  await flush();
  pending[0]!.resolve();
  await flush();
  ctl.dispatch({ type: 'setTrim', value: { start: 0.5, end: 2 } });
  ctl.dispatch({ type: 'export' });
  const exporting = ctl.getState();
  expect(exporting).toMatchObject({ kind: 'prepare', exporting: true });
  ctl.dispatch({ type: 'resetAll' });
  expect(ctl.getState()).toBe(exporting);
  ctl.dispatch({ type: 'reset' });
});

it('resetAll releases the watermark and ignores a pending watermark decode', async () => {
  const image = { width: 4, height: 4, close: vi.fn() } as unknown as ImageBitmap;
  let finish!: (image: ImageBitmap) => void;
  const decode = vi
    .fn()
    .mockResolvedValueOnce(image)
    .mockImplementationOnce(
      () =>
        new Promise<ImageBitmap>((resolve) => {
          finish = resolve;
        }),
    );
  vi.stubGlobal('createImageBitmap', decode);
  try {
    const { ctl, pending } = setup();
    ctl.dispatch({ type: 'pick', file: fakeFile('clip.mp4') });
    await flush();
    pending[0]!.resolve();
    await flush();
    const file = { ...fakeFile('mark.png'), type: 'image/png' } as File;
    ctl.dispatch({ type: 'setOverlayImage', file });
    await flush();
    expect(ctl.getState()).toMatchObject({ overlayAssets: { image } });
    ctl.dispatch({ type: 'resetAll' });
    expect(image.close).toHaveBeenCalledOnce();
    ctl.dispatch({ type: 'setOverlayImage', file });
    ctl.dispatch({ type: 'resetAll' });
    const reset = ctl.getState();
    const late = { width: 4, height: 4, close: vi.fn() } as unknown as ImageBitmap;
    finish(late);
    await flush();
    expect(ctl.getState()).toBe(reset);
    expect(late.close).toHaveBeenCalledOnce();
  } finally {
    vi.unstubAllGlobals();
  }
});

it('counts settings on hidden tabs and disabled effect settings', () => {
  const ctl = createController({} as AppDeps, () => {});
  const source = {
    ...info('clip.mp4'),
    audio: { codec: 'aac', decodable: true, channels: 2, sampleRate: 48000, bitrate: 128000 },
  };
  ctl.dispatch({
    type: 'loaded',
    file: fakeFile(source.name),
    source,
    input: fakeInput(),
    auto: autoSettings(source, caps),
    caps,
  });
  const initial = ctl.getState();
  if (initial.kind !== 'prepare') throw new Error('Expected prepare');
  expect(allSettingsChangeCount(initial)).toBe(0);
  expect(
    allSettingsChangeCount({
      ...initial,
      audioSettings: { ...initial.audioSettings!, format: 'wav' },
    }),
  ).toBeGreaterThan(0);
  expect(
    allSettingsChangeCount({ ...initial, gifSettings: { ...initial.gifSettings!, loop: 'once' } }),
  ).toBeGreaterThan(0);
  const overlays = defaultOverlays();
  overlays.text.content = 'Disabled caption';
  for (const patch of [
    { trim: { start: 0.5, end: 2 } },
    { trimPrecision: 'exact' as const },
    { transform: { rotate: 90 as const, flip: false, crop: 'original' as const } },
    { style: normalizeStyle({ correction: { exposure: 1 } }) },
    { style: normalizeStyle({ intensity: 0.3 }) },
    { overlays },
    { audioProcessing: { gainDb: -3 } },
    { mix: { original: { include: false, volumeDb: 0 } } },
  ]) {
    expect(
      allSettingsChangeCount({ ...initial, settings: { ...initial.settings, ...patch } }),
    ).toBeGreaterThan(0);
  }
});

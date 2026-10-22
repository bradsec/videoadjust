import { describe, expect, it, vi } from 'vitest';
import { ConversionCanceledError, Quality, type Input } from 'mediabunny';
import { ConversionInvalidError } from '../../src/core/convert';
import { autoSettings, targetVideoBitrate } from '../../src/core/autoSettings';
import type { Capabilities, Settings, SourceInfo } from '../../src/core/types';
import { createController, LARGE_FILE_BYTES, type AppDeps } from '../../src/ui/controller';

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
    const deps = {
      probeCapabilities: () => Promise.resolve(capabilities),
      canEncodeVideo,
      readSource,
      startConversion,
      openSink,
      deviceMemoryGB: opts.deviceMemoryGB,
    } as unknown as AppDeps;
    const ctl = createController(deps, () => {});
    const input = fakeInput();
    ctl.dispatch({
      type: 'loaded',
      file: fakeFile('clip.mov', src.sizeBytes),
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

  it('stops before opening a sink when the chosen encoder settings are unavailable', async () => {
    const t = exportSetup();
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
      notice: { tone: 'warn', confirm: 'memory' },
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
      notice: { tone: 'error', message: expect.stringContaining('partial file may remain') },
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
});

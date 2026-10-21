import { describe, expect, it, vi } from 'vitest';
import type { Input } from 'mediabunny';
import type { Capabilities, SourceInfo } from '../../src/core/types';
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
  video: { codec: 'avc', decodable: true, displayWidth: 1920, displayHeight: 1080, rotation: 0, fps: 30, bitrate: 4e6 },
  audio: null,
});

const fakeFile = (name: string, size = 10) => ({ name, size }) as File;
const fakeInput = () => ({ dispose: vi.fn() }) as unknown as Input & { dispose: ReturnType<typeof vi.fn> };

/** readSource stub whose promises resolve or reject when the test says so. */
function setup(probe: AppDeps['probeCapabilities'] = () => Promise.resolve(caps)) {
  const pending: { name: string; input: ReturnType<typeof fakeInput>; resolve(): void; reject(e: unknown): void }[] = [];
  const readSource = vi.fn((file: File) => {
    const input = fakeInput();
    return new Promise<{ info: SourceInfo; input: Input }>((resolve, reject) => {
      pending.push({ name: file.name, input, resolve: () => resolve({ info: info(file.name), input }), reject });
    });
  });
  const deps = { probeCapabilities: probe, readSource, startConversion: vi.fn(), openSink: vi.fn() } as unknown as AppDeps;
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
    const probe = vi.fn<AppDeps['probeCapabilities']>().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(caps);
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
    expect(ctl.getState()).toMatchObject({ kind: 'prepare', settings: { trim: { start: 0, end: 0.1 } } });
  });
});

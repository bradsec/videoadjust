import { describe, expect, test, vi } from 'vitest';
import { ensureMp3Encoder, probeCapabilities, type ProbeDeps } from '../../src/core/capabilities';

function deps(
  overrides: {
    video?: (codec: string) => boolean | Promise<boolean>;
    aac?: boolean;
    opus?: boolean;
    fallback?: () => Promise<boolean>;
    win?: object;
  } = {},
): ProbeDeps {
  const video = overrides.video ?? (() => true);
  return {
    canEncodeVideo: vi.fn(async (codec: string) =>
      video(codec),
    ) as unknown as ProbeDeps['canEncodeVideo'],
    canEncodeAudio: vi.fn(async (codec: string) =>
      codec === 'aac' ? (overrides.aac ?? true) : (overrides.opus ?? true),
    ) as unknown as ProbeDeps['canEncodeAudio'],
    registerAacFallback: vi.fn(overrides.fallback ?? (async () => true)),
    win: (overrides.win ?? { navigator: {} }) as ProbeDeps['win'],
  };
}

describe('probeCapabilities', () => {
  test('native AAC: fallback not used or loaded', async () => {
    const d = deps({ aac: true });
    const caps = await probeCapabilities(d);
    expect(caps.audio.aac).toBe(true);
    expect(caps.aacViaFallback).toBe(false);
    expect(d.registerAacFallback).not.toHaveBeenCalled();
  });

  test('no native AAC, fallback registers: AAC via fallback', async () => {
    const caps = await probeCapabilities(deps({ aac: false, fallback: async () => true }));
    expect(caps.audio.aac).toBe(true);
    expect(caps.aacViaFallback).toBe(true);
  });

  test('no native AAC and no fallback: no AAC', async () => {
    const caps = await probeCapabilities(deps({ aac: false, fallback: async () => false }));
    expect(caps.audio.aac).toBe(false);
    expect(caps.aacViaFallback).toBe(false);
  });

  test('a rejecting fallback counts as no AAC', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const caps = await probeCapabilities(
      deps({ aac: false, fallback: () => Promise.reject(new Error('chunk failed')) }),
    );
    expect(caps.audio.aac).toBe(false);
    expect(caps.aacViaFallback).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  test('probes every video codec at 1280x720 30 fps', async () => {
    const d = deps();
    const caps = await probeCapabilities(d);
    expect(caps.video).toEqual({ avc: true, hevc: true, av1: true, vp9: true });
    for (const codec of ['avc', 'hevc', 'av1', 'vp9']) {
      expect(d.canEncodeVideo).toHaveBeenCalledWith(codec, {
        width: 1280,
        height: 720,
        frameRate: 30,
      });
    }
  });

  test('a rejecting canEncodeVideo counts as false and does not throw', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const caps = await probeCapabilities(
      deps({
        video: (codec) => {
          if (codec === 'hevc') throw new Error('boom');
          return codec !== 'av1';
        },
      }),
    );
    expect(caps.video).toEqual({ avc: true, hevc: false, av1: false, vp9: true });
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  test('opus reflects canEncodeAudio', async () => {
    const caps = await probeCapabilities(deps({ opus: false }));
    expect(caps.audio.opus).toBe(false);
  });

  test('fileStreamSave reflects showSaveFilePicker in window', async () => {
    const withPicker = await probeCapabilities(
      deps({ win: { navigator: {}, showSaveFilePicker: () => {} } }),
    );
    const without = await probeCapabilities(deps({ win: { navigator: {} } }));
    expect(withPicker.fileStreamSave).toBe(true);
    expect(without.fileStreamSave).toBe(false);
  });

  test('shareFiles asks canShare about an mp4 file', async () => {
    const canShare = vi.fn(() => true);
    const caps = await probeCapabilities(deps({ win: { navigator: { canShare } } }));
    expect(caps.shareFiles).toBe(true);
    const arg = (canShare.mock.calls[0] as unknown as [{ files: File[] }])[0];
    expect(arg.files).toHaveLength(1);
    expect(arg.files[0]!.name).toBe('x.mp4');
    expect(arg.files[0]!.type).toBe('video/mp4');
  });

  test('shareFiles is false without canShare or when it returns non-true', async () => {
    expect((await probeCapabilities(deps({ win: { navigator: {} } }))).shareFiles).toBe(false);
    const falsy = await probeCapabilities(deps({ win: { navigator: { canShare: () => false } } }));
    expect(falsy.shareFiles).toBe(false);
  });
});

const { registerAacEncoder } = vi.hoisted(() => ({ registerAacEncoder: vi.fn() }));
vi.mock('@mediabunny/aac-encoder', () => ({ registerAacEncoder }));

describe('registerAacFallback', () => {
  test('registers the encoder once per page', async () => {
    const { registerAacFallback } = await import('../../src/core/capabilities');
    expect(await registerAacFallback()).toBe(true);
    expect(await registerAacFallback()).toBe(true);
    expect(registerAacEncoder).toHaveBeenCalledTimes(1);
  });
});

describe('ensureMp3Encoder', () => {
  test('registers the bundled encoder even when the browser claims native MP3', async () => {
    const register = vi.fn(async () => true);
    await ensureMp3Encoder({ register });
    expect(register).toHaveBeenCalledTimes(1);
  });

  test('a failed registration rejects and the next call retries', async () => {
    const register = vi
      .fn<() => Promise<boolean>>()
      .mockRejectedValueOnce(new Error('chunk failed'))
      .mockResolvedValueOnce(true);
    const d = { register };
    await expect(ensureMp3Encoder(d)).rejects.toThrow('chunk failed');
    await expect(ensureMp3Encoder(d)).resolves.toBeUndefined();
    expect(register).toHaveBeenCalledTimes(2);
  });

  test('a fallback reporting false rejects', async () => {
    const register = vi.fn(async () => false);
    await expect(ensureMp3Encoder({ register })).rejects.toThrow(/MP3/);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readSource, UnsupportedSourceError } from '../../src/core/source';

const mock = vi.hoisted(() => ({
  video: null as null | Record<string, unknown>,
  audio: null as null | Record<string, unknown>,
  dispose: vi.fn(),
}));

vi.mock('mediabunny', async (importOriginal) => ({
  ...(await importOriginal<typeof import('mediabunny')>()),
  Input: class {
    dispose = mock.dispose;
    getPrimaryVideoTrack = async () => mock.video;
    getPrimaryAudioTrack = async () => mock.audio;
    getMimeType = async () => 'video/mp4';
    computeDuration = async () => 3;
  },
}));

const audio = () => ({
  getCodec: async () => 'aac',
  canDecode: async () => true,
  getNumberOfChannels: async () => 2,
  getSampleRate: async () => 48000,
  computePacketStats: async () => ({ averageBitrate: 128_000 }),
});

beforeEach(() => {
  mock.video = null;
  mock.audio = null;
  mock.dispose.mockClear();
});

describe('readSource', () => {
  it('rejects an undecodable primary video even when audio decodes', async () => {
    mock.video = {
      getCodec: async () => 'hevc',
      canDecode: async () => false,
      getDisplayWidth: async () => 1920,
      getDisplayHeight: async () => 1080,
      getRotation: async () => 0,
      computePacketStats: async () => ({ averagePacketRate: 30, averageBitrate: 2e6 }),
    };
    mock.audio = audio();
    await expect(readSource(new File([], 'clip.mov'))).rejects.toMatchObject({
      name: 'UnsupportedSourceError',
      codec: 'hevc',
      message: expect.stringContaining('hevc'),
    } satisfies Partial<UnsupportedSourceError>);
    expect(mock.dispose).toHaveBeenCalledOnce();
  });

  it('accepts an audio-only file', async () => {
    mock.audio = audio();
    const result = await readSource(new File([], 'voice.m4a'));
    expect(result.info.video).toBeNull();
    expect(result.info.audio?.codec).toBe('aac');
  });
});

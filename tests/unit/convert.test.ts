import {
  Mp3OutputFormat,
  Mp4OutputFormat,
  Quality,
  WavOutputFormat,
  WebMOutputFormat,
  BufferTarget,
  Conversion,
  ConversionCanceledError,
  type Input,
} from 'mediabunny';
import { describe, expect, it, vi } from 'vitest';
import {
  audioExtractJob,
  cutVideoFrameTiming,
  createAudioOutputFormat,
  createOutputFormat,
  discardedPrimaryTracks,
  shrinkJob,
  toConversionOptions,
  writesWhileEncoding,
  startConversion,
} from '../../src/core/convert';
import type { AudioExtractSettings } from '../../src/core/audioExtract';
import type { Settings } from '../../src/core/types';
import { cropRectangle, outputSize, rotatedSize } from '../../src/core/videoGeometry';
import type { AddedAudio } from '../../src/core/audioMix';

const base: Settings = {
  container: 'mp4',
  passthrough: false,
  trim: { start: 0.5, end: 2 },
  video: { codec: 'avc', width: 1920, height: 1080, fps: 30, bitrate: 4_000_000 },
  audio: { codec: 'aac', bitrate: 128_000, channels: 2, copy: false },
};

const audio: AudioExtractSettings = {
  format: 'mp3',
  trim: { start: 0.5, end: 2 },
  bitrate: 128_000,
  channels: 2,
  copy: false,
};

describe('conversion jobs', () => {
  it('clips a frame at each joined range boundary', () => {
    const ranges = [
      { start: 0, end: 1 },
      { start: 2, end: 3 },
    ];
    expect(cutVideoFrameTiming(0.96, 0.1, ranges)?.timestamp).toBeCloseTo(0.96);
    expect(cutVideoFrameTiming(0.96, 0.1, ranges)?.duration).toBeCloseTo(0.04);
    expect(cutVideoFrameTiming(1.1, 0.1, ranges)).toBeNull();
    expect(cutVideoFrameTiming(2, 0.1, ranges)).toEqual({ timestamp: 1, duration: 0.1 });
  });
  it('re-encodes joined video and mixes audio when sections are cut', () => {
    const job = shrinkJob({
      ...base,
      passthrough: true,
      cuts: [{ start: 0.8, end: 1.1 }],
    });
    expect(job.copiesVideo).toBe(false);
    expect(job.options.video).toMatchObject({
      forceTranscode: true,
      process: expect.any(Function),
    });
    expect(job.options.audio).toEqual({ discard: true });
    expect(job.customAudio).toBeDefined();
    expect(
      audioExtractJob({ ...audio, cuts: [{ start: 0.8, end: 1.1 }] }).customAudio,
    ).toBeDefined();
  });
  it('re-encodes Fit at the foreground size and emits the fitted frame size', () => {
    const source = {
      video: { displayWidth: 1920, displayHeight: 1080 },
    } as Parameters<typeof shrinkJob>[1];
    const job = shrinkJob(
      {
        ...base,
        passthrough: true,
        fit: { aspect: '1:1', background: 'black', color: '#ffffff' },
        video: { ...base.video!, width: 1080, height: 1080 },
      },
      source,
    );
    expect(job.copiesVideo).toBe(false);
    expect(job.options.video).toMatchObject({
      width: 1080,
      height: 608,
      processedWidth: 1080,
      processedHeight: 1080,
      forceTranscode: true,
      process: expect.any(Function),
    });
  });
  it('keeps neutral mixes on the existing copy path and discards excluded originals', () => {
    const mix = { original: { include: true, volumeDb: 0 } };
    expect(shrinkJob({ ...base, passthrough: true, mix }).options.audio).toEqual({});
    expect(audioExtractJob({ ...audio, format: 'm4a', copy: true, mix }).options.audio).toEqual({
      codec: 'aac',
      forceTranscode: false,
    });
    const removed = shrinkJob({ ...base, mix: { original: { include: false, volumeDb: 0 } } });
    expect(removed.options.audio).toEqual({ discard: true });
    expect(removed.keeps.audio).toBe(false);
  });

  it('uses one custom audio source for mixes while preserving video copy', () => {
    const mix = {
      original: { include: false, volumeDb: 0 },
      added: { volumeDb: 0, offset: 0, loop: false },
    };
    const added = {} as AddedAudio;
    const job = shrinkJob({ ...base, passthrough: true, mix }, undefined, {}, added);
    expect(job.copiesVideo).toBe(true);
    expect(job.options.audio).toEqual({ discard: true });
    expect(job.customAudio).toBeDefined();
    expect(job.keeps.audio).toBe(true);
    expect(
      audioExtractJob({ ...audio, format: 'wav', mix }, added).customAudio?.encoding.codec,
    ).toBe('pcm-s16');
  });
  it('cancels during analysis before starting the encoder', async () => {
    const init = vi.spyOn(Conversion, 'init');
    const cleanup = vi.fn();
    const progress = vi.fn();
    const task = startConversion({
      input: {} as Input,
      target: new BufferTarget(),
      format: new Mp4OutputFormat(),
      onProgress: progress,
      job: {
        options: {},
        keeps: { video: false, audio: true },
        cleanup,
        prepare: async (_input, signal, report) => {
          report(0.25);
          await new Promise<void>((_resolve, reject) =>
            signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
          );
        },
      },
    });
    try {
      await task.cancel();
      await expect(task.done).rejects.toBeInstanceOf(ConversionCanceledError);
      expect(progress).toHaveBeenCalledWith(0.25, 0, 'analysis');
      expect(init).not.toHaveBeenCalled();
      expect(cleanup).toHaveBeenCalledTimes(1);
    } finally {
      init.mockRestore();
    }
  });
  it('re-encodes processed audio while leaving video copy eligible and remove-audio authoritative', () => {
    const settings = { ...base, passthrough: true, audioProcessing: { gainDb: 3 } };
    const job = shrinkJob(settings);
    expect(job.copiesVideo).toBe(true);
    expect(job.options.video).toEqual({});
    expect(job.options.audio).toMatchObject({
      forceTranscode: true,
      process: expect.any(Function),
    });
    expect(shrinkJob({ ...settings, audio: null }).options.audio).toEqual({ discard: true });
    expect(
      audioExtractJob({ ...audio, format: 'm4a', copy: true, audioProcessing: { fadeIn: 1 } })
        .options.audio,
    ).toMatchObject({ codec: 'aac', forceTranscode: true, process: expect.any(Function) });
  });
  it('keeps shrink options and requested tracks', () => {
    expect(shrinkJob(base)).toEqual({
      options: toConversionOptions(base),
      keeps: { video: true, audio: true },
      copiesVideo: false,
      styleDropped: false,
    });
    expect(shrinkJob({ ...base, audio: null }).keeps).toEqual({ video: true, audio: false });
  });

  it('extracts MP3 with the chosen bitrate and channels', () => {
    expect(audioExtractJob(audio)).toEqual({
      options: {
        trim: audio.trim,
        tags: {},
        video: { discard: true },
        audio: { codec: 'mp3', quality: new Quality({ bitrate: 128_000 }), numberOfChannels: 2 },
      },
      keeps: { video: false, audio: true },
    });
  });

  it('transcodes AAC for M4A', () => {
    expect(audioExtractJob({ ...audio, format: 'm4a', channels: 1 }).options.audio).toEqual({
      codec: 'aac',
      quality: new Quality({ bitrate: 128_000 }),
      numberOfChannels: 1,
    });
  });

  it('copies AAC for M4A when requested', () => {
    expect(audioExtractJob({ ...audio, format: 'm4a', copy: true }).options.audio).toEqual({
      codec: 'aac',
      forceTranscode: false,
    });
  });

  it('extracts 16-bit PCM for WAV', () => {
    expect(audioExtractJob({ ...audio, format: 'wav', channels: 1 }).options.audio).toEqual({
      codec: 'pcm-s16',
      numberOfChannels: 1,
    });
  });
});

describe('toConversionOptions', () => {
  const source = {
    name: 'clip.mp4',
    sizeBytes: 100,
    durationSec: 2,
    containerMime: 'video/mp4',
    video: {
      codec: 'avc',
      decodable: true,
      displayWidth: 1920,
      displayHeight: 1080,
      rotation: 0 as const,
      fps: 30,
      bitrate: 4_000_000,
    },
    audio: null,
  };
  it('sets the chosen keyframe interval and re-encodes video without changing audio copy', () => {
    for (const seconds of [1, 2] as const) {
      const options = toConversionOptions({
        ...base,
        passthrough: true,
        keyFrameInterval: seconds,
      });
      expect(options.video).toMatchObject({ keyFrameInterval: seconds, forceTranscode: true });
      expect(options.audio).toEqual({});
      expect(shrinkJob({ ...base, passthrough: true, keyFrameInterval: seconds }).copiesVideo).toBe(
        false,
      );
    }
    expect(toConversionOptions({ ...base, passthrough: true }).video).toEqual({});
    expect(shrinkJob({ ...base, passthrough: true }).copiesVideo).toBe(true);
    expect(toConversionOptions(base).video).not.toHaveProperty('keyFrameInterval');
  });
  it('omits full Original crop and transcodes only a reduced Original crop', () => {
    const transform = { rotate: 0 as const, flip: false, crop: 'original' as const };
    expect(toConversionOptions({ ...base, passthrough: true, transform }, source).video).toEqual(
      {},
    );
    expect(
      toConversionOptions(
        {
          ...base,
          passthrough: true,
          transform: {
            ...transform,
            rect: { left: 0, top: 0, width: 1920, height: 1080 },
          },
        },
        source,
      ).video,
    ).toEqual({});
    const options = toConversionOptions(
      {
        ...base,
        passthrough: true,
        transform: {
          ...transform,
          rect: { left: 100, top: 50, width: 1600, height: 900 },
        },
      },
      source,
    );
    expect(options.video).toMatchObject({
      crop: { left: 100, top: 50, width: 1600, height: 900 },
      forceTranscode: true,
      allowTransformationMetadata: false,
    });
    expect(options.audio).toEqual({});
  });
  it('rotates before centered crop and swaps output dimensions', () => {
    expect(rotatedSize(1920, 1080, 90)).toEqual({ width: 1080, height: 1920 });
    expect(outputSize(source.video, 90, 'original', 1920)).toEqual({ width: 1080, height: 1920 });
    expect(cropRectangle(1920, 1080, 'square')).toEqual({
      left: 420,
      top: 0,
      width: 1080,
      height: 1080,
    });
    expect(cropRectangle(1080, 1920, 'square')).toEqual({
      left: 0,
      top: 420,
      width: 1080,
      height: 1080,
    });
    expect(cropRectangle(1920, 1080, 'portrait')).toEqual({
      left: 663,
      top: 12,
      width: 594,
      height: 1056,
    });
    expect(cropRectangle(1080, 1920, 'portrait')).toEqual({
      left: 0,
      top: 0,
      width: 1080,
      height: 1920,
    });
    expect(cropRectangle(1920, 1080, 'landscape')).toEqual({
      left: 0,
      top: 0,
      width: 1920,
      height: 1080,
    });
    expect(cropRectangle(1080, 1920, 'landscape')).toEqual({
      left: 12,
      top: 663,
      width: 1056,
      height: 594,
    });
    const portraitRotated = rotatedSize(1080, 1920, 90);
    expect(cropRectangle(portraitRotated.width, portraitRotated.height, 'landscape')).toEqual({
      left: 0,
      top: 0,
      width: 1920,
      height: 1080,
    });
  });

  it('maps transform and metadata without forcing audio transcode', () => {
    const transformed = {
      ...base,
      passthrough: true,
      transform: { rotate: 90 as const, flip: true, crop: 'square' as const },
      metadata: { title: 'New title', strip: true },
    };
    const options = toConversionOptions(transformed, source);
    expect(options.video).toMatchObject({
      rotate: 90,
      flip: true,
      forceTranscode: true,
      allowTransformationMetadata: false,
      crop: { left: 0, top: 420, width: 1080, height: 1080 },
    });
    expect(options.video).toHaveProperty('codec', 'avc');
    expect(options.audio).toEqual({});
    expect(options.tags).toEqual({ title: 'New title' });
    const tagsOnly = toConversionOptions({
      ...base,
      passthrough: true,
      metadata: { title: 'New title', strip: false },
    });
    expect(tagsOnly.video).toEqual({});
    expect(toConversionOptions(base).tags).toBeUndefined();
    expect(
      (tagsOnly.tags as (tags: { title?: string; artist?: string }) => object)({
        artist: 'Artist',
      }),
    ).toEqual({ artist: 'Artist', title: 'New title' });
    expect(toConversionOptions({ ...base, metadata: { title: '', strip: true } }).tags).toEqual({});
  });
  it('exports the edited rectangle instead of the centred preset', () => {
    const options = toConversionOptions(
      {
        ...base,
        transform: {
          rotate: 0,
          flip: false,
          crop: 'square',
          rect: { left: 100, top: 80, width: 400, height: 400 },
        },
        video: { ...base.video!, width: 400, height: 400 },
      },
      source,
    );
    expect(options.video).toMatchObject({
      crop: { left: 100, top: 80, width: 400, height: 400 },
      width: 400,
      height: 400,
      fit: 'contain',
    });
  });
  it('keeps trim and copies present tracks in passthrough mode', () => {
    expect(toConversionOptions({ ...base, passthrough: true })).toEqual({
      trim: { start: 0.5, end: 2 },
      video: {},
      audio: {},
    });
    expect(toConversionOptions({ ...base, passthrough: true, audio: null }).audio).toEqual({
      discard: true,
    });
    expect(toConversionOptions({ ...base, passthrough: true, video: null }).video).toEqual({
      discard: true,
    });
  });
  it('maps trim, video size, frame rate, codec and bitrate', () => {
    const o = toConversionOptions(base);
    expect(o.trim).toEqual({ start: 0.5, end: 2 });
    expect(o.video).toEqual({
      width: 1920,
      height: 1080,
      fit: 'contain',
      frameRate: 30,
      codec: 'avc',
      quality: new Quality({ bitrate: 4_000_000 }),
    });
  });

  it('transcodes audio to the chosen codec, bitrate and channel count', () => {
    expect(
      toConversionOptions({
        ...base,
        audio: { codec: 'opus', bitrate: 96_000, channels: 1, copy: false },
      }).audio,
    ).toEqual({
      codec: 'opus',
      quality: new Quality({ bitrate: 96_000 }),
      numberOfChannels: 1,
    });
  });

  it('copies audio packets when copy is set', () => {
    expect(
      toConversionOptions({
        ...base,
        audio: { codec: 'aac', bitrate: 64_000, channels: 2, copy: true },
      }).audio,
    ).toEqual({
      codec: 'aac',
      forceTranscode: false,
    });
  });

  it('discards audio when the settings have none', () => {
    expect(toConversionOptions({ ...base, audio: null }).audio).toEqual({ discard: true });
  });

  it('discards video when the settings have none', () => {
    expect(toConversionOptions({ ...base, video: null }).video).toEqual({ discard: true });
  });

  it('rounds fractional bitrates from packet statistics, which Quality rejects', () => {
    const o = toConversionOptions({
      ...base,
      video: { ...base.video!, bitrate: 2_500_000.7 },
      audio: { ...base.audio!, bitrate: 95_999.4 },
    });
    expect(o.video).toMatchObject({ quality: new Quality({ bitrate: 2_500_001 }) });
    expect(o.audio).toMatchObject({ quality: new Quality({ bitrate: 95_999 }) });
  });

  it('passes frameRate to the encoder for an unchanged source rate', () => {
    expect(toConversionOptions(base).video).toHaveProperty('frameRate', 30);
  });
});

describe('discardedPrimaryTracks', () => {
  it('reports a requested primary video even when audio remains valid', () => {
    const video = { type: 'video' };
    const audio = { type: 'audio' };
    const discarded = [
      { track: video, reason: 'no_encodable_target_codec' },
      { track: audio, reason: 'discarded_by_user' },
    ] as const;
    expect(discardedPrimaryTracks({ video: true, audio: true }, video, audio, discarded)).toEqual([
      { track: 'video', reason: 'no_encodable_target_codec' },
    ]);
  });

  it('ignores secondary tracks and user discards', () => {
    const video = { type: 'video' };
    const secondary = { type: 'video' };
    expect(
      discardedPrimaryTracks({ video: true, audio: true }, video, null, [
        { track: secondary, reason: 'max_track_count_of_type_reached' },
        { track: video, reason: 'discarded_by_user' },
      ]),
    ).toEqual([]);
  });

  it('reports a requested primary audio track while ignoring secondary audio', () => {
    const audio = { type: 'audio' };
    const secondary = { type: 'audio' };
    expect(
      discardedPrimaryTracks({ video: true, audio: true }, null, audio, [
        { track: secondary, reason: 'max_track_count_reached' },
        { track: audio, reason: 'undecodable_source_codec' },
      ]),
    ).toEqual([{ track: 'audio', reason: 'undecodable_source_codec' }]);
  });

  it('reports only tracks the job keeps', () => {
    const video = { type: 'video' };
    const audio = { type: 'audio' };
    expect(
      discardedPrimaryTracks({ video: false, audio: true }, video, audio, [
        { track: video, reason: 'no_encodable_target_codec' },
        { track: audio, reason: 'undecodable_source_codec' },
      ]),
    ).toEqual([{ track: 'audio', reason: 'undecodable_source_codec' }]);
  });
});

describe('createAudioOutputFormat', () => {
  it('keeps the MP3 Xing header for both sinks, since the file stream takes positioned writes', () => {
    expect(createAudioOutputFormat('mp3', 'memory')).toEqual(new Mp3OutputFormat());
    const format = createAudioOutputFormat('mp3', 'file-stream');
    expect(format).toEqual(new Mp3OutputFormat());
    expect(format.fileExtension).toBe('.mp3');
  });

  it('uses MP4 with sink-specific metadata placement for M4A', () => {
    expect(createAudioOutputFormat('m4a', 'memory')).toEqual(
      new Mp4OutputFormat({ fastStart: 'in-memory' }),
    );
    const format = createAudioOutputFormat('m4a', 'file-stream');
    expect(format).toEqual(new Mp4OutputFormat({ fastStart: false }));
    expect(format.fileExtension).toBe('.mp4');
  });

  it('uses WAV for both sinks', () => {
    for (const sink of ['memory', 'file-stream'] as const) {
      const format = createAudioOutputFormat('wav', sink);
      expect(format).toBeInstanceOf(WavOutputFormat);
      expect(format.fileExtension).toBe('.wav');
    }
  });
});

describe('createOutputFormat', () => {
  it('writes MP4 metadata at the end when streaming to a file', () => {
    const f = createOutputFormat('mp4', 'file-stream');
    expect(f).toBeInstanceOf(Mp4OutputFormat);
    expect(f).toEqual(new Mp4OutputFormat({ fastStart: false }));
  });

  it('builds fast-start MP4 in memory', () => {
    const f = createOutputFormat('mp4', 'memory');
    expect(f).toBeInstanceOf(Mp4OutputFormat);
    expect(f).toEqual(new Mp4OutputFormat({ fastStart: 'in-memory' }));
  });

  it('uses WebM for the webm container with either sink', () => {
    expect(createOutputFormat('webm', 'memory')).toBeInstanceOf(WebMOutputFormat);
    expect(createOutputFormat('webm', 'file-stream')).toBeInstanceOf(WebMOutputFormat);
  });
});

describe('live byte counts', () => {
  it('reports no bytes while encoding only for in-memory MP4 and M4A, which finish at the end', () => {
    expect(writesWhileEncoding('mp4', 'memory')).toBe(false);
    expect(writesWhileEncoding('m4a', 'memory')).toBe(false);
    expect(writesWhileEncoding('mp4', 'file-stream')).toBe(true);
    expect(writesWhileEncoding('webm', 'memory')).toBe(true);
    expect(writesWhileEncoding('mp3', 'memory')).toBe(true);
    expect(writesWhileEncoding('wav', 'memory')).toBe(true);
  });
});

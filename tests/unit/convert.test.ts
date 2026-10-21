import { Mp4OutputFormat, Quality, WebMOutputFormat } from 'mediabunny';
import { describe, expect, it } from 'vitest';
import { createOutputFormat, toConversionOptions } from '../../src/core/convert';
import type { Settings } from '../../src/core/types';

const base: Settings = {
  container: 'mp4',
  trim: { start: 0.5, end: 2 },
  video: { codec: 'avc', width: 1920, height: 1080, fps: 30, bitrate: 4_000_000 },
  audio: { codec: 'aac', bitrate: 128_000, channels: 2, copy: false },
};

describe('toConversionOptions', () => {
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
    expect(toConversionOptions({ ...base, audio: { codec: 'opus', bitrate: 96_000, channels: 1, copy: false } }).audio).toEqual({
      codec: 'opus',
      quality: new Quality({ bitrate: 96_000 }),
      numberOfChannels: 1,
    });
  });

  it('copies audio packets when copy is set', () => {
    expect(toConversionOptions({ ...base, audio: { codec: 'aac', bitrate: 64_000, channels: 2, copy: true } }).audio).toEqual({
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

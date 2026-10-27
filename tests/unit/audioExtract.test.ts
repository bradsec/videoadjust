import { describe, expect, it } from 'vitest';
import {
  AUDIO_BITRATE_STEPS,
  AUDIO_FORMATS,
  audioExtractChangeCount,
  audioOutputName,
  audioUnavailable,
  autoAudioExtract,
  estimateAudioBytes,
  lowerAudioBitrate,
  validateAudioExtract,
  type AudioExtractSettings,
} from '../../src/core/audioExtract';
import type { Capabilities, SourceInfo } from '../../src/core/types';

function source(over: Partial<NonNullable<SourceInfo['audio']>> = {}): SourceInfo {
  return {
    name: 'clip.mp4',
    sizeBytes: 10_000_000,
    durationSec: 60,
    containerMime: 'video/mp4',
    video: null,
    audio: {
      codec: 'aac',
      decodable: true,
      channels: 2,
      sampleRate: 48_000,
      bitrate: 160_000,
      ...over,
    },
  };
}

function caps(aac = true): Capabilities {
  return {
    video: { avc: true, hevc: true, av1: true, vp9: true },
    audio: { aac, opus: true },
    aacViaFallback: false,
    fileStreamSave: false,
    shareFiles: false,
  };
}

function auto(src = source()): AudioExtractSettings {
  return autoAudioExtract(src, caps())!;
}

describe('audio extract rules', () => {
  it('uses kept duration for cuts and disables audio copy', () => {
    const src = source({ bitrate: 96000 });
    const base = { ...auto(src), format: 'm4a' as const, copy: true };
    const cut = {
      ...base,
      cuts: [
        { start: 10, end: 14 },
        { start: 30, end: 32 },
      ],
    };
    expect(validateAudioExtract(cut, base, src, caps()).copy).toBe(false);
    expect(estimateAudioBytes(cut, src).mid).toBeCloseTo(((96000 * 54) / 8) * 1.01);
    expect(audioExtractChangeCount(cut, base, src, caps())).toBe(1);
  });
  it('normalizes mix settings and preserves copy eligibility only for a neutral mix', () => {
    const src = source({ bitrate: 96000 });
    const automatic = auto(src);
    const selected = {
      ...automatic,
      format: 'm4a' as const,
      copy: true,
      mix: { original: { include: true, volumeDb: 0 } },
    };
    expect(validateAudioExtract(selected, automatic, src, caps()).copy).toBe(true);
    const mixed = validateAudioExtract(
      {
        ...selected,
        mix: {
          original: { include: false, volumeDb: -99 },
          added: { volumeDb: 99, offset: 100, loop: true },
        },
        trim: { start: 2, end: 5 },
      },
      automatic,
      src,
      caps(),
    );
    expect(mixed.copy).toBe(false);
    expect(mixed.mix).toEqual({
      original: { include: false, volumeDb: -20 },
      added: { volumeDb: 20, offset: 3, loop: true },
    });
  });

  it('estimates mixed WAV at the mixer sample rate even without original audio', () => {
    const src = { ...source(), audio: null };
    const estimate = estimateAudioBytes(
      {
        ...auto(),
        format: 'wav',
        trim: { start: 0, end: 2 },
        mix: {
          original: { include: false, volumeDb: 0 },
          added: { volumeDb: 0, offset: 0, loop: false },
        },
      },
      src,
    );
    expect(estimate.mid).toBe(48000 * 2 * 2 * 2 + 44);
  });
  it('disables AAC copy for processing and restores eligibility at neutral settings', () => {
    const src = source({ bitrate: 96000 });
    const automatic = auto(src);
    const selected = {
      ...automatic,
      format: 'm4a' as const,
      copy: true,
      audioProcessing: { fadeIn: 1 },
    };
    expect(validateAudioExtract(selected, automatic, src, caps()).copy).toBe(false);
    expect(
      validateAudioExtract({ ...selected, audioProcessing: {} }, automatic, src, caps()).copy,
    ).toBe(true);
  });
  it('publishes exact formats and bitrate steps', () => {
    expect(AUDIO_FORMATS).toEqual({
      mp3: { ext: '.mp3', mime: 'audio/mpeg', label: 'MP3' },
      m4a: { ext: '.m4a', mime: 'audio/mp4', label: 'M4A (AAC)' },
      wav: { ext: '.wav', mime: 'audio/wav', label: 'WAV' },
    });
    expect(AUDIO_BITRATE_STEPS).toEqual([64_000, 96_000, 128_000, 160_000, 192_000, 320_000]);
  });

  it('reports missing and undecodable audio', () => {
    const missing = { ...source(), audio: null };
    const undecodable = source({ decodable: false });
    expect(audioUnavailable(missing)).toBe('no-audio');
    expect(audioUnavailable(undecodable)).toBe('undecodable');
    expect(audioUnavailable(source())).toBeNull();
    expect(autoAudioExtract(missing, caps())).toBeNull();
    expect(autoAudioExtract(undecodable, caps())).toBeNull();
  });

  it('sets auto bitrate from channel count and source bitrate', () => {
    expect(auto()).toEqual({
      format: 'mp3',
      trim: { start: 0, end: 60 },
      bitrate: 128_000,
      channels: 2,
      copy: false,
    });
    expect(auto(source({ channels: 1, bitrate: 96_000 }))).toMatchObject({
      bitrate: 96_000,
      channels: 1,
    });
    expect(auto(source({ bitrate: 48_000 })).bitrate).toBe(64_000);
    expect(auto(source({ bitrate: null })).bitrate).toBe(128_000);
  });

  it('allows m4a copy only for AAC within the channel target', () => {
    const selected = { ...auto(), format: 'm4a' as const, copy: true };
    const atTarget = source({ bitrate: 128_000 });
    expect(validateAudioExtract(selected, auto(atTarget), atTarget, caps())).toMatchObject({
      format: 'm4a',
      copy: true,
      bitrate: 128_000,
    });
    for (const src of [source({ bitrate: 192_000 }), source({ codec: 'opus', bitrate: 96_000 })]) {
      expect(validateAudioExtract(selected, auto(src), src, caps()).copy).toBe(false);
    }
    expect(
      validateAudioExtract({ ...selected, channels: 1 }, auto(atTarget), atTarget, caps()).copy,
    ).toBe(false);
    expect(
      validateAudioExtract(
        selected,
        auto(source({ bitrate: null })),
        source({ bitrate: null }),
        caps(),
      ).copy,
    ).toBe(false);
  });

  it('normalizes format, bitrate and channels while preserving trim', () => {
    const base = auto();
    const trim = { start: 4, end: 12 };
    expect(
      validateAudioExtract(
        { ...base, format: 'bad' as AudioExtractSettings['format'], trim },
        base,
        source(),
        caps(),
      ),
    ).toMatchObject({ format: 'mp3', trim });
    expect(
      validateAudioExtract({ ...base, format: 'm4a' }, base, source(), caps(false)).format,
    ).toBe('mp3');
    expect(
      validateAudioExtract({ ...base, bitrate: 123_456 }, base, source(), caps()).bitrate,
    ).toBe(128_000);
    const mono = source({ channels: 1 });
    expect(validateAudioExtract({ ...base, channels: 2 }, auto(mono), mono, caps()).channels).toBe(
      1,
    );
    expect(
      validateAudioExtract({ ...base, format: 'mp3', copy: true }, base, source(), caps()).copy,
    ).toBe(false);
  });

  it('an unknown format falls back to the automatic format', () => {
    const wavAuto = { ...auto(), format: 'wav' as const };
    expect(
      validateAudioExtract(
        { ...wavAuto, format: 'bad' as AudioExtractSettings['format'] },
        wavAuto,
        source(),
        caps(),
      ).format,
    ).toBe('wav');
  });

  it('counts format, bitrate and channels, ignoring wav bitrate', () => {
    const base = auto();
    expect(audioExtractChangeCount(base, base, source(), caps())).toBe(0);
    expect(
      audioExtractChangeCount(
        { ...base, format: 'm4a', bitrate: 96_000, channels: 1 },
        base,
        source(),
        caps(),
      ),
    ).toBe(3);
    expect(
      audioExtractChangeCount({ ...base, format: 'wav', bitrate: 96_000 }, base, source(), caps()),
    ).toBe(1);
  });

  it('lowers bitrate by one step and switches wav to mp3', () => {
    const base = auto();
    expect(lowerAudioBitrate(base, base)).toEqual({
      settings: { ...base, bitrate: 96_000, copy: false },
      note: 'The audio bitrate is now 96 kbps. Export again to try it.',
    });
    expect(lowerAudioBitrate({ ...base, bitrate: 64_000 }, base)).toBeNull();
    expect(lowerAudioBitrate({ ...base, format: 'wav' }, base)).toEqual({
      settings: base,
      note: 'Switched to MP3 at 128 kbps. Export again to try it.',
    });
  });

  it('estimates lossy and wav bytes from the trimmed span', () => {
    const src = source({ bitrate: 128_000 });
    const lossy = estimateAudioBytes({ ...auto(src), trim: { start: 0, end: 60 } }, src);
    expect(lossy).toEqual({ low: 969_600 * 0.85, high: 969_600 * 1.15, mid: 969_600 });
    expect(
      estimateAudioBytes({ ...auto(src), format: 'm4a', copy: true, bitrate: 64_000 }, src).mid,
    ).toBe(969_600);
    const wav = estimateAudioBytes(
      { ...auto(src), format: 'wav', trim: { start: 10, end: 20 } },
      src,
    );
    expect(wav).toEqual({ low: 1_920_044, high: 1_920_044, mid: 1_920_044 });
  });

  it('adds the audio suffix to the last extension', () => {
    expect(audioOutputName('IMG_4907.MP4', 'mp3')).toBe('IMG_4907-audio.mp3');
    expect(audioOutputName('clip', 'm4a')).toBe('clip-audio.m4a');
  });
});

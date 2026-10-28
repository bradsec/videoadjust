import { AUDIO_MONO_BPS, AUDIO_STEREO_BPS } from './autoSettings';
import { hasAudioProcessing, normalizeAudioProcessing, type AudioProcessing } from './audioProcess';
import { hasAudioMix, normalizeAudioMix, type AudioMix } from './audioMix';
import type { Capabilities, SourceInfo } from './types';
import { keptDuration, normalizeCuts, type Cut } from './cuts';

export type AudioFormat = 'mp3' | 'm4a' | 'wav';

export interface AudioExtractSettings {
  mix?: AudioMix;
  audioProcessing?: Partial<AudioProcessing>;
  format: AudioFormat;
  trim: { start: number; end: number };
  cuts?: Cut[];
  cutFade?: number;
  bitrate: number;
  channels: 1 | 2;
  copy: boolean;
}

export const AUDIO_FORMATS: Record<AudioFormat, { ext: string; mime: string; label: string }> = {
  mp3: { ext: '.mp3', mime: 'audio/mpeg', label: 'MP3' },
  m4a: { ext: '.m4a', mime: 'audio/mp4', label: 'M4A (AAC)' },
  wav: { ext: '.wav', mime: 'audio/wav', label: 'WAV' },
};

export const AUDIO_BITRATE_STEPS: number[] = [64_000, 96_000, 128_000, 160_000, 192_000, 320_000];

export type AudioUnavailable = 'no-audio' | 'undecodable';

export function audioUnavailable(src: SourceInfo): AudioUnavailable | null {
  if (!src.audio) return 'no-audio';
  if (!src.audio.decodable) return 'undecodable';
  return null;
}

export function autoAudioExtract(src: SourceInfo, caps: Capabilities): AudioExtractSettings | null {
  void caps;
  if (audioUnavailable(src) !== null || !src.audio) return null;

  const channels: 1 | 2 = src.audio.channels === 1 ? 1 : 2;
  const target = channels === 1 ? AUDIO_MONO_BPS : AUDIO_STEREO_BPS;
  return {
    format: 'mp3',
    trim: { start: 0, end: src.durationSec },
    bitrate: Math.max(64_000, Math.min(target, src.audio.bitrate ?? target)),
    channels,
    copy: false,
  };
}

export function validateAudioExtract(
  value: AudioExtractSettings,
  auto: AudioExtractSettings,
  src: SourceInfo,
  caps: Capabilities,
): AudioExtractSettings {
  const format =
    Object.hasOwn(AUDIO_FORMATS, value.format) && (value.format !== 'm4a' || caps.audio.aac)
      ? value.format
      : auto.format;
  const channels: 1 | 2 =
    (!value.mix?.added && src.audio?.channels === 1) || value.channels === 1 ? 1 : 2;
  const target = channels === 1 ? AUDIO_MONO_BPS : AUDIO_STEREO_BPS;
  const copy =
    value.copy &&
    !hasAudioProcessing(value.audioProcessing) &&
    !hasAudioMix(value.mix) &&
    !value.cuts?.length &&
    format === 'm4a' &&
    src.audio?.codec === 'aac' &&
    src.audio.bitrate !== null &&
    src.audio.bitrate <= target &&
    channels === src.audio.channels;

  return {
    format,
    ...(value.cuts ? { cuts: normalizeCuts(value.cuts, value.trim) } : {}),
    ...(value.mix
      ? { mix: normalizeAudioMix(value.mix, keptDuration(value.trim, value.cuts)) }
      : {}),
    ...(value.audioProcessing
      ? {
          audioProcessing: normalizeAudioProcessing(
            value.audioProcessing,
            keptDuration(value.trim, value.cuts),
          ),
        }
      : {}),
    trim: value.trim,
    bitrate: copy
      ? src.audio!.bitrate!
      : AUDIO_BITRATE_STEPS.includes(value.bitrate)
        ? value.bitrate
        : auto.bitrate,
    channels,
    copy,
  };
}

export function audioExtractChangeCount(
  value: AudioExtractSettings,
  auto: AudioExtractSettings,
  src: SourceInfo,
  caps: Capabilities,
): number {
  const settings = validateAudioExtract(value, auto, src, caps);
  return (
    Number(settings.trim.start !== auto.trim.start || settings.trim.end !== auto.trim.end) +
    Number(!!settings.cuts?.length) +
    Number(settings.format !== auto.format) +
    Number(settings.format !== 'wav' && settings.bitrate !== auto.bitrate) +
    Number(settings.channels !== auto.channels) +
    Number(hasAudioProcessing(settings.audioProcessing)) +
    Number(hasAudioMix(settings.mix))
  );
}

export function lowerAudioBitrate(
  s: AudioExtractSettings,
  auto: AudioExtractSettings,
): { settings: AudioExtractSettings; note: string } | null {
  if (s.format === 'wav') {
    return {
      settings: { ...s, format: 'mp3', bitrate: auto.bitrate, copy: false },
      note: `Switched to MP3 at ${auto.bitrate / 1000} kbps. Export again to try it.`,
    };
  }

  const next = [...AUDIO_BITRATE_STEPS].reverse().find((bitrate) => bitrate < s.bitrate);
  if (next === undefined) return null;
  return {
    settings: { ...s, bitrate: next, copy: false },
    note: `The audio bitrate is now ${next / 1000} kbps. Export again to try it.`,
  };
}

export function estimateAudioBytes(
  s: AudioExtractSettings,
  src: SourceInfo,
): { low: number; high: number; mid: number } {
  const seconds = keptDuration(s.trim, s.cuts);
  if (s.format === 'wav') {
    const mid =
      (hasAudioMix(s.mix) || s.cuts?.length ? 48000 : (src.audio?.sampleRate ?? 0)) *
        s.channels *
        2 *
        seconds +
      44;
    return { low: mid, high: mid, mid };
  }

  const bitrate = s.copy && s.format === 'm4a' ? (src.audio?.bitrate ?? s.bitrate) : s.bitrate;
  const mid = ((bitrate * seconds) / 8) * 1.01;
  return { low: mid * 0.85, high: mid * 1.15, mid };
}

export function audioOutputName(name: string, format: AudioFormat): string {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base}-audio${AUDIO_FORMATS[format].ext}`;
}

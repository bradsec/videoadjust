import { AUDIO_FORMATS, type AudioExtractSettings } from '../core/audioExtract';
import { hasAudioProcessing } from '../core/audioProcess';
import { hasAudioMix } from '../core/audioMix';
import { keptDuration } from '../core/cuts';
import type { Settings, SourceInfo } from '../core/types';

/** What the result shows for a file-stream output, where no Blob exists to read back. */
export function describeWritten(
  name: string,
  bytes: number,
  settings: Settings,
  source: SourceInfo,
  mime: string,
): SourceInfo {
  const v = settings.video;
  const a = settings.audio;
  const durationSec = keptDuration(settings.trim, settings.cuts);
  return {
    name,
    sizeBytes: bytes,
    durationSec,
    containerMime: mime,
    video:
      v && source.video
        ? settings.passthrough
          ? source.video
          : {
              codec: v.codec,
              decodable: true,
              displayWidth: v.width,
              displayHeight: v.height,
              rotation: 0,
              fps: v.fps,
              bitrate: v.bitrate,
            }
        : null,
    audio: a
      ? source.audio &&
        (settings.passthrough || a.copy) &&
        !hasAudioProcessing(settings.audioProcessing) &&
        !hasAudioMix(settings.mix)
        ? source.audio
        : {
            codec: a.codec,
            decodable: true,
            channels: a.channels,
            sampleRate: hasAudioMix(settings.mix) ? 48000 : (source.audio?.sampleRate ?? 48000),
            bitrate: a.bitrate,
          }
      : null,
  };
}

/** The audio counterpart of describeWritten. */
export function describeAudioWritten(
  name: string,
  bytes: number,
  s: AudioExtractSettings,
  source: SourceInfo,
): SourceInfo {
  return {
    name,
    sizeBytes: bytes,
    durationSec: keptDuration(s.trim, s.cuts),
    containerMime: AUDIO_FORMATS[s.format].mime,
    video: null,
    audio:
      source.audio &&
      (s.copy
        ? source.audio
        : {
            codec: s.format === 'mp3' ? 'mp3' : s.format === 'wav' ? 'pcm-s16' : 'aac',
            decodable: true,
            channels: s.channels,
            sampleRate: source.audio.sampleRate,
            // WAV ignores the bitrate setting; 16-bit PCM runs at a fixed rate.
            bitrate: s.format === 'wav' ? source.audio.sampleRate * s.channels * 16 : s.bitrate,
          }),
  };
}

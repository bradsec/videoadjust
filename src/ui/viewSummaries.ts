import { AUDIO_FORMATS, audioUnavailable, type AudioExtractSettings } from '../core/audioExtract';
import { gifDimensions, gifUnavailable } from '../core/gifExport';
import type { Settings, SourceInfo } from '../core/types';
import { codecLabel, type AppState } from './controller';
import { el, icon } from './dom';
import { formatBitrate, formatBytes, formatDuration } from './format';
import type { PreviewAudioTarget } from './previewAudio';

type Of<K extends AppState['kind']> = Extract<AppState, { kind: K }>;

/** "212 MB · 3840x2160 · 60 fps · HEVC · 1:24.6" */
export function summarySource(s: SourceInfo): string {
  const parts = [formatBytes(s.sizeBytes)];
  if (s.video) {
    parts.push(`${s.video.displayWidth}x${s.video.displayHeight}`);
    parts.push(`${Number(s.video.fps.toFixed(1))} fps`);
    if (s.video.variableFrameRate !== null && s.video.variableFrameRate !== undefined)
      parts.push(s.video.variableFrameRate ? 'Variable frame rate' : 'Constant frame rate');
    if (s.video.hdr !== null && s.video.hdr !== undefined) parts.push(s.video.hdr ? 'HDR' : 'SDR');
    parts.push(codecLabel(s.video.codec));
  } else if (s.audio) {
    parts.push(`${codecLabel(s.audio.codec)} audio`);
  }
  parts.push(formatDuration(s.durationSec));
  return parts.join(' · ');
}

/** Why Extract audio is unavailable for this source, or null when it can be chosen. */
export function previewAudioTarget(state: Of<'prepare'>): PreviewAudioTarget {
  if (state.tool === 'audio')
    return state.audioSettings
      ? {
          processing: state.audioSettings.audioProcessing,
          trim: state.audioSettings.trim,
          channels: state.audioSettings.channels,
          mix: state.audioSettings.mix,
          added: state.addedAudio,
        }
      : null;
  if (state.tool === 'gif') return null;
  return {
    processing: state.settings.audioProcessing,
    trim: state.settings.trim,
    channels: state.settings.audio?.channels ?? 2,
    mix: state.settings.mix,
    added: state.addedAudio,
  };
}

/** Desktop wide layout shared by Prepare and the result comparison; remembered per browser. */
export function theaterToggle(title: string): {
  button: HTMLButtonElement;
  destroy(): void;
} {
  const theater = el('button', 'btn btn-text theater-toggle');
  theater.type = 'button';
  theater.title = title;
  theater.append(icon('i-theater'), 'Theater mode');
  const touch = window.matchMedia('(hover: none) and (pointer: coarse)');
  let theaterOn = false;
  try {
    theaterOn = localStorage.getItem('videoadjust-theater') === 'true';
  } catch {
    // Browsers can block storage; the default layout still works.
  }
  const sync = (save: boolean) => {
    document.body.classList.toggle('is-theater', theaterOn);
    theater.setAttribute('aria-pressed', String(theaterOn));
    if (save) {
      try {
        localStorage.setItem('videoadjust-theater', String(theaterOn));
      } catch {
        // Theater mode remains usable when storage is unavailable.
      }
    }
  };
  const onTouchChange = () => {
    if (!touch.matches || !theaterOn) return;
    theaterOn = false;
    sync(true);
  };
  const blockedSavedState = touch.matches && theaterOn;
  if (blockedSavedState) theaterOn = false;
  sync(blockedSavedState);
  touch.addEventListener('change', onTouchChange);
  theater.addEventListener('click', () => {
    if (touch.matches) return;
    theaterOn = !theaterOn;
    sync(true);
  });
  return { button: theater, destroy: () => touch.removeEventListener('change', onTouchChange) };
}

export function audioReason(state: Of<'prepare'>): string | null {
  if (state.audioAuto) return null;
  return audioUnavailable(state.source) === 'undecodable'
    ? 'This browser cannot decode the audio in this video'
    : 'This video has no audio track';
}

export function gifReason(state: Of<'prepare'>): string | null {
  return state.gifAuto ? null : gifUnavailable(state.source);
}

const CONTAINER_LABELS: Record<string, string> = {
  'video/mp4': 'MP4',
  'video/quicktime': 'MOV',
  'video/webm': 'WebM',
  'video/x-matroska': 'MKV',
  'audio/mp4': 'MP4',
  'audio/webm': 'WebM',
};
export const containerLabel = (mime: string) => {
  const base = mime.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return CONTAINER_LABELS[base] ?? (base.split('/')[1]?.toUpperCase() || 'unknown');
};
export const videoStatsLabel = (source: SourceInfo) => {
  const video = source.video ? codecLabel(source.video.codec) : 'No video';
  const container = containerLabel(source.containerMime);
  return video === container ? video : `${video}, ${container}`;
};
const audioLabels: Record<string, string> = {
  aac: 'AAC',
  opus: 'Opus',
  mp3: 'MP3',
  'pcm-s16': 'PCM 16-bit',
};
export const audioLabel = (c: string | null) =>
  c ? (audioLabels[c] ?? c.toUpperCase()) : 'unknown';
export const clock = (ms: number) => formatDuration(Math.round(ms / 1000));

/** "1080p · H.264/AAC MP4" */
export function summaryOutput(settings: Settings): string {
  const container = settings.container === 'webm' ? 'WebM' : 'MP4';
  if (settings.passthrough) return `Trimmed copy · ${container}`;
  const v = settings.video;
  const codecs = [
    v ? codecLabel(v.codec) : null,
    settings.audio ? audioLabel(settings.audio.codec) : null,
  ]
    .filter(Boolean)
    .join('/');
  return [v ? `${Math.min(v.width, v.height)}p` : null, `${codecs} ${container}`]
    .filter(Boolean)
    .join(' · ');
}

/** "Off", "Text", "Image" or "Text and image", for the Overlay row. */
export function overlaySummary(overlays: Settings['overlays'], hasImage: boolean): string {
  const text = !!overlays?.text.enabled && !!overlays.text.content.trim();
  const image = !!overlays?.image.enabled && hasImage;
  return text && image ? 'Text and image' : text ? 'Text' : image ? 'Image' : 'Off';
}

/** "270x480" */
export function summaryGif(
  gif: Parameters<typeof gifDimensions>[0],
  source: SourceInfo,
  transform: Settings['transform'],
): string {
  const { width, height } = gifDimensions(gif, source, transform);
  return `${width}x${height}`;
}

/** "MP3 · 128 kbps stereo" */
export function summaryAudio(a: AudioExtractSettings): string {
  const { label } = AUDIO_FORMATS[a.format];
  const channels = a.channels === 1 ? 'mono' : 'stereo';
  return a.format === 'wav'
    ? `${label} · PCM 16-bit ${channels}`
    : `${label} · ${formatBitrate(a.bitrate)} ${channels}`;
}

/** A heading that takes focus when its screen appears, so the change is announced. */
export function screenHeading(className: string): HTMLHeadingElement {
  const h = el('h1', className);
  h.tabIndex = -1;
  return h;
}

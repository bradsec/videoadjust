import {
  autoAudioExtract,
  audioExtractChangeCount,
  lowerAudioBitrate,
  validateAudioExtract,
} from '../core/audioExtract';
import type { Input } from 'mediabunny';
import { targetVideoBitrate } from '../core/autoSettings';
import { hasAudioProcessing, normalizeAudioProcessing } from '../core/audioProcess';
import { hasAudioMix, normalizeAudioMix, type AddedAudio } from '../core/audioMix';
import { hasOverlays, normalizeOverlays } from '../core/overlays';
import { DEFAULT_FIT, normalizeFit } from '../core/fit';
import { hasStyleEffects, normalizeStyle } from '../core/style';
import { applyTargetSize, validTargetSize } from '../core/targetSize';
import { normalizeCrop, outputSize, rotatedSize, videoFrameSize } from '../core/videoGeometry';
import type {
  AutoResult,
  Capabilities,
  Container,
  CropRect,
  Settings,
  SourceInfo,
  VideoCodecId,
} from '../core/types';
import { formatBitrate } from './format';
import { clampTrim } from './trimBar';
import type { AppState, Loaded } from './controllerTypes';

const CODEC_LABELS: Record<string, string> = {
  avc: 'H.264',
  hevc: 'HEVC',
  vp9: 'VP9',
  vp8: 'VP8',
  av1: 'AV1',
};
export const codecLabel = (c: string | null) =>
  c ? (CODEC_LABELS[c] ?? c.toUpperCase()) : 'unknown codec';

export function inputOf(state: AppState): Input | undefined {
  return state.kind === 'drop' ? undefined : state.input;
}

export function audioMixSource(source: SourceInfo, added?: AddedAudio): SourceInfo {
  return added
    ? {
        ...source,
        audio: { codec: null, decodable: true, channels: 2, sampleRate: 48000, bitrate: null },
      }
    : source;
}

/** "IMG_4821.MOV" -> "IMG_4821-small.mp4" */
export function outputNameFor(name: string, container: Container): string {
  const dot = name.lastIndexOf('.');
  return `${dot > 0 ? name.slice(0, dot) : name}-small.${container}`;
}

const AUDIO_STEPS = [160_000, 128_000, 96_000, 64_000];
/** "Make it smaller" lowers quality by this share of the automatic bitrate when no smaller size is left. */
const QUALITY_STEP_PERCENT = 25;
const MIN_QUALITY_PERCENT = 25;

/**
 * Settings one step smaller than `settings`: the next size step below the current long
 * edge, else video quality one step lower, else (audio only) the next lower audio bitrate.
 * Null when nothing smaller is left.
 */
export function smallerSettings(
  settings: Settings,
  auto: AutoResult,
  source: SourceInfo,
): { settings: Settings; note: string } | null {
  const v = settings.video;
  const sv = source.video;
  if (v && sv) {
    const edge = Math.max(v.width, v.height);
    const next = auto.sizeSteps.find((step) => step < edge);
    if (next !== undefined) {
      const { width, height } = outputSize(
        sv,
        settings.transform?.rotate ?? 0,
        settings.transform?.crop ?? 'original',
        next,
        settings.transform?.rect,
        settings.fit,
      );
      const bitrate = Math.round(
        Math.min(targetVideoBitrate(v.codec, width, height, v.fps), sv.bitrate ?? Infinity),
      );
      return {
        settings: { ...settings, passthrough: false, video: { ...v, width, height, bitrate } },
        note: `The size is now ${width}x${height}. Export again to try it.`,
      };
    }
    const baseline = Math.min(
      targetVideoBitrate(v.codec, v.width, v.height, v.fps),
      sv.bitrate ?? Infinity,
    );
    const percent = Math.round((v.bitrate / baseline) * 100);
    const lower = Math.max(MIN_QUALITY_PERCENT, percent - QUALITY_STEP_PERCENT);
    if (lower >= percent) return null;
    return {
      settings: {
        ...settings,
        passthrough: false,
        video: { ...v, bitrate: Math.round((baseline * lower) / 100) },
      },
      note: `This is already the smallest size, so quality is lowered to ${lower}% of auto instead. Export again to try it.`,
    };
  }
  const a = settings.audio;
  const lower = a ? AUDIO_STEPS.find((b) => b < a.bitrate) : undefined;
  if (!a || lower === undefined) return null;
  return {
    settings: { ...settings, passthrough: false, audio: { ...a, bitrate: lower, copy: false } },
    note: `The audio bitrate is now ${formatBitrate(lower)}. Export again to try it.`,
  };
}

/** Count all tools, including settings on tabs that are not currently visible. */
export function allSettingsChangeCount(state: Loaded & { addingAudio?: boolean }): number {
  const { settings, auto, caps, source, audioSettings, gifSettings, gifAuto } = state;
  const audioAuto = autoAudioExtract(source, caps);
  const audioChanges =
    audioSettings && audioAuto
      ? audioExtractChangeCount(
          { ...audioSettings, trim: audioAuto.trim, audioProcessing: undefined, mix: undefined },
          audioAuto,
          source,
          caps,
        )
      : 0;
  const gifChanges =
    gifSettings && gifAuto
      ? (['size', 'fps', 'loop', 'colors', 'compression'] as const).filter(
          (key) => gifSettings[key] !== gifAuto[key],
        ).length
      : 0;
  const overlays = normalizeOverlays(settings.overlays);
  const defaultOverlays = normalizeOverlays(auto.settings.overlays);
  // Disabled effects can still hold edited settings that Reset all must clear.
  const inactiveChanges =
    Number(
      !hasStyleEffects(settings.style) &&
        JSON.stringify(normalizeStyle(settings.style)) !==
          JSON.stringify(normalizeStyle(auto.settings.style)),
    ) +
    (['text', 'image'] as const).filter(
      (key) =>
        !overlays[key].enabled &&
        JSON.stringify(overlays[key]) !== JSON.stringify(defaultOverlays[key]),
    ).length;
  const shrinkChanges = settingsChangeCount(settings, auto, caps, source);
  return (
    shrinkChanges +
    audioChanges +
    gifChanges +
    inactiveChanges +
    // Re-encode anyway on its own; other changes already turn passthrough off.
    Number(state.auto.alreadyOptimal && !settings.passthrough && shrinkChanges === 0) +
    Number(!!state.addedAudio && !settings.mix?.added) +
    Number(!!state.addingAudio) +
    Number(!!state.overlayAssets?.image && !settings.overlays?.image.enabled)
  );
}

const CONTAINER_VIDEO: Record<Container, VideoCodecId[]> = {
  mp4: ['avc', 'hevc', 'av1'],
  webm: ['vp9', 'av1'],
};

export function availableVideoCodecs(container: Container, caps: Capabilities): VideoCodecId[] {
  return CONTAINER_VIDEO[container].filter((codec) => caps.video[codec]);
}

function videoBaseline(video: NonNullable<Settings['video']>, source: SourceInfo): number {
  return Math.min(
    targetVideoBitrate(video.codec, video.width, video.height, video.fps),
    source.video?.bitrate ?? Infinity,
  );
}

export function preserveQuality(
  previous: Settings,
  requested: Settings,
  source: SourceInfo,
): Settings {
  if (requested.targetSizeMB) return requested;
  if (
    source.video &&
    requested.video &&
    JSON.stringify(normalizeFit(previous.fit)) !== JSON.stringify(normalizeFit(requested.fit))
  ) {
    const transform = requested.transform;
    requested = {
      ...requested,
      video: {
        ...requested.video,
        ...outputSize(
          source.video,
          transform?.rotate ?? 0,
          transform?.crop ?? 'original',
          Math.max(requested.video.width, requested.video.height),
          transform?.rect,
          requested.fit,
        ),
      },
    };
  }
  const old = previous.video;
  const next = requested.video;
  if (!old || !next || next.bitrate !== old.bitrate) return requested;
  if (
    next.codec === old.codec &&
    next.width === old.width &&
    next.height === old.height &&
    next.fps === old.fps
  )
    return requested;
  const oldBaseline = videoBaseline(old, source);
  const newBaseline = videoBaseline(next, source);
  return {
    ...requested,
    video: { ...next, bitrate: Math.round((old.bitrate / oldBaseline) * newBaseline) },
  };
}

/** Apply every source and encoder limit before settings enter controller state. */
export function validateSettings(
  value: Settings,
  auto: AutoResult,
  caps: Capabilities,
  source: SourceInfo,
): Settings {
  const fallback = auto.settings;
  const trim = clampTrim(value.trim, source.durationSec, 'end');
  const mix = value.mix ? normalizeAudioMix(value.mix, trim.end - trim.start) : undefined;
  const overlays = normalizeOverlays(value.overlays);
  const style = normalizeStyle(value.style);
  const fit = normalizeFit(value.fit);
  const container =
    availableVideoCodecs(value.container, caps).length &&
    (value.container !== 'webm' || (!source.audio && !mix?.added) || caps.audio.opus)
      ? value.container
      : fallback.container;
  const supported = availableVideoCodecs(container, caps);
  let video: Settings['video'] = null;
  let effectiveCrop = value.transform?.crop ?? 'original';
  let effectiveRect: CropRect | null = null;
  if (source.video && fallback.video) {
    const requested = value.video ?? fallback.video;
    const rotate = value.transform?.rotate ?? 0;
    const rotated = rotatedSize(source.video.displayWidth, source.video.displayHeight, rotate);
    const requestedCrop = value.transform?.crop ?? 'original';
    const crop = requestedCrop;
    effectiveCrop = crop;
    const rect = normalizeCrop(rotated.width, rotated.height, crop, value.transform?.rect);
    effectiveRect = rect;
    const frame = videoFrameSize(source.video, rotate, crop, rect);
    const codec = supported.includes(requested.codec)
      ? requested.codec
      : supported.includes(fallback.video.codec)
        ? fallback.video.codec
        : (supported[0] ?? fallback.video.codec);
    const sourceEdge = Math.max(frame.width, frame.height);
    const allowedEdges = [sourceEdge, ...auto.sizeSteps.filter((step) => step <= sourceEdge)];
    const requestedEdge = Math.max(requested.width, requested.height);
    const edge = allowedEdges.includes(requestedEdge)
      ? requestedEdge
      : Math.max(fallback.video.width, fallback.video.height);
    const { width, height } = outputSize(source.video, rotate, crop, edge, rect, fit);
    const fps =
      Number.isFinite(requested.fps) && requested.fps > 0
        ? Math.min(requested.fps, source.video.fps)
        : fallback.video.fps;
    const baseline = videoBaseline({ ...requested, codec, width, height, fps }, source);
    const bitrate = Number.isFinite(requested.bitrate)
      ? Math.round(
          Math.min(
            Math.max(requested.bitrate, baseline * 0.25),
            baseline * 1.5,
            source.video.bitrate ?? Infinity,
          ),
        )
      : Math.round(baseline);
    video = { codec, width, height, fps, bitrate };
  }
  let audio: Settings['audio'] = null;
  const requestedAudio = value.audio ??
    fallback.audio ?? {
      codec: container === 'webm' ? 'opus' : 'aac',
      bitrate: 160_000,
      channels: 2,
      copy: false,
    };
  const includesAudio = mix
    ? !!mix.added || (mix.original.include && !!source.audio)
    : !!source.audio && !!value.audio;
  if (includesAudio) {
    const codec =
      container === 'webm'
        ? 'opus'
        : caps.audio[requestedAudio.codec]
          ? requestedAudio.codec
          : (fallback.audio?.codec ?? 'aac');
    const max = mix?.added ? Infinity : (source.audio?.bitrate ?? Infinity);
    const allowed = [64_000, 96_000, 128_000, 160_000].filter((n) => n <= max);
    const requested = requestedAudio.bitrate;
    const bitrate = allowed.includes(requested) ? requested : Math.min(requested, max);
    const copy =
      !hasAudioProcessing(value.audioProcessing) &&
      !hasAudioMix(mix) &&
      container === fallback.container &&
      codec === fallback.audio?.codec &&
      bitrate === fallback.audio.bitrate &&
      fallback.audio.copy;
    audio = {
      codec,
      bitrate: Math.max(1, bitrate),
      channels: mix?.added ? 2 : Math.min(source.audio?.channels ?? 2, 2),
      copy,
    };
  }
  const targetSizeMB = validTargetSize(value.targetSizeMB);
  const canCopyTarget =
    !!video &&
    !!source.video &&
    video.codec === source.video.codec &&
    video.width === source.video.displayWidth &&
    video.height === source.video.displayHeight &&
    video.fps === source.video.fps &&
    source.containerMime.split(';', 1)[0]?.trim().toLowerCase() === `video/${container}` &&
    (!audio ||
      hasAudioProcessing(value.audioProcessing) ||
      (audio.codec === source.audio?.codec && audio.copy));
  return applyTargetSize(
    {
      overlays,
      style,
      fit,
      ...(mix ? { mix } : {}),
      ...(value.audioProcessing
        ? {
            audioProcessing: normalizeAudioProcessing(value.audioProcessing, trim.end - trim.start),
          }
        : {}),
      targetSizeMB,
      targetRetryScale: value.targetRetryScale,
      container,
      passthrough:
        (targetSizeMB ? canCopyTarget : auto.alreadyOptimal) &&
        value.passthrough &&
        !(
          (value.transform?.rotate ?? 0) ||
          value.transform?.flip ||
          (value.transform?.crop ?? 'original') !== 'original' ||
          effectiveRect ||
          value.keyFrameInterval ||
          value.trimPrecision === 'exact' ||
          hasOverlays(overlays) ||
          hasStyleEffects(style) ||
          fit.aspect !== 'off'
        ),
      trim,
      trimPrecision: value.trimPrecision === 'exact' ? 'exact' : 'fast',
      keyFrameInterval:
        value.keyFrameInterval === 1 || value.keyFrameInterval === 2
          ? value.keyFrameInterval
          : null,
      transform: source.video
        ? {
            rotate: value.transform?.rotate ?? 0,
            flip: value.transform?.flip ?? false,
            crop: effectiveCrop,
            rect: effectiveRect,
          }
        : fallback.transform,
      metadata: {
        title: value.metadata?.title.trim().slice(0, 200) ?? '',
        strip: value.metadata?.strip ?? true,
      },
      video,
      audio,
    },
    auto,
    source,
  );
}

/** Compare the effective values shown by the controls, after applying the same limits to both sides. */
// Trim and the edit sections (audio, colour, style, overlays) count in their own places.
function editChangeCount(current: Settings, auto: AutoResult): number {
  return (
    Number(
      current.trim.start !== auto.settings.trim.start ||
        current.trim.end !== auto.settings.trim.end,
    ) +
    Number(!!current.overlays?.text.enabled) +
    Number(!!current.overlays?.image.enabled) +
    Number(hasStyleEffects(current.style)) +
    Number(hasAudioProcessing(current.audioProcessing)) +
    Number(hasAudioMix(current.mix)) +
    Number(JSON.stringify(normalizeFit(current.fit)) !== JSON.stringify(DEFAULT_FIT))
  );
}

/** Changes shown on the Shrink Output section: encoding settings only. */
export function outputChangeCount(
  value: Settings,
  auto: AutoResult,
  caps: Capabilities,
  source: SourceInfo,
): number {
  return (
    settingsChangeCount(value, auto, caps, source) -
    editChangeCount(validateSettings(value, auto, caps, source), auto)
  );
}

export function settingsChangeCount(
  value: Settings,
  auto: AutoResult,
  caps: Capabilities,
  source: SourceInfo,
): number {
  const current = validateSettings(value, auto, caps, source);
  const automatic = validateSettings(
    {
      ...auto.settings,
      ...(current.targetSizeMB
        ? {
            targetSizeMB: current.targetSizeMB,
            trim: current.trim,
            passthrough: current.passthrough,
          }
        : {}),
    },
    auto,
    caps,
    source,
  );
  const expectedSize =
    automatic.video && source.video
      ? outputSize(
          source.video,
          current.transform?.rotate ?? 0,
          current.transform?.crop ?? 'original',
          Math.max(automatic.video.width, automatic.video.height),
          current.transform?.rect,
          current.fit,
        )
      : null;
  return (
    editChangeCount(current, auto) +
    Number(current.trimPrecision === 'exact') +
    Number(!!current.targetSizeMB) +
    Number(current.container !== automatic.container) +
    Number(current.video?.codec !== automatic.video?.codec) +
    Number(
      current.video && expectedSize
        ? current.video.width !== expectedSize.width || current.video.height !== expectedSize.height
        : current.video?.width !== automatic.video?.width ||
            current.video?.height !== automatic.video?.height,
    ) +
    Number(current.video?.fps !== automatic.video?.fps) +
    Number(
      !current.targetSizeMB &&
        (current.video && automatic.video
          ? Math.round((current.video.bitrate / videoBaseline(current.video, source)) * 100) !==
            Math.round((automatic.video.bitrate / videoBaseline(automatic.video, source)) * 100)
          : current.video?.bitrate !== automatic.video?.bitrate),
    ) +
    Number(current.audio?.codec !== automatic.audio?.codec) +
    Number(current.audio?.bitrate !== automatic.audio?.bitrate) +
    Number(current.transform?.rotate !== automatic.transform?.rotate) +
    Number(current.transform?.flip !== automatic.transform?.flip) +
    Number(current.transform?.crop !== automatic.transform?.crop) +
    Number(
      current.transform?.crop === automatic.transform?.crop &&
        JSON.stringify(current.transform?.rect) !== JSON.stringify(automatic.transform?.rect),
    ) +
    Number(current.keyFrameInterval !== automatic.keyFrameInterval) +
    Number(current.metadata?.title !== automatic.metadata?.title) +
    Number(current.metadata?.strip !== automatic.metadata?.strip)
  );
}

/** `from` one step smaller for its tool. Null when nothing smaller is left. */
export function smallerFor(from: Loaded): { loaded: Loaded; note: string } | null {
  const { audioAuto, audioSettings, source, caps } = from;
  if (from.tool === 'audio' && audioAuto && audioSettings) {
    const next = lowerAudioBitrate(audioSettings, audioAuto);
    return (
      next && {
        loaded: {
          ...from,
          audioSettings: validateAudioExtract(next.settings, audioAuto, source, caps),
        },
        note: next.note,
      }
    );
  }
  const next = smallerSettings(from.settings, from.auto, source);
  return (
    next && {
      loaded: { ...from, settings: validateSettings(next.settings, from.auto, caps, source) },
      note: next.note,
    }
  );
}

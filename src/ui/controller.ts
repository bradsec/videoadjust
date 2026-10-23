import {
  decodeOverlayImage,
  hasOverlays,
  normalizeOverlays,
  type OverlayAssets,
} from '../core/overlays';
import {
  ConversionCanceledError,
  type canEncodeVideo,
  type Input,
  type OutputFormat,
} from 'mediabunny';
import {
  AUDIO_FORMATS,
  audioOutputName,
  autoAudioExtract,
  estimateAudioBytes,
  lowerAudioBitrate,
  validateAudioExtract,
  type AudioExtractSettings,
} from '../core/audioExtract';
import type { probeCapabilities as probeCapabilitiesFn } from '../core/capabilities';
import { autoSettings, targetVideoBitrate } from '../core/autoSettings';
import {
  audioExtractJob,
  ConversionInvalidError,
  createAudioOutputFormat,
  createOutputFormat,
  shrinkJob,
  type ConversionJob,
  type startConversion as startConversionFn,
} from '../core/convert';
import { estimateBytes } from '../core/estimate';
import { applyTargetSize, retryTargetSize, validTargetSize } from '../core/targetSize';
import {
  autoGifSettings,
  exportGif,
  gifBudgetError,
  gifDimensions,
  gifFrameCount,
  gifOutputName,
  validateGifSettings,
  type GifSettings,
} from '../core/gifExport';
import { normalizeCrop, outputSize, rotatedSize, videoFrameSize } from '../core/videoGeometry';
import { UnsupportedSourceError, type readSource as readSourceFn } from '../core/source';
import {
  chooseSink,
  openGifSink,
  type OpenSink,
  type openSink as openSinkFn,
  type SinkPlan,
} from '../core/sink';
import type {
  AutoResult,
  Capabilities,
  CropRect,
  Container,
  Settings,
  SourceInfo,
  VideoCodecId,
} from '../core/types';
import { formatBitrate, formatBytes } from './format';
import { clampTrim } from './trimBar';

/** Above this the app warns before reading the file (decimal, matching formatBytes). */
export const LARGE_FILE_BYTES = 2e9;

export interface Notice {
  tone: 'info' | 'warn' | 'error';
  title: string;
  message: string;
  /** A file waiting on the user's "Continue anyway". */
  pending?: File;
  /** An export waiting on the user's "Continue" past the in-memory size warning. */
  confirm?: 'memory';
}

export type Tool = 'shrink' | 'audio' | 'gif';

/** The loaded source and its derived limits, carried from prepare through result. */
interface Loaded {
  overlayAssets?: OverlayAssets;
  file: File;
  source: SourceInfo;
  input: Input;
  auto: AutoResult;
  caps: Capabilities;
  settings: Settings;
  tool: Tool;
  /** Null when the audio tool is disabled; audioUnavailable(source) gives the reason. */
  audioAuto: AudioExtractSettings | null;
  /** Non-null whenever audioAuto is, so tool 'audio' always has settings. */
  audioSettings: AudioExtractSettings | null;
  gifAuto: GifSettings | null;
  gifSettings: GifSettings | null;
}

export type AppState =
  | { kind: 'drop'; notice?: Notice; reading?: string }
  | (Loaded & {
      kind: 'prepare';
      notice?: Notice;
      /** An export started and still awaits its encoder check or save picker. */
      exporting?: boolean;
    })
  | (Loaded & {
      kind: 'working';
      outputName: string;
      sinkKind: SinkPlan['kind'];
      estimate: { low: number; high: number };
      progress: number;
      bytes: number;
      startedAt: number;
    })
  | (Loaded & {
      kind: 'result';
      outputName: string;
      sinkKind: SinkPlan['kind'];
      elapsedMs: number;
      /** Review Focus 4: the new file is the same size as the original or bigger. */
      notSmaller: boolean;
      output: { blob: Blob | null; sizeBytes: number; url: string | null; info: SourceInfo };
    });

export type AppAction =
  | { type: 'pick'; file: File }
  | { type: 'continueLarge' }
  | { type: 'dismissNotice' }
  | { type: 'reading'; name: string }
  | {
      type: 'loaded';
      file: File;
      source: SourceInfo;
      input: Input;
      auto: AutoResult;
      caps: Capabilities;
    }
  | { type: 'setTrim'; value: Settings['trim'] }
  | { type: 'setSettings'; value: Settings }
  | { type: 'setOverlayImage'; file: File }
  | { type: 'setTool'; tool: Tool }
  | { type: 'setAudioSettings'; value: AudioExtractSettings }
  | { type: 'setGifSettings'; value: GifSettings }
  | { type: 'export'; confirmed?: boolean }
  | { type: 'cancel' }
  | { type: 'smaller' }
  | { type: 'failed'; notice: Notice }
  | { type: 'reset' };

export interface AppDeps {
  probeCapabilities: typeof probeCapabilitiesFn;
  canEncodeVideo: typeof canEncodeVideo;
  readSource: typeof readSourceFn;
  startConversion: typeof startConversionFn;
  openSink: typeof openSinkFn;
  ensureMp3Encoder: () => Promise<void>;
  /** navigator.deviceMemory where the browser reports it. */
  deviceMemoryGB?: number;
}

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

const isAbortError = (err: unknown) => err instanceof DOMException && err.name === 'AbortError';
const PARTIAL_FILE = 'A partial file may remain at the location you chose. You can delete it.';

/** What the result shows for a file-stream output, where no Blob exists to read back. */
function describeWritten(
  name: string,
  bytes: number,
  settings: Settings,
  source: SourceInfo,
  mime: string,
): SourceInfo {
  const v = settings.video;
  const a = settings.audio;
  const durationSec = Math.max(0, settings.trim.end - settings.trim.start);
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
    audio:
      a && source.audio
        ? settings.passthrough || a.copy
          ? source.audio
          : {
              codec: a.codec,
              decodable: true,
              channels: a.channels,
              sampleRate: source.audio.sampleRate,
              bitrate: a.bitrate,
            }
        : null,
  };
}

/** The audio counterpart of describeWritten. */
function describeAudioWritten(
  name: string,
  bytes: number,
  s: AudioExtractSettings,
  source: SourceInfo,
): SourceInfo {
  return {
    name,
    sizeBytes: bytes,
    durationSec: Math.max(0, s.trim.end - s.trim.start),
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

function preserveQuality(previous: Settings, requested: Settings, source: SourceInfo): Settings {
  if (requested.targetSizeMB) return requested;
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
  const overlays = normalizeOverlays(value.overlays);
  const container =
    availableVideoCodecs(value.container, caps).length &&
    (value.container !== 'webm' || !source.audio || caps.audio.opus)
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
    const { width, height } = outputSize(source.video, rotate, crop, edge, rect);
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
  if (source.audio && value.audio) {
    const codec =
      container === 'webm'
        ? 'opus'
        : caps.audio[value.audio.codec]
          ? value.audio.codec
          : (fallback.audio?.codec ?? 'aac');
    const max = source.audio.bitrate ?? Infinity;
    const allowed = [64_000, 96_000, 128_000, 160_000].filter((n) => n <= max);
    const requested = value.audio.bitrate;
    const bitrate = allowed.includes(requested) ? requested : Math.min(requested, max);
    const copy =
      container === fallback.container &&
      codec === fallback.audio?.codec &&
      bitrate === fallback.audio.bitrate &&
      fallback.audio.copy;
    audio = {
      codec,
      bitrate: Math.max(1, bitrate),
      channels: Math.min(source.audio.channels, 2),
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
    (!audio || (audio.codec === source.audio?.codec && audio.copy));
  return applyTargetSize(
    {
      overlays,
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
          hasOverlays(overlays)
        ),
      trim: clampTrim(value.trim, source.durationSec, 'end'),
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
        strip: value.metadata?.strip ?? false,
      },
      video,
      audio,
    },
    auto,
    source,
  );
}

/** Compare the effective values shown by the controls, after applying the same limits to both sides. */
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
        )
      : null;
  return (
    Number(!!current.overlays?.text.enabled) +
    Number(!!current.overlays?.image.enabled) +
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
function smallerFor(from: Loaded): { loaded: Loaded; note: string } | null {
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

/** What differs between the Shrink and audio exports; startExport runs the rest for both. */
interface ExportSpec {
  outputName: string;
  mime: string;
  estimate: { low: number; high: number; mid: number };
  job: ConversionJob;
  format(sinkKind: SinkPlan['kind']): OutputFormat;
  /** Runs before the sink opens; a notice stops the export there. */
  preflight(): Promise<Notice | undefined>;
  /** Result info from the settings, for when no Blob can be read back. */
  describe(bytes: number): SourceInfo;
  /** Notice for an unexpected conversion failure. */
  failure: { title: string; message: string };
  /** Notice title when the settings cannot convert this source. */
  invalidTitle: string;
  /** Closes the in-memory size warning: what the user can change to need less memory. */
  memoryAdvice: string;
}

/**
 * DOM-free state machine: owns state, dispatch and the source-loading flow.
 * `onChange` runs after every state change.
 */
export function createController(
  deps: AppDeps,
  onChange: (state: AppState) => void,
): { dispatch(a: AppAction): void; getState(): AppState } {
  let state: AppState = { kind: 'drop' };
  let loadToken = 0;
  let caps: Promise<Capabilities> | undefined;
  let exportToken = 0;
  let imageToken = 0;
  let cancelExport: (() => void) | undefined;

  // Any in-flight read is superseded: its late result is dropped and its Input disposed.
  // Any export in flight is canceled and its late result dropped.
  const cancelLoad = () => {
    loadToken++;
    imageToken++;
    exportToken++;
    cancelExport?.();
    cancelExport = undefined;
  };

  // A prepare-screen change while an export awaits its preflight or save picker drops that
  // export, so it never starts with the settings, trim or tool it was begun with.
  function supersedePending(): void {
    if (state.kind === 'prepare' && state.exporting) exportToken++;
  }

  function setState(next: AppState): void {
    const prev = state;
    const prevInput = inputOf(prev);
    state = next;
    const previousImage = prev.kind !== 'drop' ? prev.overlayAssets?.image : undefined;
    const nextImage = next.kind !== 'drop' ? next.overlayAssets?.image : undefined;
    if (previousImage && previousImage !== nextImage) previousImage.close();
    if (prevInput && inputOf(next) !== prevInput) prevInput.dispose();
    const prevUrl = prev.kind === 'result' ? prev.output.url : null;
    if (prevUrl && !(next.kind === 'result' && next.output.url === prevUrl))
      URL.revokeObjectURL(prevUrl);
    onChange(state);
  }

  function toPrepare(from: Loaded, notice?: Notice): void {
    const {
      file,
      source,
      input,
      auto,
      caps: c,
      settings,
      tool,
      audioAuto,
      audioSettings,
      gifAuto,
      gifSettings,
    } = from;
    setState({
      kind: 'prepare',
      file,
      source,
      input,
      auto,
      caps: c,
      settings,
      tool,
      audioAuto,
      audioSettings,
      gifAuto,
      gifSettings,
      overlayAssets: from.overlayAssets,
      notice,
    });
  }

  function dispatch(action: AppAction): void {
    switch (action.type) {
      case 'pick':
        cancelLoad();
        pick(action.file);
        return;
      case 'continueLarge': {
        const pending = state.kind === 'drop' ? state.notice?.pending : undefined;
        if (pending) void load(pending);
        return;
      }
      case 'dismissNotice':
        if (state.kind === 'prepare') {
          setState({ ...state, notice: undefined });
          return;
        }
        cancelLoad();
        setState({ kind: 'drop' });
        return;
      case 'reading':
        setState({ kind: 'drop', reading: action.name });
        return;
      case 'loaded': {
        const audioAuto = autoAudioExtract(action.source, action.caps);
        const gifAuto = autoGifSettings(action.source);
        setState({
          kind: 'prepare',
          file: action.file,
          source: action.source,
          input: action.input,
          auto: action.auto,
          caps: action.caps,
          settings: { ...action.auto.settings, passthrough: action.auto.alreadyOptimal },
          tool: 'shrink',
          audioAuto,
          audioSettings: audioAuto,
          gifAuto,
          gifSettings: gifAuto,
        });
        return;
      }
      case 'setTool':
        if (
          (state.kind === 'prepare' || state.kind === 'result') &&
          (action.tool === 'shrink' || (action.tool === 'audio' ? state.audioAuto : state.gifAuto))
        ) {
          supersedePending();
          // Drops any notice: a pending memory confirm belongs to the other tool's export.
          toPrepare({ ...state, tool: action.tool });
        }
        return;
      case 'setTrim':
        if (state.kind === 'prepare') {
          supersedePending();
          const moved = action.value.start !== state.settings.trim.start ? 'start' : 'end';
          const trim = clampTrim(action.value, state.source.durationSec, moved);
          setState({
            ...state,
            notice: unlessMemoryConfirm(state.notice),
            exporting: undefined,
            settings: state.settings.targetSizeMB
              ? validateSettings(
                  { ...state.settings, trim, targetRetryScale: undefined },
                  state.auto,
                  state.caps,
                  state.source,
                )
              : { ...state.settings, trim },
            audioSettings: state.audioSettings && { ...state.audioSettings, trim },
            gifSettings: state.gifSettings && { ...state.gifSettings, trim },
          });
        }
        return;
      case 'setAudioSettings':
        if (state.kind === 'prepare' && state.audioAuto) {
          supersedePending();
          const value = validateAudioExtract(
            { ...action.value, trim: state.settings.trim },
            state.audioAuto,
            state.source,
            state.caps,
          );
          setState({
            ...state,
            notice: unlessMemoryConfirm(state.notice),
            exporting: undefined,
            audioSettings: value,
          });
        }
        return;
      case 'setGifSettings':
        if (state.kind === 'prepare' && state.gifAuto) {
          supersedePending();
          setState({
            ...state,
            notice: unlessMemoryConfirm(state.notice),
            exporting: undefined,
            gifSettings: validateGifSettings(
              { ...action.value, trim: state.settings.trim },
              state.gifAuto,
              state.source,
              state.settings.transform,
            ),
          });
        }
        return;
      case 'setOverlayImage':
        if (state.kind === 'prepare' && !state.exporting) void loadOverlayImage(action.file);
        return;
      case 'setSettings':
        if (state.kind === 'prepare') {
          supersedePending();
          const settings = validateSettings(
            preserveQuality(
              state.settings,
              {
                ...action.value,
                trim: state.settings.trim,
                // A retry ratio measured against one target does not carry over to another.
                targetRetryScale:
                  action.value.targetSizeMB === state.settings.targetSizeMB
                    ? action.value.targetRetryScale
                    : undefined,
                passthrough:
                  action.value.passthrough ||
                  (!!action.value.targetSizeMB &&
                    !state.settings.targetSizeMB &&
                    !state.auto.alreadyOptimal),
              },
              state.source,
            ),
            state.auto,
            state.caps,
            state.source,
          );
          setState({
            ...state,
            notice: unlessMemoryConfirm(state.notice),
            exporting: undefined,
            settings,
            gifSettings:
              state.gifSettings && state.gifAuto
                ? validateGifSettings(
                    state.gifSettings,
                    state.gifAuto,
                    state.source,
                    settings.transform,
                  )
                : state.gifSettings,
          });
        }
        return;
      case 'export':
        if (state.kind === 'prepare' && !state.exporting)
          void startExport(state, action.confirmed === true);
        return;
      case 'cancel':
        if (state.kind === 'working') {
          // Return at once: a cancel that lands while Mediabunny is still initialising only
          // settles when init finishes, seconds later on some engines. The job's late
          // rejection is dropped by the token bump in cancelLoad.
          const from = state;
          cancelLoad();
          toPrepare(
            from,
            from.sinkKind === 'file-stream'
              ? { tone: 'info', title: 'Export canceled', message: PARTIAL_FILE }
              : undefined,
          );
        }
        return;
      case 'smaller':
        if (state.kind === 'result') {
          const targetRetry =
            state.tool === 'shrink' && state.settings.targetSizeMB && state.settings.video;
          const next = targetRetry
            ? {
                loaded: {
                  ...state,
                  settings: validateSettings(
                    retryTargetSize(state.settings, state.output.sizeBytes),
                    state.auto,
                    state.caps,
                    state.source,
                  ),
                },
                note: 'The video bitrate is lower. Export again to try the target size.',
              }
            : smallerFor(state);
          toPrepare(
            next ? next.loaded : state,
            next
              ? { tone: 'info', title: 'Settings changed to make it smaller', message: next.note }
              : {
                  tone: 'info',
                  title: 'This is as small as these settings go',
                  message:
                    'Size and quality are already at their lowest. Trim the video shorter to make it smaller.',
                },
          );
        }
        return;
      case 'failed':
        cancelLoad();
        setState({ kind: 'drop', notice: action.notice });
        return;
      case 'reset':
        cancelLoad();
        setState({ kind: 'drop' });
    }
  }

  async function loadOverlayImage(file: File): Promise<void> {
    if (state.kind !== 'prepare') return;
    const input = state.input;
    const token = ++imageToken;
    try {
      const image = await decodeOverlayImage(
        file,
        Math.max(
          state.source.video?.displayWidth ?? 1920,
          state.source.video?.displayHeight ?? 1080,
        ),
      );
      if (
        token !== imageToken ||
        state.kind !== 'prepare' ||
        state.input !== input ||
        state.exporting
      ) {
        image.close();
        return;
      }
      const overlays = normalizeOverlays(state.settings.overlays);
      overlays.image.enabled = true;
      setState({
        ...state,
        overlayAssets: { image },
        settings: validateSettings(
          { ...state.settings, overlays },
          state.auto,
          state.caps,
          state.source,
        ),
        notice: undefined,
      });
    } catch (error) {
      if (token !== imageToken || state.kind !== 'prepare' || state.input !== input) return;
      setState({
        ...state,
        notice: {
          tone: 'error',
          title: 'Image could not be loaded',
          message:
            error instanceof Error ? error.message : 'Choose a PNG, JPEG, WebP or SVG image.',
        },
      });
    }
  }

  function pick(file: File): void {
    // Size is checked before any bytes are read.
    if (file.size > LARGE_FILE_BYTES) {
      dispatch({
        type: 'failed',
        notice: {
          tone: 'warn',
          title: `This video is ${formatBytes(file.size)}`,
          message:
            'Files over 2 GB can run out of memory on phones and tablets, and the tab may reload. Close other tabs first, or trim it shorter.',
          pending: file,
        },
      });
      return;
    }
    void load(file);
  }

  function getCaps(): Promise<Capabilities> {
    // A rejected probe is not cached, so the next pick retries it.
    caps ??= deps.probeCapabilities().catch((err: unknown) => {
      caps = undefined;
      throw err;
    });
    return caps;
  }

  async function load(file: File): Promise<void> {
    const token = ++loadToken;
    dispatch({ type: 'reading', name: file.name });
    try {
      const capabilities = await getCaps();
      if (token !== loadToken) return;
      const { info, input } = await deps.readSource(file);
      if (token !== loadToken) {
        input.dispose();
        return;
      }
      dispatch({
        type: 'loaded',
        file,
        source: info,
        input,
        auto: autoSettings(info, capabilities),
        caps: capabilities,
      });
    } catch (err) {
      if (token !== loadToken) return;
      dispatch({ type: 'failed', notice: noticeForError(file, err) });
    }
  }

  async function startExport(
    prep: Extract<AppState, { kind: 'prepare' }>,
    confirmed: boolean,
  ): Promise<void> {
    if (prep.tool === 'gif' && prep.gifSettings) {
      await startGifExport(prep);
      return;
    }
    const { source, caps: c } = prep;
    // Tool 'audio' always has audioSettings (see Loaded).
    const spec =
      prep.tool === 'audio' && prep.audioSettings
        ? audioSpec(prep, prep.audioSettings)
        : shrinkSpec(prep);
    const { estimate, outputName, mime } = spec;
    const plan = chooseSink({
      estimateBytes: estimate.mid,
      fileStreamSave: c.fileStreamSave,
      deviceMemoryGB: deps.deviceMemoryGB,
    });
    if (plan.kind === 'memory' && plan.warn && !confirmed) {
      setState({
        ...prep,
        notice: {
          tone: 'warn',
          title: `This export may need about ${formatBytes(estimate.high)} of memory`,
          message: `This browser keeps the new file in memory until you save it. Phones and tablets may reload the tab and lose the work. ${spec.memoryAdvice}`,
          confirm: 'memory',
        },
      });
      return;
    }
    const token = ++exportToken;
    const base: Loaded = prep;
    setState({ ...prep, notice: undefined, exporting: true });
    const blocked = await spec.preflight();
    if (token !== exportToken) return;
    if (blocked) {
      toPrepare(base, blocked);
      return;
    }

    let sink: OpenSink;
    try {
      sink = await deps.openSink(plan, outputName, mime);
    } catch (err) {
      if (token !== exportToken) return;
      if (isAbortError(err)) {
        toPrepare(base);
        return;
      }
      console.error('opening the output failed', err);
      toPrepare(base, {
        tone: 'error',
        title: 'The new file could not be created',
        message: 'Choose another place to save it, or try again.',
      });
      return;
    }
    if (token !== exportToken) {
      void sink.abort();
      return;
    }

    let bytes = 0;
    const startedAt = Date.now();
    setState({
      ...base,
      kind: 'working',
      outputName,
      sinkKind: plan.kind,
      estimate,
      progress: 0,
      bytes: 0,
      startedAt,
    });
    try {
      const job = deps.startConversion({
        input: base.input,
        job: spec.job,
        format: spec.format(plan.kind),
        target: sink.target,
        onProgress(p, written) {
          bytes = written;
          if (token === exportToken && state.kind === 'working')
            setState({ ...state, progress: p, bytes: written });
        },
      });
      cancelExport = () => {
        // The abort has to land before Mediabunny closes the stream, or the partial file is committed.
        void sink.abort();
        void job.cancel();
      };
      await job.done;
      const blob = await sink.finish();
      if (token !== exportToken) return;
      cancelExport = undefined;
      const info = blob
        ? await describeBlob(blob, outputName, mime, () => spec.describe(blob.size))
        : spec.describe(bytes);
      if (token !== exportToken) return;
      const sizeBytes = blob ? blob.size : bytes;
      setState({
        ...base,
        kind: 'result',
        outputName,
        sinkKind: plan.kind,
        elapsedMs: Date.now() - startedAt,
        notSmaller: sizeBytes >= source.sizeBytes,
        output: { blob, sizeBytes, url: blob ? URL.createObjectURL(blob) : null, info },
      });
    } catch (err) {
      if (plan.kind === 'file-stream') await sink.abort();
      if (token !== exportToken) return;
      cancelExport = undefined;
      const partial = plan.kind === 'file-stream' ? ` ${PARTIAL_FILE}` : '';
      if (err instanceof ConversionCanceledError) {
        toPrepare(
          base,
          partial ? { tone: 'info', title: 'Export canceled', message: PARTIAL_FILE } : undefined,
        );
      } else if (err instanceof ConversionInvalidError) {
        toPrepare(base, {
          tone: 'error',
          title: spec.invalidTitle,
          message: `${err.message}${partial}`,
        });
      } else {
        console.error('export failed', err);
        toPrepare(base, {
          tone: 'error',
          title: spec.failure.title,
          message: `${spec.failure.message}${partial}`,
        });
      }
    }
  }

  async function startGifExport(prep: Extract<AppState, { kind: 'prepare' }>): Promise<void> {
    const settings = prep.gifSettings;
    if (!settings) return;
    const { width, height } = gifDimensions(settings, prep.source, prep.settings.transform);
    const frames = gifFrameCount(settings.trim, settings.fps);
    const budget = gifBudgetError(width, height, frames);
    if (budget) {
      toPrepare(prep, { tone: 'warn', title: 'GIF is too large', message: budget });
      return;
    }
    const outputName = gifOutputName(prep.file.name);
    const plan: SinkPlan = prep.caps.fileStreamSave
      ? { kind: 'file-stream' }
      : { kind: 'memory', warn: false };
    const token = ++exportToken;
    const base: Loaded = prep;
    setState({ ...prep, notice: undefined, exporting: true });
    let sink;
    try {
      sink = await openGifSink(plan, outputName);
    } catch (err) {
      if (token !== exportToken) return;
      if (isAbortError(err)) {
        toPrepare(base);
        return;
      }
      console.error('opening the GIF output failed', err);
      toPrepare(base, {
        tone: 'error',
        title: 'The GIF file could not be created',
        message: 'Choose another place to save it, or try again.',
      });
      return;
    }
    if (token !== exportToken) {
      void sink.abort();
      return;
    }
    const controller = new AbortController();
    cancelExport = () => {
      controller.abort();
      void sink.abort();
    };
    const startedAt = Date.now();
    setState({
      ...base,
      kind: 'working',
      outputName,
      sinkKind: plan.kind,
      estimate: { low: 0, high: 0 },
      progress: 0,
      bytes: 0,
      startedAt,
    });
    try {
      const bytes = await exportGif(
        base.input,
        base.source,
        settings,
        base.settings.transform,
        controller.signal,
        (progress) => {
          if (token === exportToken && state.kind === 'working') setState({ ...state, progress });
        },
        base.settings.overlays,
        base.overlayAssets,
      );
      if (token !== exportToken) return;
      const blob = await sink.finish(bytes);
      if (token !== exportToken) return;
      cancelExport = undefined;
      const sizeBytes = bytes.byteLength;
      const info: SourceInfo = {
        name: outputName,
        sizeBytes,
        durationSec: settings.trim.end - settings.trim.start,
        containerMime: 'image/gif',
        video: {
          codec: 'gif',
          decodable: true,
          displayWidth: width,
          displayHeight: height,
          rotation: 0,
          fps: settings.fps,
          bitrate: null,
        },
        audio: null,
      };
      setState({
        ...base,
        kind: 'result',
        outputName,
        sinkKind: plan.kind,
        elapsedMs: Date.now() - startedAt,
        notSmaller: sizeBytes >= base.source.sizeBytes,
        output: { blob, sizeBytes, url: blob ? URL.createObjectURL(blob) : null, info },
      });
    } catch (err) {
      await sink.abort();
      if (token !== exportToken) return;
      cancelExport = undefined;
      if (isAbortError(err)) {
        toPrepare(base);
        return;
      }
      console.error('GIF export failed', err);
      toPrepare(base, {
        tone: 'error',
        title: 'The GIF export failed',
        message: 'Could not make the GIF. Try a shorter trim, lower frame rate, or smaller size.',
      });
    }
  }

  function shrinkSpec(prep: Loaded): ExportSpec {
    const { settings, source } = prep;
    const mime = settings.container === 'webm' ? 'video/webm' : 'video/mp4';
    const outputName = outputNameFor(prep.file.name, settings.container);
    return {
      outputName,
      mime,
      estimate: estimateBytes(settings, source),
      job: shrinkJob(settings, source, prep.overlayAssets),
      format: (sinkKind) => createOutputFormat(settings.container, sinkKind),
      async preflight() {
        const v = settings.video;
        if (!v) return undefined;
        let supported = false;
        try {
          supported = await deps.canEncodeVideo(v.codec, {
            width: v.width,
            height: v.height,
            frameRate: v.fps,
          });
        } catch (err) {
          console.warn('export encoder probe failed', err);
        }
        return supported
          ? undefined
          : {
              tone: 'error',
              title: 'The chosen video encoder is unavailable',
              message: `${codecLabel(v.codec)} cannot encode ${v.width}x${v.height} at ${v.fps} fps in this browser. Choose another setting.`,
            };
      },
      describe: (bytes) => describeWritten(outputName, bytes, settings, source, mime),
      failure: {
        title: 'The export failed',
        message:
          'Something went wrong while making the new file. Try again, or choose a smaller size.',
      },
      invalidTitle: 'This video cannot be exported with these settings',
      memoryAdvice: 'Trim it shorter or choose a smaller size to be safe.',
    };
  }

  function audioSpec(prep: Loaded, a: AudioExtractSettings): ExportSpec {
    const { mime, label } = AUDIO_FORMATS[a.format];
    const outputName = audioOutputName(prep.file.name, a.format);
    return {
      outputName,
      mime,
      estimate: estimateAudioBytes(a, prep.source),
      job: audioExtractJob(a),
      format: (sinkKind) => createAudioOutputFormat(a.format, sinkKind),
      async preflight() {
        if (a.format !== 'mp3') return undefined;
        try {
          await deps.ensureMp3Encoder();
          return undefined;
        } catch (err) {
          console.error('loading the MP3 encoder failed', err);
          return {
            tone: 'error',
            title: 'MP3 encoding is unavailable',
            message: 'The MP3 encoder could not be loaded. Choose M4A or WAV, or try again.',
          };
        }
      },
      describe: (bytes) => describeAudioWritten(outputName, bytes, a, prep.source),
      failure: {
        title: `The ${label} export failed`,
        message:
          'Something went wrong while making the new file. Try again, or choose another format.',
      },
      invalidTitle: 'This audio cannot be extracted with these settings',
      memoryAdvice: 'Trim it shorter, or choose a lower bitrate or another format, to be safe.',
    };
  }

  /** Read the output back for the result table; `fallback` stands in if this browser cannot read it. */
  async function describeBlob(
    blob: Blob,
    name: string,
    mime: string,
    fallback: () => SourceInfo,
  ): Promise<SourceInfo> {
    try {
      const { info, input } = await deps.readSource(new File([blob], name, { type: mime }));
      input.dispose();
      return info;
    } catch (err) {
      console.warn('reading the new file back failed; showing the requested settings', err);
      return fallback();
    }
  }

  return { dispatch, getState: () => state };
}

/** A memory confirm was asked for one estimate; a change to trim or settings voids it. */
function unlessMemoryConfirm(notice: Notice | undefined): Notice | undefined {
  return notice?.confirm === 'memory' ? undefined : notice;
}

function noticeForError(file: File, err: unknown): Notice {
  if (err instanceof UnsupportedSourceError) {
    return {
      tone: 'error',
      title: err.codec
        ? `This browser cannot read ${codecLabel(err.codec)} video`
        : 'This file is not a video',
      message: `${file.name}: ${err.message}`,
    };
  }
  console.error('reading the video failed', err);
  return {
    tone: 'error',
    title: 'This video could not be opened',
    message: `${file.name} could not be read. It may be damaged or cut short. Try another file.`,
  };
}

import { ConversionCanceledError, type Input } from 'mediabunny';
import type { probeCapabilities as probeCapabilitiesFn } from '../core/capabilities';
import { autoSettings, scaleToLongEdge, targetVideoBitrate } from '../core/autoSettings';
import { ConversionInvalidError, createOutputFormat, type startConversion as startConversionFn } from '../core/convert';
import { estimateBytes } from '../core/estimate';
import type { readSource as readSourceFn } from '../core/source';
import { UnsupportedSourceError } from '../core/source';
import { chooseSink, type OpenSink, type openSink as openSinkFn, type SinkPlan } from '../core/sink';
import type { AutoResult, Capabilities, Container, Settings, SourceInfo, VideoCodecId } from '../core/types';
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

/** The loaded source and its derived limits, carried from prepare through result. */
interface Loaded {
  file: File;
  source: SourceInfo;
  input: Input;
  auto: AutoResult;
  caps: Capabilities;
  settings: Settings;
}

export type AppState =
  | { kind: 'drop'; notice?: Notice; reading?: string }
  | (Loaded & { kind: 'prepare'; notice?: Notice })
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
  | { type: 'loaded'; file: File; source: SourceInfo; input: Input; auto: AutoResult; caps: Capabilities }
  | { type: 'setTrim'; value: Settings['trim'] }
  | { type: 'setSettings'; value: Settings }
  | { type: 'export'; confirmed?: boolean }
  | { type: 'cancel' }
  | { type: 'smaller' }
  | { type: 'failed'; notice: Notice }
  | { type: 'reset' };

export interface AppDeps {
  probeCapabilities: typeof probeCapabilitiesFn;
  readSource: typeof readSourceFn;
  startConversion: typeof startConversionFn;
  openSink: typeof openSinkFn;
  /** navigator.deviceMemory where the browser reports it. */
  deviceMemoryGB?: number;
}

const CODEC_LABELS: Record<string, string> = { avc: 'H.264', hevc: 'HEVC', vp9: 'VP9', vp8: 'VP8', av1: 'AV1' };
export const codecLabel = (c: string | null) => (c ? (CODEC_LABELS[c] ?? c.toUpperCase()) : 'unknown codec');

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
export function smallerSettings(settings: Settings, auto: AutoResult, source: SourceInfo): { settings: Settings; note: string } | null {
  const v = settings.video;
  const sv = source.video;
  if (v && sv) {
    const edge = Math.max(v.width, v.height);
    const next = auto.sizeSteps.find((step) => step < edge);
    if (next !== undefined) {
      const { width, height } = scaleToLongEdge(sv.displayWidth, sv.displayHeight, next);
      const bitrate = Math.round(Math.min(targetVideoBitrate(v.codec, width, height, v.fps), sv.bitrate ?? Infinity));
      return {
        settings: { ...settings, passthrough: false, video: { ...v, width, height, bitrate } },
        note: `The size is now ${width}x${height}. Export again to try it.`,
      };
    }
    const baseline = Math.min(targetVideoBitrate(v.codec, v.width, v.height, v.fps), sv.bitrate ?? Infinity);
    const percent = Math.round((v.bitrate / baseline) * 100);
    const lower = Math.max(MIN_QUALITY_PERCENT, percent - QUALITY_STEP_PERCENT);
    if (lower >= percent) return null;
    return {
      settings: { ...settings, passthrough: false, video: { ...v, bitrate: Math.round(baseline * lower / 100) } },
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
function describeWritten(name: string, bytes: number, settings: Settings, source: SourceInfo, mime: string): SourceInfo {
  const v = settings.video;
  const a = settings.audio;
  const durationSec = Math.max(0, settings.trim.end - settings.trim.start);
  return {
    name,
    sizeBytes: bytes,
    durationSec,
    containerMime: mime,
    video: v && source.video
      ? settings.passthrough
        ? source.video
        : { codec: v.codec, decodable: true, displayWidth: v.width, displayHeight: v.height, rotation: 0, fps: v.fps, bitrate: v.bitrate }
      : null,
    audio: a && source.audio
      ? settings.passthrough || a.copy
        ? source.audio
        : { codec: a.codec, decodable: true, channels: a.channels, sampleRate: source.audio.sampleRate, bitrate: a.bitrate }
      : null,
  };
}

const CONTAINER_VIDEO: Record<Container, VideoCodecId[]> = {
  mp4: ['avc', 'hevc', 'av1'],
  webm: ['vp9', 'av1'],
};

export function availableVideoCodecs(container: Container, caps: Capabilities): VideoCodecId[] {
  return CONTAINER_VIDEO[container].filter((codec) => caps.video[codec]);
}

/** Apply every source and encoder limit before settings enter controller state. */
export function validateSettings(value: Settings, auto: AutoResult, caps: Capabilities, source: SourceInfo): Settings {
  const fallback = auto.settings;
  const container = availableVideoCodecs(value.container, caps).length &&
    (value.container !== 'webm' || !source.audio || caps.audio.opus) ? value.container : fallback.container;
  const supported = availableVideoCodecs(container, caps);
  let video: Settings['video'] = null;
  if (source.video && fallback.video) {
    const requested = value.video ?? fallback.video;
    const codec = supported.includes(requested.codec) ? requested.codec :
      supported.includes(fallback.video.codec) ? fallback.video.codec : supported[0] ?? fallback.video.codec;
    const sourceEdge = Math.max(source.video.displayWidth, source.video.displayHeight);
    const allowedEdges = [sourceEdge, ...auto.sizeSteps];
    const requestedEdge = Math.max(requested.width, requested.height);
    const edge = allowedEdges.includes(requestedEdge) ? requestedEdge : Math.max(fallback.video.width, fallback.video.height);
    const { width, height } = scaleToLongEdge(source.video.displayWidth, source.video.displayHeight, edge);
    const fps = Number.isFinite(requested.fps) && requested.fps > 0
      ? Math.min(requested.fps, source.video.fps) : fallback.video.fps;
    const baseline = Math.min(targetVideoBitrate(codec, width, height, fps), source.video.bitrate ?? Infinity);
    const bitrate = Number.isFinite(requested.bitrate)
      ? Math.round(Math.min(Math.max(requested.bitrate, baseline * 0.25), baseline * 1.5, source.video.bitrate ?? Infinity))
      : Math.round(baseline);
    video = { codec, width, height, fps, bitrate };
  }
  let audio: Settings['audio'] = null;
  if (source.audio && value.audio) {
    const codec = container === 'webm' ? 'opus' : caps.audio[value.audio.codec] ? value.audio.codec : fallback.audio?.codec ?? 'aac';
    const max = source.audio.bitrate ?? Infinity;
    const allowed = [64_000, 96_000, 128_000, 160_000].filter((n) => n <= max);
    const requested = value.audio.bitrate;
    const bitrate = allowed.includes(requested) ? requested : Math.min(requested, max);
    const copy = container === fallback.container && codec === fallback.audio?.codec &&
      bitrate === fallback.audio.bitrate && fallback.audio.copy;
    audio = { codec, bitrate: Math.max(1, bitrate), channels: Math.min(source.audio.channels, 2), copy };
  }
  return { container, passthrough: auto.alreadyOptimal && value.passthrough,
    trim: clampTrim(value.trim, source.durationSec, 'end'), video, audio };
}

/** Compare the effective values shown by the controls, after applying the same limits to both sides. */
export function settingsChangeCount(value: Settings, auto: AutoResult, caps: Capabilities, source: SourceInfo): number {
  const current = validateSettings(value, auto, caps, source);
  const automatic = validateSettings(auto.settings, auto, caps, source);
  return Number(current.container !== automatic.container) +
    Number(current.video?.codec !== automatic.video?.codec) +
    Number(current.video?.width !== automatic.video?.width || current.video?.height !== automatic.video?.height) +
    Number(current.video?.fps !== automatic.video?.fps) + Number(current.video?.bitrate !== automatic.video?.bitrate) +
    Number(current.audio?.codec !== automatic.audio?.codec) + Number(current.audio?.bitrate !== automatic.audio?.bitrate);
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
  let cancelExport: (() => void) | undefined;

  // Any in-flight read is superseded: its late result is dropped and its Input disposed.
  // Any export in flight is canceled and its late result dropped.
  const cancelLoad = () => {
    loadToken++;
    exportToken++;
    cancelExport?.();
    cancelExport = undefined;
  };

  function setState(next: AppState): void {
    const prev = state;
    const prevInput = inputOf(prev);
    state = next;
    if (prevInput && inputOf(next) !== prevInput) prevInput.dispose();
    const prevUrl = prev.kind === 'result' ? prev.output.url : null;
    if (prevUrl && !(next.kind === 'result' && next.output.url === prevUrl)) URL.revokeObjectURL(prevUrl);
    onChange(state);
  }

  function toPrepare(from: Loaded, notice?: Notice): void {
    const { file, source, input, auto, caps: c, settings } = from;
    setState({ kind: 'prepare', file, source, input, auto, caps: c, settings, notice });
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
      case 'loaded':
        setState({
          kind: 'prepare',
          file: action.file,
          source: action.source,
          input: action.input,
          auto: action.auto,
          caps: action.caps,
          settings: { ...action.auto.settings, passthrough: action.auto.alreadyOptimal },
        });
        return;
      case 'setTrim':
        if (state.kind === 'prepare') {
          const moved = action.value.start !== state.settings.trim.start ? 'start' : 'end';
          const trim = clampTrim(action.value, state.source.durationSec, moved);
          setState({ ...state, settings: { ...state.settings, trim } });
        }
        return;
      case 'setSettings':
        if (state.kind === 'prepare') {
          setState({ ...state, settings: validateSettings(action.value, state.auto, state.caps, state.source) });
        }
        return;
      case 'export':
        if (state.kind === 'prepare') void startExport(state, action.confirmed === true);
        return;
      case 'cancel':
        if (state.kind === 'working') {
          // Return at once: a cancel that lands while Mediabunny is still initialising only
          // settles when init finishes, seconds later on some engines. The job's late
          // rejection is dropped by the token bump in cancelLoad.
          const from = state;
          cancelLoad();
          toPrepare(from, from.sinkKind === 'file-stream' ? { tone: 'info', title: 'Export canceled', message: PARTIAL_FILE } : undefined);
        }
        return;
      case 'smaller':
        if (state.kind === 'result') {
          const next = smallerSettings(state.settings, state.auto, state.source);
          toPrepare(
            next ? { ...state, settings: validateSettings(next.settings, state.auto, state.caps, state.source) } : state,
            next
              ? { tone: 'info', title: 'Settings changed to make it smaller', message: next.note }
              : { tone: 'info', title: 'This is as small as these settings go',
                  message: 'Size and quality are already at their lowest. Trim the video shorter to make it smaller.' },
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
        return;
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
      dispatch({ type: 'loaded', file, source: info, input, auto: autoSettings(info, capabilities), caps: capabilities });
    } catch (err) {
      if (token !== loadToken) return;
      dispatch({ type: 'failed', notice: noticeForError(file, err) });
    }
  }

  async function startExport(prep: Extract<AppState, { kind: 'prepare' }>, confirmed: boolean): Promise<void> {
    const { settings, source, caps: c } = prep;
    const estimate = estimateBytes(settings, source);
    const plan = chooseSink({ estimateBytes: estimate.mid, fileStreamSave: c.fileStreamSave, deviceMemoryGB: deps.deviceMemoryGB });
    if (plan.kind === 'memory' && plan.warn && !confirmed) {
      setState({ ...prep, notice: {
        tone: 'warn',
        title: `This export may need about ${formatBytes(estimate.high)} of memory`,
        message: 'This browser keeps the new file in memory until you save it. Phones and tablets may reload the tab and lose the work. Trim it shorter or choose a smaller size to be safe.',
        confirm: 'memory',
      } });
      return;
    }
    const token = ++exportToken;
    const base: Loaded = prep;
    if (prep.notice) toPrepare(base);
    const mime = settings.container === 'webm' ? 'video/webm' : 'video/mp4';
    const outputName = outputNameFor(prep.file.name, settings.container);

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
      toPrepare(base, { tone: 'error', title: 'The new file could not be created', message: 'Choose another place to save it, or try again.' });
      return;
    }
    if (token !== exportToken) {
      void sink.abort();
      return;
    }

    let bytes = 0;
    const startedAt = Date.now();
    setState({ ...base, kind: 'working', outputName, sinkKind: plan.kind, estimate, progress: 0, bytes: 0, startedAt });
    try {
      const job = deps.startConversion({
        input: base.input,
        settings,
        format: createOutputFormat(settings.container, plan.kind),
        target: sink.target,
        onProgress(p, written) {
          bytes = written;
          if (token === exportToken && state.kind === 'working') setState({ ...state, progress: p, bytes: written });
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
      const info = blob ? await describeBlob(blob, outputName, mime, settings, source) : describeWritten(outputName, bytes, settings, source, mime);
      if (token !== exportToken) return;
      const sizeBytes = blob ? blob.size : bytes;
      setState({
        ...base, kind: 'result', outputName, sinkKind: plan.kind, elapsedMs: Date.now() - startedAt,
        notSmaller: sizeBytes >= source.sizeBytes,
        output: { blob, sizeBytes, url: blob ? URL.createObjectURL(blob) : null, info },
      });
    } catch (err) {
      if (plan.kind === 'file-stream') await sink.abort();
      if (token !== exportToken) return;
      cancelExport = undefined;
      const partial = plan.kind === 'file-stream' ? ` ${PARTIAL_FILE}` : '';
      if (err instanceof ConversionCanceledError) {
        toPrepare(base, partial ? { tone: 'info', title: 'Export canceled', message: PARTIAL_FILE } : undefined);
      } else if (err instanceof ConversionInvalidError) {
        toPrepare(base, { tone: 'error', title: 'This video cannot be exported with these settings', message: `${err.message}${partial}` });
      } else {
        console.error('export failed', err);
        toPrepare(base, { tone: 'error', title: 'The export failed',
          message: `Something went wrong while making the new file. Try again, or choose a smaller size.${partial}` });
      }
    }
  }

  /** Read the output back for the result table; settings stand in if this browser cannot read it. */
  async function describeBlob(blob: Blob, name: string, mime: string, settings: Settings, source: SourceInfo): Promise<SourceInfo> {
    try {
      const { info, input } = await deps.readSource(new File([blob], name, { type: mime }));
      input.dispose();
      return info;
    } catch (err) {
      console.warn('reading the new file back failed; showing the requested settings', err);
      return describeWritten(name, blob.size, settings, source, mime);
    }
  }

  return { dispatch, getState: () => state };
}

function noticeForError(file: File, err: unknown): Notice {
  if (err instanceof UnsupportedSourceError) {
    return {
      tone: 'error',
      title: err.codec ? `This browser cannot read ${codecLabel(err.codec)} video` : 'This file is not a video',
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

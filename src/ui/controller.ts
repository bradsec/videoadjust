import type { Input } from 'mediabunny';
import type { probeCapabilities as probeCapabilitiesFn } from '../core/capabilities';
import { autoSettings } from '../core/autoSettings';
import type { startConversion as startConversionFn } from '../core/convert';
import type { readSource as readSourceFn } from '../core/source';
import { UnsupportedSourceError } from '../core/source';
import type { openSink as openSinkFn } from '../core/sink';
import type { AutoResult, Capabilities, Settings, SourceInfo } from '../core/types';
import { formatBytes } from './format';
import { clampTrim } from './trimBar';

/** Above this the app warns before reading the file (decimal, matching formatBytes). */
export const LARGE_FILE_BYTES = 2e9;

export interface Notice {
  tone: 'warn' | 'error';
  title: string;
  message: string;
  /** A file waiting on the user's "Continue anyway". */
  pending?: File;
}

export type AppState =
  | { kind: 'drop'; notice?: Notice; reading?: string }
  | { kind: 'prepare'; file: File; source: SourceInfo; input: Input; auto: AutoResult; settings: Settings }
  | { kind: 'working'; file: File; source: SourceInfo; input: Input; settings: Settings; progress: number }
  | {
      kind: 'result';
      file: File;
      source: SourceInfo;
      settings: Settings;
      output: { blob: Blob | null; sizeBytes: number; url: string | null };
    };

export type AppAction =
  | { type: 'pick'; file: File }
  | { type: 'continueLarge' }
  | { type: 'dismissNotice' }
  | { type: 'reading'; name: string }
  | { type: 'loaded'; file: File; source: SourceInfo; input: Input; auto: AutoResult }
  | { type: 'setTrim'; value: Settings['trim'] }
  | { type: 'failed'; notice: Notice }
  | { type: 'reset' };

export interface AppDeps {
  probeCapabilities: typeof probeCapabilitiesFn;
  readSource: typeof readSourceFn;
  startConversion: typeof startConversionFn;
  openSink: typeof openSinkFn;
}

const CODEC_LABELS: Record<string, string> = { avc: 'H.264', hevc: 'HEVC', vp9: 'VP9', vp8: 'VP8', av1: 'AV1' };
export const codecLabel = (c: string | null) => (c ? (CODEC_LABELS[c] ?? c.toUpperCase()) : 'unknown codec');

export function inputOf(state: AppState): Input | undefined {
  return state.kind === 'prepare' || state.kind === 'working' ? state.input : undefined;
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

  // Any in-flight read is superseded: its late result is dropped and its Input disposed.
  const cancelLoad = () => {
    loadToken++;
  };

  function setState(next: AppState): void {
    const prevInput = inputOf(state);
    state = next;
    if (prevInput && inputOf(next) !== prevInput) prevInput.dispose();
    onChange(state);
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
          settings: action.auto.settings,
        });
        return;
      case 'setTrim':
        if (state.kind === 'prepare') {
          const moved = action.value.start !== state.settings.trim.start ? 'start' : 'end';
          const trim = clampTrim(action.value, state.source.durationSec, moved);
          setState({ ...state, settings: { ...state.settings, trim } });
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
      dispatch({ type: 'loaded', file, source: info, input, auto: autoSettings(info, capabilities) });
    } catch (err) {
      if (token !== loadToken) return;
      dispatch({ type: 'failed', notice: noticeForError(file, err) });
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

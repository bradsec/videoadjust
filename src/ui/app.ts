import type { Input } from 'mediabunny';
import type { probeCapabilities as probeCapabilitiesFn } from '../core/capabilities';
import { autoSettings } from '../core/autoSettings';
import type { startConversion as startConversionFn } from '../core/convert';
import type { readSource as readSourceFn } from '../core/source';
import { UnsupportedSourceError } from '../core/source';
import type { openSink as openSinkFn } from '../core/sink';
import type { AutoResult, Capabilities, Settings, SourceInfo } from '../core/types';
import { el, icon } from './dom';
import { mountDropZone } from './dropZone';
import { formatBytes, formatDuration } from './format';

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
  | { type: 'failed'; notice: Notice }
  | { type: 'reset' };

export interface AppDeps {
  probeCapabilities: typeof probeCapabilitiesFn;
  readSource: typeof readSourceFn;
  startConversion: typeof startConversionFn;
  openSink: typeof openSinkFn;
}

const CODEC_LABELS: Record<string, string> = { avc: 'H.264', hevc: 'HEVC', vp9: 'VP9', vp8: 'VP8', av1: 'AV1' };
const codecLabel = (c: string | null) => (c ? (CODEC_LABELS[c] ?? c.toUpperCase()) : 'unknown codec');

/** "212 MB · 3840x2160 · 60 fps · HEVC · 1:24.6" */
export function summarySource(s: SourceInfo): string {
  const parts = [formatBytes(s.sizeBytes)];
  if (s.video) {
    parts.push(`${s.video.displayWidth}x${s.video.displayHeight}`);
    parts.push(`${Number(s.video.fps.toFixed(1))} fps`);
    parts.push(codecLabel(s.video.codec));
  } else if (s.audio) {
    parts.push(`${codecLabel(s.audio.codec)} audio`);
  }
  parts.push(formatDuration(s.durationSec));
  return parts.join(' · ');
}

export function createApp(root: HTMLElement, deps: AppDeps): { dispatch(a: AppAction): void; getState(): AppState } {
  let state: AppState = { kind: 'drop' };
  let loadToken = 0;
  let caps: Promise<Capabilities> | undefined;

  const noticeSlot = el('div', 'notice-slot');
  const status = el('p', 'sr');
  status.setAttribute('role', 'status');
  const view = el('div', 'view');
  root.replaceChildren(noticeSlot, status, view);

  let mountedKind: AppState['kind'] | null = null;
  let dropZone: { focusPicker(): void } | undefined;

  // The browser would otherwise navigate to a file dropped outside the zone.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  function dispatch(action: AppAction): void {
    switch (action.type) {
      case 'pick':
        pick(action.file);
        return;
      case 'continueLarge': {
        const pending = state.kind === 'drop' ? state.notice?.pending : undefined;
        if (pending) void load(pending);
        return;
      }
      case 'dismissNotice':
        setState({ kind: 'drop' });
        dropZone?.focusPicker();
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
      case 'failed':
        setState({ kind: 'drop', notice: action.notice });
        return;
      case 'reset':
        loadToken++;
        setState({ kind: 'drop' });
        return;
    }
  }

  function setState(next: AppState): void {
    const prev = state;
    state = next;
    if ((prev.kind === 'prepare' || prev.kind === 'working') && next !== prev && !('input' in next && next.input === prev.input)) {
      prev.input.dispose();
    }
    render();
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

  async function load(file: File): Promise<void> {
    const token = ++loadToken;
    dispatch({ type: 'reading', name: file.name });
    try {
      caps ??= deps.probeCapabilities();
      const [capabilities, { info, input }] = await Promise.all([caps, deps.readSource(file)]);
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

  function render(): void {
    renderNotice();
    status.textContent = state.kind === 'drop' && state.reading ? `Reading ${state.reading}` : '';
    // The drop screen stays mounted across notice changes so the picker keeps focus.
    if (state.kind === mountedKind && state.kind === 'drop') return;
    mountedKind = state.kind;
    dropZone = undefined;
    switch (state.kind) {
      case 'drop':
        dropZone = mountDropZone(view, (file) => dispatch({ type: 'pick', file }));
        return;
      case 'prepare':
        renderPrepare(view, state, () => dispatch({ type: 'reset' }));
        return;
      case 'working':
      case 'result':
        // Rendered by the progress and result tasks.
        view.replaceChildren();
        return;
    }
  }

  function renderNotice(): void {
    const notice = state.kind === 'drop' ? state.notice : undefined;
    if (!notice) {
      noticeSlot.replaceChildren();
      return;
    }
    // role=alert is an assertive live region: inserting the box announces it.
    const box = el('div', `notice ${notice.tone}`);
    box.setAttribute('role', 'alert');
    box.append(icon(notice.tone === 'error' ? 'i-stop' : 'i-warn'));
    const body = el('div', 'body');
    body.append(el('h2', undefined, notice.title), el('p', undefined, notice.message));
    const row = el('div', 'row');
    if (notice.pending) {
      const go = el('button', 'btn', 'Continue anyway');
      go.type = 'button';
      go.addEventListener('click', () => dispatch({ type: 'continueLarge' }));
      row.append(go);
    }
    const another = el('button', notice.pending ? 'btn btn-quiet' : 'btn', 'Choose another video');
    another.type = 'button';
    another.addEventListener('click', () => dispatch({ type: 'dismissNotice' }));
    row.append(another);
    body.append(row);
    box.append(body);
    noticeSlot.replaceChildren(box);
  }

  render();
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

/** Prepare screen. Trim, settings and the estimate mount into the regions below in later tasks. */
function renderPrepare(
  container: HTMLElement,
  state: Extract<AppState, { kind: 'prepare' }>,
  onReset: () => void,
): void {
  const head = el('div', 'file-line');
  head.append(el('h1', 'file-name', state.file.name), el('p', 'file-summary num', summarySource(state.source)));
  const stage = el('div', 'prepare-regions');
  stage.dataset.region = 'prepare';
  const another = el('button', 'btn btn-quiet', 'Choose another video');
  another.type = 'button';
  another.addEventListener('click', onReset);
  container.replaceChildren(head, stage, another);
}

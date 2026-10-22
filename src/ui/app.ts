import { CanvasSink } from 'mediabunny';
import type { Settings, SourceInfo } from '../core/types';
import { mountCompare } from './compare';
import {
  codecLabel,
  createController,
  type AppAction,
  type AppDeps,
  type AppState,
  type Notice,
} from './controller';
import { el, icon } from './dom';
import { mountDropZone } from './dropZone';
import { formatBitrate, formatBytes, formatDuration } from './format';
import { mountProgress, scaleRow } from './progress';
import { mountSettings } from './settingsPanel';
import { mountTrimBar } from './trimBar';

type Of<K extends AppState['kind']> = Extract<AppState, { kind: K }>;
interface Mounted {
  update(value: AppState): void;
  destroy(): void;
}

export * from './controller';

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

export function createApp(
  root: HTMLElement,
  deps: AppDeps,
): { dispatch(a: AppAction): void; getState(): AppState } {
  const controller = createController(deps, () => render());
  const { dispatch } = controller;
  const state = () => controller.getState();

  const noticeSlot = el('div', 'notice-slot');
  const status = el('p', 'sr');
  status.setAttribute('role', 'status');
  const view = el('div', 'view');
  root.replaceChildren(noticeSlot, status, view);

  let mountedKind: AppState['kind'] | null = null;
  let dropZone: { focusPicker(): void } | undefined;
  let mounted: Mounted | undefined;
  let shownNotice: Notice | undefined;

  // The browser would otherwise navigate to a file dropped outside the zone.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  function render(): void {
    const s = state();
    renderNotice(s);
    status.textContent =
      s.kind === 'drop' && s.reading
        ? `Reading ${s.reading}`
        : s.kind === 'result'
          ? 'Export finished'
          : '';
    // The drop screen stays mounted across notice changes so the picker keeps focus.
    if (s.kind === mountedKind && s.kind === 'drop') return;
    if (s.kind === mountedKind && mounted) {
      mounted.update(s);
      return;
    }
    mounted?.destroy();
    mounted = undefined;
    mountedKind = s.kind;
    dropZone = undefined;
    switch (s.kind) {
      case 'drop':
        dropZone = mountDropZone(view, (file) => dispatch({ type: 'pick', file }));
        return;
      case 'prepare':
        mounted = renderPrepare(
          view,
          s,
          () => dispatch({ type: 'reset' }),
          (value) => dispatch({ type: 'setTrim', value }),
          (value) => dispatch({ type: 'setSettings', value }),
          () => dispatch({ type: 'export' }),
        );
        return;
      case 'working':
        mounted = renderWorking(view, s, () => dispatch({ type: 'cancel' }));
        return;
      case 'result':
        mounted = renderResult(view, s, dispatch);
    }
  }

  function renderNotice(s: AppState): void {
    const notice = s.kind === 'drop' || s.kind === 'prepare' ? s.notice : undefined;
    // Re-rendering the same notice would re-announce it and drop focus from its buttons.
    if (notice === shownNotice) return;
    shownNotice = notice;
    if (!notice) {
      noticeSlot.replaceChildren();
      return;
    }
    // role=alert is an assertive live region: inserting the box announces it.
    const box = el('div', `notice ${notice.tone}`);
    box.setAttribute('role', 'alert');
    box.append(
      icon(notice.tone === 'error' ? 'i-stop' : notice.tone === 'info' ? 'i-info' : 'i-warn'),
    );
    const body = el('div', 'body');
    body.append(el('h2', undefined, notice.title), el('p', undefined, notice.message));
    const row = el('div', 'row');
    if (s.kind === 'prepare') {
      if (notice.confirm === 'memory') {
        const go = el('button', 'btn', 'Continue');
        go.type = 'button';
        go.addEventListener('click', () => dispatch({ type: 'export', confirmed: true }));
        row.append(go);
      }
      const back = el(
        'button',
        notice.confirm ? 'btn btn-quiet' : 'btn',
        notice.confirm ? 'Go back' : 'Dismiss',
      );
      back.type = 'button';
      back.addEventListener('click', () => dispatch({ type: 'dismissNotice' }));
      row.append(back);
      body.append(row);
      box.append(body);
      noticeSlot.replaceChildren(box);
      return;
    }
    if (notice.pending) {
      const go = el('button', 'btn', 'Continue anyway');
      go.type = 'button';
      go.addEventListener('click', () => dispatch({ type: 'continueLarge' }));
      row.append(go);
    }
    const another = el('button', notice.pending ? 'btn btn-quiet' : 'btn', 'Choose another video');
    another.type = 'button';
    another.addEventListener('click', () => {
      dispatch({ type: 'dismissNotice' });
      dropZone?.focusPicker();
    });
    row.append(another);
    body.append(row);
    box.append(body);
    noticeSlot.replaceChildren(box);
  }

  render();
  return controller;
}

/** Prepare screen. */
function renderPrepare(
  container: HTMLElement,
  state: Extract<AppState, { kind: 'prepare' }>,
  onReset: () => void,
  onTrim: (value: { start: number; end: number }) => void,
  onSettings: (value: Extract<AppState, { kind: 'prepare' }>['settings']) => void,
  onExport: () => void,
): Mounted {
  const head = el('div', 'file-line');
  head.append(
    el('h1', 'file-name', state.file.name),
    el('p', 'file-summary num', summarySource(state.source)),
  );
  const stage = el('div', 'prepare-regions');
  stage.dataset.region = 'prepare';
  const video = el('video', 'preview-video');
  video.controls = true;
  video.playsInline = true;
  video.loop = true;
  video.preload = 'metadata';
  const url = URL.createObjectURL(state.file);
  video.src = url;
  const trimHost = el('div');
  const settingsHost = el('aside', 'settings-host');
  const settings = mountSettings(settingsHost, {
    auto: state.auto,
    caps: state.caps,
    source: state.source,
    value: state.settings,
    onChange: onSettings,
    onExport,
  });
  const thumbnails = async (count: number): Promise<HTMLCanvasElement[]> => {
    const track = await state.input.getPrimaryVideoTrack();
    if (!track) return [];
    const sink = new CanvasSink(track, { width: 160 });
    const timestamps = Array.from(
      { length: count },
      (_, i) => (state.source.durationSec * (i + 0.5)) / count,
    );
    const canvases: HTMLCanvasElement[] = [];
    for await (const frame of sink.canvasesAtTimestamps(timestamps)) {
      const canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = 90;
      if (frame) {
        canvas.height = frame.canvas.height;
        canvas.getContext('2d')?.drawImage(frame.canvas, 0, 0);
      }
      canvases.push(canvas);
    }
    return canvases;
  };
  const trim = mountTrimBar(trimHost, {
    duration: state.source.durationSec,
    value: state.settings.trim,
    video,
    thumbnails,
    onChange: onTrim,
  });
  stage.append(video, trimHost, settingsHost);
  const another = el('button', 'btn btn-quiet', 'Choose another video');
  another.type = 'button';
  another.addEventListener('click', onReset);
  container.replaceChildren(head, stage, another);
  function update(value: AppState): void {
    if (value.kind !== 'prepare') return;
    trim.update(value.settings.trim);
    settings.update(value.settings);
  }
  update(state);
  return {
    update,
    destroy() {
      trim.destroy();
      video.pause();
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
    },
  };
}

const CONTAINER_LABELS: Record<string, string> = {
  'video/mp4': 'MP4',
  'video/quicktime': 'MOV',
  'video/webm': 'WebM',
  'video/x-matroska': 'MKV',
  'audio/mp4': 'MP4',
  'audio/webm': 'WebM',
};
const containerLabel = (mime: string) => {
  const base = mime.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return CONTAINER_LABELS[base] ?? (base.split('/')[1]?.toUpperCase() || 'unknown');
};
const audioLabels: Record<string, string> = { aac: 'AAC', opus: 'Opus', mp3: 'MP3' };
const audioLabel = (c: string | null) => (c ? (audioLabels[c] ?? c.toUpperCase()) : 'unknown');
const clock = (ms: number) => formatDuration(Math.round(ms / 1000));

/** "1080p · H.264/AAC MP4" */
function summaryOutput(settings: Settings): string {
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

/** A heading that takes focus when its screen appears, so the change is announced. */
function screenHeading(className: string): HTMLHeadingElement {
  const h = el('h1', className);
  h.tabIndex = -1;
  return h;
}

/** Working screen: what is being made, a still of the source near the encode position, and progress. */
function renderWorking(
  container: HTMLElement,
  state: Of<'working'>,
  onCancel: () => void,
): Mounted {
  const head = el('div', 'file-line');
  const title = screenHeading('file-name');
  title.textContent = `Exporting ${state.outputName}`;
  head.append(title, el('p', 'file-summary num', summaryOutput(state.settings)));

  const stage = el('div', 'stage working-stage');
  const video = el('video', 'stage-video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'metadata';
  video.setAttribute('aria-hidden', 'true');
  const url = URL.createObjectURL(state.file);
  video.src = url;
  // Seeking once makes the browser decode and show a frame; preload alone may leave it black.
  video.addEventListener(
    'loadedmetadata',
    () => {
      video.currentTime = state.settings.trim.start;
    },
    { once: true },
  );
  const overlay = el('span', 'overlay-time num');
  stage.append(video, overlay);

  const progressHost = el('div');
  const progress = mountProgress(progressHost, {
    onCancel,
    originalBytes: state.source.sizeBytes,
    expected: state.estimate,
  });
  const note = el(
    'p',
    'note',
    'Keep this tab open until it finishes. Your phone may get warm; that is normal for video work.',
  );
  const col = el('div', 'col');
  col.append(head, stage, progressHost, note);
  container.replaceChildren(col);
  title.focus();

  const { start, end } = state.settings.trim;
  const span = Math.max(0, end - start);
  let lastSeek = -Infinity;
  // Seeking the preview competes with the encoder for decode time, so it moves rarely.
  const SEEK_EVERY_MS = 2000;
  function update(value: AppState): void {
    if (value.kind !== 'working') return;
    const elapsed = Date.now() - value.startedAt;
    progress.update(value.progress, value.bytes, elapsed);
    const at = span * value.progress;
    overlay.textContent = `Encoding ${formatDuration(at)} of ${formatDuration(span)}`;
    if (elapsed - lastSeek >= SEEK_EVERY_MS && video.readyState > 0) {
      lastSeek = elapsed;
      video.currentTime = start + at;
    }
  }
  update(state);
  return {
    update,
    destroy() {
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
    },
  };
}

function statsTable(
  source: SourceInfo,
  output: SourceInfo,
  settings: Settings,
  notSmaller: boolean,
): HTMLTableElement {
  const table = el('table', 'stats');
  const caption = el('caption', 'sr', 'Original and new video compared');
  const thead = el('thead');
  const headRow = el('tr');
  const prop = el('th');
  prop.scope = 'col';
  prop.append(el('span', 'sr', 'Property'));
  const colOrig = el('th', undefined, 'Original');
  colOrig.scope = 'col';
  const colNew = el('th', undefined, 'New');
  colNew.scope = 'col';
  headRow.append(prop, colOrig, colNew);
  thead.append(headRow);
  const tbody = el('tbody', 'num');

  const resolution = (i: SourceInfo) =>
    i.video ? `${i.video.displayWidth}x${i.video.displayHeight}` : 'No video';
  const fps = (i: SourceInfo) => (i.video ? `${Number(i.video.fps.toFixed(2))} fps` : '-');
  const video = (i: SourceInfo) =>
    `${i.video ? codecLabel(i.video.codec) : 'No video'}, ${containerLabel(i.containerMime)}`;
  const audio = (i: SourceInfo) =>
    i.audio
      ? [audioLabel(i.audio.codec), i.audio.bitrate ? formatBitrate(i.audio.bitrate) : null]
          .filter(Boolean)
          .join(' ')
      : 'None';
  const bitrate = (i: SourceInfo) =>
    i.durationSec > 0 ? formatBitrate((i.sizeBytes * 8) / i.durationSec) : '-';
  const row = (label: string, a: string, b: string | (string | Node)[]) => {
    const tr = el('tr');
    const th = el('th', undefined, label);
    th.scope = 'row';
    const td = el('td', 'new');
    td.append(...(typeof b === 'string' ? [b] : b));
    tr.append(th, el('td', undefined, a), td);
    tbody.append(tr);
  };
  row('Size', formatBytes(source.sizeBytes), formatBytes(output.sizeBytes));
  if (source.video || output.video) {
    row('Resolution', resolution(source), resolution(output));
    row('Frame rate', fps(source), fps(output));
    row('Video', video(source), video(output));
  }
  row('Audio', audio(source), audio(output));
  row('Bitrate', bitrate(source), bitrate(output));
  const trimmed = settings.trim.end - settings.trim.start < source.durationSec - 0.05;
  row(
    'Duration',
    formatDuration(source.durationSec),
    trimmed
      ? [formatDuration(output.durationSec), el('span', 'delta', 'trimmed')]
      : formatDuration(output.durationSec),
  );

  const total = el('tr', 'total');
  const th = el('th', undefined, notSmaller ? 'Change' : 'Reduction');
  th.scope = 'row';
  const td = el('td', undefined, reductionText(source.sizeBytes, output.sizeBytes));
  td.colSpan = 2;
  total.append(th, td);
  tbody.append(total);
  table.append(caption, thead, tbody);
  return table;
}

/** "90% smaller", "12% larger", "Same size" */
function reductionText(before: number, after: number): string {
  if (before <= 0) return '-';
  const change = Math.round((1 - after / before) * 100);
  if (after < before) return `${Math.max(1, change)}% smaller`;
  if (change === 0) return 'Same size';
  return `${-change}% larger`;
}

/** Result screen: verdict, wipe comparison, stats and the next actions. */
function renderResult(
  container: HTMLElement,
  state: Of<'result'>,
  dispatch: (a: AppAction) => void,
): Mounted {
  const { output, source } = state;
  const split = el('div', 'split');
  const main = el('div', 'main-col');
  const side = el('aside', 'side-col');
  side.setAttribute('aria-label', 'Details and actions');

  const verdict = el('div', 'verdict');
  const figure = screenHeading('figure num');
  figure.append(
    `${formatBytes(output.sizeBytes)}, `,
    el(
      'em',
      undefined,
      state.notSmaller ? 'not smaller' : reductionText(source.sizeBytes, output.sizeBytes),
    ),
  );
  verdict.append(
    el('span', 'eyebrow', `Done in ${clock(state.elapsedMs)}`),
    figure,
    el(
      'p',
      undefined,
      output.blob
        ? `${state.outputName} is ready to send.`
        : `${state.outputName} is saved where you chose.`,
    ),
  );
  main.append(verdict);

  let notice: HTMLElement | undefined;
  if (state.notSmaller) {
    notice = el('div', 'notice warn not-smaller');
    notice.setAttribute('role', 'alert');
    const body = el('div', 'body');
    body.append(
      el('h2', undefined, 'The new file is not smaller than the original'),
      el(
        'p',
        undefined,
        'This video was already compressed well. Make it smaller tries the next smaller size, or lower quality if no smaller size is left.',
      ),
    );
    notice.append(icon('i-warn'), body);
    main.append(notice);
  }

  let compare: { destroy(): void } | undefined;
  let originalUrl: string | undefined;
  if (output.url && output.info.video && source.video) {
    const host = el('div', 'compare');
    originalUrl = URL.createObjectURL(state.file);
    compare = mountCompare(host, {
      original: originalUrl,
      output: output.url,
      originalInfo: source,
      outputInfo: output.info,
      offsetSec: state.settings.trim.start,
    });
    main.append(host);
  } else if (!output.blob) {
    main.append(
      el(
        'p',
        'note compare-skipped',
        'The new file went straight to the place you chose, so there is no side-by-side preview here. Open it from there to watch it.',
      ),
    );
  }

  const scale = el('div', 'scale');
  scale.setAttribute('aria-hidden', 'true');
  const orig = scaleRow('Original', 'orig');
  orig.value.textContent = formatBytes(source.sizeBytes);
  const now = scaleRow('New', 'new');
  now.value.textContent = formatBytes(output.sizeBytes);
  now.fill.style.width = `${Math.min(100, source.sizeBytes > 0 ? (output.sizeBytes / source.sizeBytes) * 100 : 100)}%`;
  scale.append(orig.node, now.node);
  main.append(scale);

  const stats = el('div', 'card stats-card');
  stats.append(statsTable(source, output.info, state.settings, state.notSmaller));

  const actions = el('div', 'actions');
  if (output.url) {
    const download = el('a', 'btn btn-primary');
    download.href = output.url;
    download.download = state.outputName;
    download.append(icon('i-down'), 'Download ', el('span', 'file', state.outputName));
    actions.append(download);
  }
  const shareNote = el('p', 'note share-note');
  shareNote.hidden = true;
  if (output.blob && state.caps.shareFiles && typeof navigator.share === 'function') {
    const blob = output.blob;
    const share = el('button', 'btn btn-share');
    share.type = 'button';
    share.append(icon('i-share'), 'Share');
    share.addEventListener('click', () => {
      const file = new File([blob], state.outputName, { type: blob.type });
      navigator.share({ files: [file] }).catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        console.error('sharing failed', err);
        shareNote.textContent = 'Sharing did not work here. Use Download instead.';
        shareNote.hidden = false;
      });
    });
    actions.append(share);
  }
  const smaller = el('button', state.notSmaller ? 'btn btn-quiet is-suggested' : 'btn btn-quiet');
  smaller.type = 'button';
  smaller.append(icon('i-smaller'), 'Make it smaller');
  smaller.addEventListener('click', () => dispatch({ type: 'smaller' }));
  const restart = el('button', 'btn btn-quiet');
  restart.type = 'button';
  restart.append(icon('i-restart'), 'Start over');
  restart.addEventListener('click', () => dispatch({ type: 'reset' }));
  actions.append(smaller, restart);
  side.append(stats, actions, shareNote);

  split.append(main, side);
  container.replaceChildren(split);
  figure.focus();

  return {
    update() {},
    destroy() {
      compare?.destroy();
      if (originalUrl) URL.revokeObjectURL(originalUrl);
    },
  };
}

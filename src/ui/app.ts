import { CanvasSink } from 'mediabunny';
import { AUDIO_FORMATS, audioUnavailable, type AudioExtractSettings } from '../core/audioExtract';
import { writesWhileEncoding } from '../core/convert';
import { exportCurrentFrame } from '../core/frameExport';
import { openImageSink, type GifSink } from '../core/sink';
import { gifDimensions, gifUnavailable } from '../core/gifExport';
import { hasStyleEffects, normalizeStyle } from '../core/style';
import type { Settings, SourceInfo } from '../core/types';
import { mountAudioPanel } from './audioPanel';
import { mountAudioPlayer } from './audioPlayer';
import { canPlaySource, mountCompare } from './compare';
import { mountCropEditor } from './cropEditor';
import { mountOverlayEditor } from './overlayEditor';
import { mountOverlayPanel } from './overlayPanel';
import {
  codecLabel,
  createController,
  type AppAction,
  type AppDeps,
  type AppState,
  type Notice,
  type Tool,
} from './controller';
import { el, icon } from './dom';
import { mountDropZone } from './dropZone';
import { formatBitrate, formatBytes, formatDuration } from './format';
import { mountGifPanel } from './gifPanel';
import { mountLivePreview } from './livePreview';
import { mountPreviewAudio, type PreviewAudioTarget } from './previewAudio';
import { mountProgress, sizeMeter } from './progress';
import { mountSettings } from './settingsPanel';
import { mountStylePanel } from './stylePanel';
import { mountToolTabs, TOOL_PANEL_ID, toolTabId } from './toolTabs';
import { mountTrimBar } from './trimBar';
import { computePeaks } from './waveform';

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
    // Prepare borrows the notice slot; every other screen shows it above the view.
    if (noticeSlot.parentElement !== root) root.prepend(noticeSlot);
    mountedKind = s.kind;
    dropZone = undefined;
    // A new screen starts at the top; a shorter one would otherwise keep the previous
    // screen's scroll offset and show empty space. Mounting may then focus and scroll.
    window.scrollTo(0, 0);
    switch (s.kind) {
      case 'drop':
        dropZone = mountDropZone(view, (file) => dispatch({ type: 'pick', file }));
        return;
      case 'prepare':
        mounted = renderPrepare(view, s, dispatch, noticeSlot);
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
        notice.confirm ? 'btn btn-text' : 'btn',
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
    const another = el('button', notice.pending ? 'btn btn-text' : 'btn', 'Choose another video');
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
  state: Of<'prepare'>,
  dispatch: (a: AppAction) => void,
  noticeSlot: HTMLElement,
): Mounted {
  const onExport = () => dispatch({ type: 'export' });
  const head = el('div', 'file-line');
  const fileText = el('div', 'file-text');
  const title = screenHeading('file-name');
  title.textContent = state.file.name;
  fileText.append(title, el('p', 'file-summary num', summarySource(state.source)));
  head.append(fileText);
  const stage = el('div', 'prepare-regions work');
  stage.dataset.region = 'prepare';
  const canvas = el('div', 'canvas');
  const theater = el('button', 'btn btn-text theater-toggle');
  theater.type = 'button';
  theater.title = 'Use a wider preview with a fixed-width controls panel';
  theater.append(icon('i-theater'), 'Theater mode');
  let theaterOn = false;
  try {
    theaterOn = localStorage.getItem('videoadjust-theater') === 'true';
  } catch {
    // Browsers can block storage; the default layout still works.
  }
  document.body.classList.toggle('is-theater', theaterOn);
  theater.setAttribute('aria-pressed', String(theaterOn));
  theater.addEventListener('click', () => {
    theaterOn = !theaterOn;
    document.body.classList.toggle('is-theater', theaterOn);
    theater.setAttribute('aria-pressed', String(theaterOn));
    try {
      localStorage.setItem('videoadjust-theater', String(theaterOn));
    } catch {
      // Theater mode remains usable when storage is unavailable.
    }
  });
  const toolsHost = el('div', 'tools-host');
  const video = el('video', 'preview-video');
  video.controls = true;
  video.playsInline = true;
  video.loop = true;
  video.preload = 'metadata';
  const url = URL.createObjectURL(state.file);
  const previewNote = el(
    'p',
    'note preview-note',
    'This browser cannot play the preview. Trimming still works with the handles and thumbnails. The trim Set buttons require a playable preview.',
  );
  previewNote.hidden = true;
  const trimHost = el('div');
  const settingsHost = el('aside', 'settings-host inspector');
  const panelHost = el('div', 'tool-panel');
  panelHost.id = TOOL_PANEL_ID;
  panelHost.setAttribute('role', 'tabpanel');
  const styleDetails = el('details', 'adjust style-adjust');
  let styleUnavailable = '';
  const probe = document.createElement('canvas').getContext('webgl2');
  if (!probe) styleUnavailable = 'Video styles need WebGL2 in this browser.';
  else probe.getExtension('WEBGL_lose_context')?.loseContext();
  // Overlays apply to Shrink and GIF alike, so their controls sit below whichever panel shows.
  const overlayDetails = el('details', 'adjust overlay-adjust');
  const overlayHeading = el('summary');
  const overlayState = el('span', 'adjust-state');
  overlayHeading.append('Overlay', overlayState, icon('i-chev'));
  overlayDetails.append(overlayHeading);
  settingsHost.append(panelHost, styleDetails, overlayDetails);
  let current = state;
  const stylePanel = mountStylePanel(styleDetails, state.settings.style, (style) =>
    dispatch({ type: 'setSettings', value: { ...current.settings, style } }),
  );
  const changeOverlays = (overlays: Settings['overlays']) =>
    dispatch({ type: 'setSettings', value: { ...current.settings, overlays } });
  const overlayPanel = mountOverlayPanel(
    overlayDetails,
    state.settings.overlays,
    changeOverlays,
    (file) => dispatch({ type: 'setOverlayImage', file }),
  );
  const tabs = mountToolTabs(toolsHost, {
    value: state.tool,
    disabledReason: audioReason(state),
    gifDisabledReason: gifReason(state),
    onChange: (tool) => dispatch({ type: 'setTool', tool }),
  });
  // Under 700px app.css fixes the dock to the viewport bottom; --dock-space reserves its
  // height at the page foot so the footer and the last controls can scroll clear of it.
  const root = document.documentElement;
  const dockSpace = new ResizeObserver(() => {
    const dock = panelHost.querySelector<HTMLElement>('.dock');
    const fixed = dock !== null && getComputedStyle(dock).position === 'fixed';
    root.style.setProperty('--dock-space', fixed && dock ? `${dock.offsetHeight}px` : '0px');
  });
  let shownTool: Tool | undefined;
  let changeTransform: ((t: NonNullable<Settings['transform']>) => void) | undefined;
  let panel: { update(value: Of<'prepare'>): void; setBusy(busy: boolean): void } | undefined;
  // Each tool's panel is mounted fresh on a switch; its settings live in the controller.
  function showPanel(value: Of<'prepare'>): void {
    shownTool = value.tool;
    panelHost.setAttribute('aria-labelledby', toolTabId(value.tool));
    if (value.tool === 'audio' && value.audioAuto && value.audioSettings) {
      changeTransform = undefined;
      const audio = mountAudioPanel(panelHost, {
        auto: value.audioAuto,
        source: value.source,
        caps: value.caps,
        value: value.audioSettings,
        onChange: (next) => dispatch({ type: 'setAudioSettings', value: next }),
        onExport,
      });
      panel = {
        update: (s) => s.audioSettings && audio.update(s.audioSettings),
        setBusy: audio.setBusy,
      };
      return;
    }
    if (value.tool === 'gif' && value.gifSettings) {
      const gif = mountGifPanel(panelHost, {
        value: value.gifSettings,
        source: value.source,
        transform: value.settings.transform,
        onChange: (next) => dispatch({ type: 'setGifSettings', value: next }),
        onExport,
      });
      changeTransform = (transform) =>
        dispatch({ type: 'setSettings', value: { ...current.settings, transform } });
      panel = {
        update: (s) => s.gifSettings && gif.update(s.gifSettings, s.settings.transform),
        setBusy: gif.setBusy,
      };
      return;
    }
    const shrink = mountSettings(panelHost, {
      auto: value.auto,
      caps: value.caps,
      source: value.source,
      value: value.settings,
      onChange: (next) => dispatch({ type: 'setSettings', value: next }),
      onExport,
    });
    changeTransform = shrink.changeTransform;
    panel = { update: (s) => shrink.update(s.settings), setBusy: shrink.setBusy };
  }
  const thumbnails = async (
    count: number,
    width: number,
    height: number,
    signal: AbortSignal,
  ): Promise<HTMLCanvasElement[]> => {
    const track = await state.input.getPrimaryVideoTrack();
    if (!track || signal.aborted) return [];
    const sink = new CanvasSink(track, { width, height, fit: 'cover' });
    const timestamps = Array.from(
      { length: count },
      (_, i) => (state.source.durationSec * (i + 0.5)) / count,
    );
    const canvases: HTMLCanvasElement[] = [];
    const frames = sink.canvasesAtTimestamps(timestamps);
    const stop = () => {
      void frames
        .return()
        .catch((error: unknown) => console.warn('Could not stop video thumbnails', error));
    };
    signal.addEventListener('abort', stop, { once: true });
    try {
      for await (const frame of frames) {
        if (signal.aborted) break;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        if (frame) {
          canvas.getContext('2d')?.drawImage(frame.canvas, 0, 0);
        }
        canvases.push(canvas);
      }
    } finally {
      signal.removeEventListener('abort', stop);
    }
    return canvases;
  };
  let previewPlayable = canPlaySource(video, state.source.containerMime);
  let cropEditor: ReturnType<typeof mountCropEditor> | undefined;
  let overlayEditor: ReturnType<typeof mountOverlayEditor> | undefined;
  let livePreview: ReturnType<typeof mountLivePreview> | undefined;
  let previewAudio: ReturnType<typeof mountPreviewAudio> | undefined;
  const previewHost = el('div');
  const trim = mountTrimBar(trimHost, {
    duration: state.source.durationSec,
    aspect: state.source.video
      ? state.source.video.displayWidth / state.source.video.displayHeight
      : 16 / 9,
    value: state.settings.trim,
    video,
    thumbnails,
    previewPlayable,
    onChange: (value) => dispatch({ type: 'setTrim', value }),
  });
  const showPreviewUnplayable = () => {
    if (!previewPlayable) return;
    previewPlayable = false;
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.remove();
    previewNote.hidden = false;
    editSection.hidden = true;
    trim.setPreviewPlayable(false);
    cropEditor?.setPlayable(false);
    overlayEditor?.setPlayable(false);
    livePreview?.destroy();
    livePreview = undefined;
    previewHost.remove();
  };
  video.addEventListener('error', showPreviewUnplayable);
  const another = el('button', 'btn btn-text another', 'Choose another video');
  another.type = 'button';
  another.addEventListener('click', () => dispatch({ type: 'reset' }));
  head.append(another);
  // File, then preview, then the two kinds of edit, each under its own heading like Trim.
  const editSection = el('section', 'edit-section');
  editSection.setAttribute('aria-label', 'Edit');
  const editHead = el('div', 'section-head');
  editHead.append(el('h2', undefined, 'Edit'));
  const editTools = el('div', 'edit-tools');
  editSection.append(editHead, editTools);
  const frameFormat = el('select', 'setting-select frame-format');
  frameFormat.setAttribute('aria-label', 'Frame format');
  for (const format of ['PNG', 'JPEG']) {
    const option = el('option', undefined, format);
    option.value = format;
    frameFormat.append(option);
  }
  const saveFrame = el('button', 'btn btn-text', 'Save current frame');
  saveFrame.type = 'button';
  saveFrame.title = 'Save the current frame at output resolution, including all edits';
  const frameStatus = el('p', 'note');
  frameStatus.setAttribute('role', 'status');
  let savingFrame = false;
  let frameSink: GifSink | undefined;
  let frameUrl: string | undefined;
  let destroyed = false;
  function updateFrameButton(): void {
    saveFrame.disabled =
      savingFrame || !!current.exporting || video.readyState < 2 || video.seeking;
    frameFormat.disabled = savingFrame;
  }
  for (const event of ['loadeddata', 'seeking', 'seeked'])
    video.addEventListener(event, updateFrameButton);
  saveFrame.addEventListener('click', () => {
    void saveCurrentFrame();
  });
  async function saveCurrentFrame(): Promise<void> {
    const source = current.source.video;
    const output =
      current.tool === 'gif' && current.gifSettings
        ? gifDimensions(current.gifSettings, current.source, current.settings.transform)
        : current.settings.video;
    if (!source || !output || saveFrame.disabled) return;
    savingFrame = true;
    updateFrameButton();
    frameStatus.textContent = 'Saving frame…';
    const jpeg = frameFormat.value === 'JPEG';
    const mime = jpeg ? 'image/jpeg' : 'image/png';
    const base = current.file.name.replace(/\.[^.]+$/, '');
    const name = `${base}-frame-${video.currentTime.toFixed(3)}.${jpeg ? 'jpg' : 'png'}`;
    // Open the picker inside the click gesture, and capture pixels before its promise settles.
    const pendingSink = openImageSink(
      current.caps.fileStreamSave ? { kind: 'file-stream' } : { kind: 'memory', warn: false },
      name,
      mime,
    );
    try {
      const [sink, blob] = await Promise.all([
        pendingSink,
        exportCurrentFrame(
          video,
          { width: source.displayWidth, height: source.displayHeight },
          {
            output,
            timestamp: video.currentTime,
            transform: current.settings.transform,
            style: current.settings.style,
            overlays: current.settings.overlays,
          },
          current.overlayAssets,
          mime,
        ),
      ]);
      frameSink = sink;
      if (destroyed) {
        await sink.abort();
        return;
      }
      const saved = await sink.finish(new Uint8Array(await blob.arrayBuffer()));
      frameSink = undefined;
      if (destroyed) return;
      if (!current.caps.fileStreamSave && saved) {
        if (frameUrl) URL.revokeObjectURL(frameUrl);
        frameUrl = URL.createObjectURL(saved);
        const download = el('a', 'btn btn-text', 'Download frame');
        download.href = frameUrl;
        download.download = name;
        frameStatus.replaceChildren(download);
        download.click();
      } else frameStatus.textContent = `${name} saved.`;
    } catch (error) {
      const sink = await pendingSink.catch(() => undefined);
      await sink?.abort();
      if (destroyed) return;
      if (error instanceof DOMException && error.name === 'AbortError')
        frameStatus.textContent = '';
      else {
        console.error('saving the current frame failed', error);
        frameStatus.textContent =
          'The frame could not be saved. Check that the preview and selected style are available, then try again.';
      }
    } finally {
      savingFrame = false;
      frameSink = undefined;
      updateFrameButton();
    }
  }
  editSection.append(frameStatus);
  // Editors take the preview's place while open, so they sit directly after it.
  const editorsHost = el('div', 'editors');
  const onSpace = (event: KeyboardEvent) => {
    if (
      event.key !== ' ' ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.shiftKey ||
      event.repeat ||
      event.defaultPrevented ||
      !livePreview ||
      current.tool === 'audio' ||
      editorsHost.querySelector(':scope > :not([hidden])') ||
      document.querySelector('dialog[open], [aria-modal="true"]:not([hidden])')
    )
      return;
    const controls =
      'input, textarea, select, button, a[href], summary, [contenteditable], video, [role="button"], [role="slider"], [role="switch"], [role="checkbox"], [role="radio"], [role="tab"], [role="menuitem"], [role="option"], [role="combobox"], [role="textbox"], [role="separator"]';
    if (
      (event.target instanceof Element && event.target.closest(controls)) ||
      (document.activeElement instanceof Element && document.activeElement.closest(controls))
    )
      return;
    event.preventDefault();
    if (!livePreview.togglePlayback()) {
      if (video.paused)
        void video.play().catch((error: unknown) => console.warn('Could not play preview', error));
      else video.pause();
    }
  };
  document.addEventListener('keydown', onSpace);
  canvas.append(toolsHost, head, theater);
  if (previewPlayable) {
    canvas.append(previewHost, editorsHost, previewNote, editSection);
    if (state.source.video)
      livePreview = mountLivePreview(
        video,
        previewHost,
        { width: state.source.video.displayWidth, height: state.source.video.displayHeight },
        state.source.durationSec,
        () => {
          styleUnavailable = 'Video styles stopped because the graphics context was lost.';
          if (hasStyleEffects(current.settings.style))
            dispatch({
              type: 'setSettings',
              value: { ...current.settings, style: normalizeStyle() },
            });
          else stylePanel.update(current.settings.style, styleUnavailable);
        },
      );
    else previewHost.append(video);
    video.src = url;
    if (state.source.audio) {
      previewAudio = mountPreviewAudio(video, state.input);
      previewAudio.update(previewAudioTarget(state));
    }
    if (state.source.video)
      cropEditor = mountCropEditor(
        editorsHost,
        video,
        state.source.video,
        state.settings,
        (transform) => changeTransform?.(transform),
        editTools,
      );
    if (state.source.video)
      overlayEditor = mountOverlayEditor(
        editorsHost,
        video,
        state.source.video,
        state.settings,
        changeOverlays,
        editTools,
      );
  } else {
    previewNote.hidden = false;
    canvas.append(previewNote);
  }
  editTools.append(saveFrame, frameFormat);
  canvas.append(noticeSlot, trimHost);
  stage.append(canvas, settingsHost);
  container.replaceChildren(stage);
  title.focus();
  function update(value: AppState): void {
    if (value.kind !== 'prepare') return;
    trim.update(value.settings.trim);
    current = value;
    updateFrameButton();
    cropEditor?.update(value.settings);
    cropEditor?.setTool(value.tool !== 'audio');
    overlayEditor?.update(value.settings, value.overlayAssets);
    overlayEditor?.setTool(value.tool !== 'audio');
    overlayDetails.hidden = value.tool === 'audio' || !value.source.video;
    styleDetails.hidden = value.tool === 'audio' || !value.source.video;
    stylePanel.update(value.settings.style, styleUnavailable);
    editSection.hidden = value.tool === 'audio' || !previewPlayable || !value.source.video;
    previewAudio?.update(previewAudioTarget(value));
    const previewOutput =
      value.tool === 'gif' && value.gifSettings
        ? gifDimensions(value.gifSettings, value.source, value.settings.transform)
        : value.settings.video;
    if (value.source.video)
      livePreview?.update({
        transform: value.settings.transform,
        style: value.settings.style,
        overlays: value.settings.overlays,
        assets: value.overlayAssets,
        output: previewOutput ?? {
          width: value.source.video.displayWidth,
          height: value.source.video.displayHeight,
        },
        enabled: value.tool !== 'audio',
      });
    overlayState.textContent = overlaySummary(
      value.settings.overlays,
      !!value.overlayAssets?.image,
    );
    overlayState.classList.toggle('is-changed', overlayState.textContent !== 'Off');
    overlayPanel.update(value.settings.overlays);
    tabs.update(value.tool, audioReason(value), gifReason(value));
    if (value.tool !== shownTool) {
      showPanel(value);
      dockSpace.disconnect();
      dockSpace.observe(root);
      const dock = panelHost.querySelector('.dock');
      if (dock) dockSpace.observe(dock);
    }
    panel?.update(value);
    panel?.setBusy(value.exporting === true);
  }
  update(state);
  return {
    update,
    destroy() {
      destroyed = true;
      void frameSink?.abort();
      if (frameUrl) URL.revokeObjectURL(frameUrl);
      document.body.classList.remove('is-theater');
      document.removeEventListener('keydown', onSpace);
      dockSpace.disconnect();
      root.style.removeProperty('--dock-space');
      trim.destroy();
      cropEditor?.destroy();
      overlayEditor?.destroy();
      livePreview?.destroy();
      previewAudio?.destroy();
      video.removeEventListener('error', showPreviewUnplayable);
      video.pause();
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
    },
  };
}

/** Why Extract audio is unavailable for this source, or null when it can be chosen. */
function previewAudioTarget(state: Of<'prepare'>): PreviewAudioTarget {
  if (state.tool === 'audio')
    return state.audioSettings
      ? {
          processing: state.audioSettings.audioProcessing,
          trim: state.audioSettings.trim,
          channels: state.audioSettings.channels,
        }
      : null;
  if (state.tool === 'gif' || !state.settings.audio) return null;
  return {
    processing: state.settings.audioProcessing,
    trim: state.settings.trim,
    channels: state.settings.audio.channels,
  };
}

function audioReason(state: Of<'prepare'>): string | null {
  if (state.audioAuto) return null;
  return audioUnavailable(state.source) === 'undecodable'
    ? 'This browser cannot decode the audio in this video'
    : 'This video has no audio track';
}

function gifReason(state: Of<'prepare'>): string | null {
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
const containerLabel = (mime: string) => {
  const base = mime.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return CONTAINER_LABELS[base] ?? (base.split('/')[1]?.toUpperCase() || 'unknown');
};
const audioLabels: Record<string, string> = {
  aac: 'AAC',
  opus: 'Opus',
  mp3: 'MP3',
  'pcm-s16': 'PCM 16-bit',
};
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

/** "Off", "Text", "Image" or "Text and image", for the Overlay row. */
function overlaySummary(overlays: Settings['overlays'], hasImage: boolean): string {
  const text = !!overlays?.text.enabled && !!overlays.text.content.trim();
  const image = !!overlays?.image.enabled && hasImage;
  return text && image ? 'Text and image' : text ? 'Text' : image ? 'Image' : 'Off';
}

/** "270x480" */
function summaryGif(
  gif: Parameters<typeof gifDimensions>[0],
  source: SourceInfo,
  transform: Settings['transform'],
): string {
  const { width, height } = gifDimensions(gif, source, transform);
  return `${width}x${height}`;
}

/** "MP3 · 128 kbps stereo" */
function summaryAudio(a: AudioExtractSettings): string {
  const { label } = AUDIO_FORMATS[a.format];
  const channels = a.channels === 1 ? 'mono' : 'stereo';
  return a.format === 'wav'
    ? `${label} · PCM 16-bit ${channels}`
    : `${label} · ${formatBitrate(a.bitrate)} ${channels}`;
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
  const fileText = el('div', 'file-text');
  const title = screenHeading('file-name');
  title.textContent = `${state.tool === 'audio' ? 'Extracting audio' : 'Exporting'} ${state.outputName}`;
  head.append(fileText);
  fileText.append(
    title,
    el(
      'p',
      'file-summary num',
      state.tool === 'audio' && state.audioSettings
        ? summaryAudio(state.audioSettings)
        : state.tool === 'gif' && state.gifSettings
          ? `${summaryGif(state.gifSettings, state.source, state.settings.transform)} · ${state.gifSettings.fps} fps GIF`
          : summaryOutput(state.settings),
    ),
  );

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
    originalBytes: state.tool === 'gif' ? undefined : state.source.sizeBytes,
    expected: state.tool === 'gif' ? undefined : state.estimate,
    showBytes: state.tool !== 'gif',
    liveBytes: writesWhileEncoding(
      state.tool === 'audio' && state.audioSettings
        ? state.audioSettings.format
        : state.settings.container,
      state.sinkKind,
    ),
  });
  const note = el(
    'p',
    'note',
    'Keep this tab open until it finishes. Your phone may get warm; that is normal for video work.',
  );
  const canvas = el('div', 'canvas');
  canvas.append(stage, head);
  const inspector = el('div', 'inspector run');
  inspector.append(progressHost, note);
  const work = el('div', 'work working');
  work.append(canvas, inspector);
  container.replaceChildren(work);
  title.focus();

  const { start, end } = state.settings.trim;
  const span = Math.max(0, end - start);
  let lastSeek = -Infinity;
  // Seeking the preview competes with the encoder for decode time, so it moves rarely.
  const SEEK_EVERY_MS = 2000;
  function update(value: AppState): void {
    if (value.kind !== 'working') return;
    const analysing = value.phase === 'analysis';
    title.textContent = `${analysing ? 'Analysing loudness for' : state.tool === 'audio' ? 'Extracting audio' : 'Exporting'} ${state.outputName}`;
    const elapsed = Date.now() - value.startedAt;
    progress.update(value.progress, value.bytes, elapsed);
    const at = span * value.progress;
    overlay.textContent = `${analysing ? 'Analysing loudness' : 'Encoding'} ${formatDuration(at, { tenths: true })} of ${formatDuration(span, { tenths: true })}`;
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
  trim: Settings['trim'],
  notSmaller: boolean,
  audioOnly: boolean,
  gifOnly = false,
): HTMLTableElement {
  const table = el('table', 'stats');
  const caption = el(
    'caption',
    'sr',
    audioOnly
      ? 'Original video and audio file compared'
      : gifOnly
        ? 'Original video and GIF compared'
        : 'Original and new video compared',
  );
  const thead = el('thead');
  const headRow = el('tr');
  const prop = el('th');
  prop.scope = 'col';
  prop.append(el('span', 'sr', 'Property'));
  const colOrig = el('th', undefined, audioOnly ? 'Original video' : 'Original');
  colOrig.scope = 'col';
  const colNew = el('th', undefined, audioOnly ? 'Audio file' : gifOnly ? 'GIF' : 'New');
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
  const sourceCodecs = (i: SourceInfo) =>
    `${[i.video ? codecLabel(i.video.codec) : null, i.audio ? audioLabel(i.audio.codec) : null]
      .filter(Boolean)
      .join('/')} ${containerLabel(i.containerMime)}`;
  const audioBitrate = (i: SourceInfo) =>
    i.audio?.codec?.startsWith('pcm')
      ? 'Lossless'
      : i.audio?.bitrate
        ? formatBitrate(i.audio.bitrate)
        : bitrate(i);
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
  const trimmed = trim.end - trim.start < source.durationSec - 0.05;
  const durationRow = () =>
    row(
      'Duration',
      formatDuration(source.durationSec),
      trimmed
        ? [formatDuration(output.durationSec), el('span', 'delta', 'trimmed')]
        : formatDuration(output.durationSec),
    );
  if (audioOnly) {
    durationRow();
    row('Codec', sourceCodecs(source), audioLabel(output.audio?.codec ?? null));
    row('Bitrate', bitrate(source), audioBitrate(output));
  } else {
    if (source.video || output.video) {
      row('Resolution', resolution(source), resolution(output));
      row('Frame rate', fps(source), fps(output));
      row('Video', video(source), video(output));
    }
    if (!gifOnly) {
      row('Audio', audio(source), audio(output));
      row('Bitrate', bitrate(source), bitrate(output));
    }
    durationRow();
  }

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
  const audioOnly = state.tool === 'audio';
  const gifOnly = state.tool === 'gif';
  // WAV is lossless, so no setting makes it smaller and there is nothing to suggest.
  const lossless = audioOnly && state.audioSettings?.format === 'wav';
  const overTarget =
    state.tool === 'shrink' &&
    !!state.settings.targetSizeMB &&
    output.sizeBytes > state.settings.targetSizeMB * 1e6;
  const showNotSmaller = !overTarget && state.notSmaller && !lossless && !gifOnly;
  // The canvas holds the comparison or the player; the inspector holds the verdict, the
  // delivery actions, the stats and the next steps. Phones keep the same order in one column.
  const work = el('div', 'work result');
  const canvas = el('div', 'canvas');
  const side = el('aside', 'inspector result-rail');
  side.setAttribute('aria-label', 'Details and actions');

  const verdict = el('div', 'verdict');
  const figure = screenHeading('figure num');
  figure.append(
    `${formatBytes(output.sizeBytes)}, `,
    el(
      'em',
      output.sizeBytes > source.sizeBytes ? 'is-larger' : undefined,
      state.notSmaller && !gifOnly
        ? 'not smaller'
        : reductionText(source.sizeBytes, output.sizeBytes),
    ),
  );
  verdict.append(
    el(
      'span',
      'overline ok num',
      // A trimmed copy can finish in well under a second, which the clock would show as 0:00.
      state.elapsedMs < 1000 ? 'Done in under a second' : `Done in ${clock(state.elapsedMs)}`,
    ),
    figure,
    el(
      'p',
      'ready',
      state.sinkKind === 'file-stream'
        ? `${state.outputName} is saved where you chose.`
        : `${state.outputName} is ready to save or share.`,
    ),
  );
  side.append(verdict);

  if (state.styleDropped) {
    const warning = el('div', 'notice warn');
    warning.setAttribute('role', 'status');
    warning.append(
      icon('i-warn'),
      el(
        'p',
        undefined,
        'The export was saved without the selected style or colour correction because the graphics renderer became unavailable.',
      ),
    );
    side.append(warning);
  }

  const meter = sizeMeter(
    audioOnly ? 'Audio file' : 'New',
    audioOnly ? 'Original video' : 'Original',
  );
  meter.origValue.textContent = formatBytes(source.sizeBytes);
  meter.newValue.textContent = formatBytes(output.sizeBytes);
  meter.show(output.sizeBytes, output.sizeBytes, source.sizeBytes);
  side.append(meter.node);

  if (showNotSmaller) {
    const notice = el('div', 'notice warn not-smaller');
    notice.setAttribute('role', 'alert');
    const body = el('div', 'body');
    body.append(
      el(
        'h2',
        undefined,
        audioOnly
          ? 'The audio file is not smaller than the original video'
          : 'The new file is not smaller than the original',
      ),
      el(
        'p',
        undefined,
        audioOnly
          ? 'Lower the bitrate, or choose MP3 or M4A.'
          : 'This video was already compressed well. Make it smaller tries the next smaller size, or lower quality if no smaller size is left.',
      ),
    );
    notice.append(icon('i-warn'), body);
    side.append(notice);
  }

  if (overTarget) {
    const notice = el('div', 'notice warn not-smaller');
    notice.setAttribute('role', 'status');
    const body = el('div');
    body.append(
      el('h2', undefined, 'The output exceeds your target'),
      el(
        'p',
        undefined,
        `${formatBytes(output.sizeBytes)} actual versus ${formatBytes(state.settings.targetSizeMB! * 1e6)} target. Try again smaller lowers the video bitrate. A shorter trim can also help.`,
      ),
    );
    notice.append(icon('i-warn'), body);
    side.append(notice);
  }

  let compare: { destroy(): void } | undefined;
  let originalUrl: string | undefined;
  const peaksAbort = new AbortController();
  if (audioOnly && state.audioSettings) {
    const host = el('div', 'player-host');
    const a = output.info.audio;
    compare = mountAudioPlayer(host, {
      url: output.url,
      name: state.outputName,
      detail: [
        a ? audioLabel(a.codec) : AUDIO_FORMATS[state.audioSettings.format].label,
        a?.codec?.startsWith('pcm') || !a?.bitrate ? null : formatBitrate(a.bitrate),
        a ? (a.channels === 1 ? 'mono' : 'stereo') : null,
      ]
        .filter(Boolean)
        .join(' · '),
      peaks: output.url
        ? computePeaks(state.input, state.audioSettings.trim, 64, peaksAbort.signal)
        : Promise.resolve(null),
    });
    canvas.append(host);
  } else if (gifOnly && output.url) {
    const preview = el('img', 'gif-preview');
    preview.src = output.url;
    preview.alt = 'GIF preview';
    canvas.append(preview);
  } else if (output.url && output.info.video && source.video) {
    const host = el('div', 'compare');
    originalUrl = URL.createObjectURL(state.file);
    compare = mountCompare(host, {
      original: originalUrl,
      output: output.url,
      originalInfo: source,
      outputInfo: output.info,
      offsetSec: state.settings.trim.start,
    });
    canvas.append(host);
  } else if (!output.blob) {
    canvas.append(
      el(
        'p',
        'note compare-skipped',
        gifOnly
          ? 'The GIF was saved where you chose. Open it there to preview it.'
          : 'The new file went straight to the place you chose, so there is no side-by-side preview here. Open it from there to watch it.',
      ),
    );
  }

  const deliver = el('div', 'deliver');
  // A file-stream export is already saved; its url only feeds the preview.
  if (output.url && state.sinkKind !== 'file-stream') {
    const download = el('a', 'btn btn-primary btn-block');
    download.href = output.url;
    download.download = state.outputName;
    // The visible label stays one short verb; the name carries the file so it is announced.
    download.setAttribute('aria-label', `Download ${state.outputName}`);
    download.append(icon('i-down'), 'Download');
    deliver.append(download, el('p', 'file-out', state.outputName));
  }
  const shareNote = el('p', 'note share-note');
  shareNote.hidden = true;
  if (output.blob && state.caps.shareFiles && typeof navigator.share === 'function') {
    const blob = output.blob;
    const share = el('button', 'btn btn-block');
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
    deliver.append(share);
  }
  if (deliver.childElementCount) side.append(deliver);
  side.append(shareNote);

  const stats = el('div', 'stats-block');
  stats.append(
    statsTable(
      source,
      output.info,
      audioOnly && state.audioSettings ? state.audioSettings.trim : state.settings.trim,
      state.notSmaller,
      audioOnly,
      gifOnly,
    ),
  );
  side.append(stats);

  // The recommended adjustment is a secondary button; starting over is a quiet text action.
  const actions = el('div', 'actions');
  if (!lossless && !gifOnly) {
    const smaller = el('button', showNotSmaller || overTarget ? 'btn is-suggested' : 'btn');
    smaller.type = 'button';
    smaller.append(
      icon('i-smaller'),
      audioOnly ? 'Lower bitrate' : overTarget ? 'Try again smaller' : 'Make it smaller',
    );
    smaller.addEventListener('click', () => dispatch({ type: 'smaller' }));
    actions.append(smaller);
  }
  const restart = el('button', 'btn btn-text');
  restart.type = 'button';
  restart.append(icon('i-restart'), 'Start over');
  restart.addEventListener('click', () => dispatch({ type: 'reset' }));
  actions.append(restart);
  side.append(actions);

  work.append(canvas, side);
  container.replaceChildren(work);
  figure.focus();

  return {
    update() {},
    destroy() {
      peaksAbort.abort();
      compare?.destroy();
      if (originalUrl) URL.revokeObjectURL(originalUrl);
    },
  };
}

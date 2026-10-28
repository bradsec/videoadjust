import { audioChangeCount } from '../core/audioMix';
import { cutSettings, keptDuration } from '../core/cuts';
import { exportCurrentFrame } from '../core/frameExport';
import { gifDimensions } from '../core/gifExport';
import { openImageSink, type GifSink } from '../core/sink';
import { hasStyleEffects, normalizeStyle } from '../core/style';
import type { Settings } from '../core/types';
import { mountAudioProcessing } from './audioProcessingControls';
import { mountAudioTracks } from './audioTracksControls';
import { canPlaySource } from './compare';
import { mountCropEditor } from './cropEditor';
import { mountEditControls } from './editControls';
import { mountFitPanel } from './fitPanel';
import { mountCaptionPanel } from './captionPanel';
import { type AppAction, type AppState, type Tool, allSettingsChangeCount } from './controller';
import { el, icon, INSPECTOR_GROUP } from './dom';
import { mountLivePreview } from './livePreview';
import { mountMixWaveform } from './mixWaveform';
import { mountOverlayEditor } from './overlayEditor';
import { mountOverlayPanel } from './overlayPanel';
import { mountPreviewAudio } from './previewAudio';
import { mountStylePanel, webglStyleReason } from './stylePanel';
import { toast } from './toast';
import { mountToolTabs, TOOL_PANEL_ID, toolTabId } from './toolTabs';
import { mountTrimBar } from './trimBar';
import {
  audioReason,
  gifReason,
  overlaySummary,
  previewAudioTarget,
  screenHeading,
  summarySource,
  theaterToggle,
} from './viewSummaries';
import { showPanel, type PreparePanel } from './preparePanel';
import { thumbnails, onSpace } from './prepareMedia';

type Of<K extends AppState['kind']> = Extract<AppState, { kind: K }>;
interface Mounted {
  update(value: AppState): void;
  destroy(): void;
}

/** Prepare screen. */
export function renderPrepare(
  container: HTMLElement,
  state: Of<'prepare'>,
  dispatch: (a: AppAction) => void,
  noticeSlot: HTMLElement,
): Mounted {
  const onExport = () => dispatch({ type: 'export' });
  const onResetAll = () => {
    // Rebuild local drafts and remembered resolution alongside the controller defaults.
    shownTool = undefined;
    dispatch({ type: 'resetAll' });
    toast('All settings reset to automatic defaults.', 'success');
    // Reset all is now disabled, so focus the count that reports the new state.
    panelHost.querySelector<HTMLElement>('.reset-all .adjust-state')?.focus();
  };
  const head = el('div', 'file-line');
  const fileText = el('div', 'file-text');
  const title = screenHeading('file-name');
  title.textContent = state.file.name;
  fileText.append(title, el('p', 'file-summary num', summarySource(state.source)));
  head.append(fileText);
  const stage = el('div', 'prepare-regions work');
  stage.dataset.region = 'prepare';
  const canvas = el('div', 'canvas');
  const theater = theaterToggle('Use a wider preview with a fixed-width controls panel');
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
  const tracksHost = el('div');
  const audioDetails = el('details', 'adjust audio-adjust');
  const audioHeading = el('summary');
  const audioState = el('span', 'adjust-state');
  audioHeading.append('Audio', audioState, icon('i-chev'));
  audioDetails.append(audioHeading, tracksHost);
  const colourDetails = el('details', 'adjust colour-adjust');
  const panelHost = el('div', 'tool-panel');
  panelHost.id = TOOL_PANEL_ID;
  panelHost.setAttribute('role', 'tabpanel');
  const styleDetails = el('details', 'adjust style-adjust');
  let styleUnavailable = webglStyleReason();
  // Overlays apply to Shrink and GIF alike, so their controls sit below whichever panel shows.
  const overlayDetails = el('details', 'adjust overlay-adjust');
  const overlayHeading = el('summary');
  const overlayState = el('span', 'adjust-state');
  overlayHeading.append('Overlay', overlayState, icon('i-chev'));
  overlayDetails.append(overlayHeading);
  const patch = (value: Partial<Settings>) =>
    dispatch({ type: 'setSettings', value: { ...current.settings, ...value } });
  const fitPanel = mountFitPanel((fit) => patch({ fit }));
  const captionPanel = mountCaptionPanel(video, state.source.durationSec, (captions) =>
    patch({ captions }),
  );
  settingsHost.append(panelHost, fitPanel.node);
  settingsHost.append(audioDetails, colourDetails, styleDetails, overlayDetails, captionPanel.node);
  // Inspector sections share one name so opening one closes the others; panels add their own.
  for (const details of [fitPanel.node, audioDetails, colourDetails, styleDetails, overlayDetails])
    details.name = INSPECTOR_GROUP;
  // Closing a section above the one just opened shifts it up; keep its header in view.
  const keepOpenedInView = (event: Event) => {
    const details = event.target as HTMLDetailsElement;
    if (details instanceof HTMLDetailsElement && details.open)
      details.querySelector('summary')?.scrollIntoView({ block: 'nearest' });
  };
  settingsHost.addEventListener('toggle', keepOpenedInView, true);
  let current = state;
  const tracks = mountAudioTracks(tracksHost, {
    sourceHasAudio: !!state.source.audio?.decodable,
    mix: state.settings.mix,
    added: state.addedAudio,
    duration: keptDuration(state.settings.trim, state.settings.cuts),
    onChange: (value) => dispatch({ type: 'setMix', value }),
    onAdd: (file) => dispatch({ type: 'addAudio', file }),
    onRemove: () => dispatch({ type: 'removeAddedAudio' }),
  });
  const master = mountAudioProcessing(
    tracksHost.firstElementChild as HTMLElement,
    state.settings.audioProcessing,
    keptDuration(state.settings.trim, state.settings.cuts),
    (value) => dispatch({ type: 'setAudioProcessing', value }),
  );
  const audioPreviewNote = el('p', 'setting-help');
  audioPreviewNote.setAttribute('role', 'status');
  audioPreviewNote.hidden = true;
  tracksHost.firstElementChild!.append(audioPreviewNote);
  const stylePanel = mountStylePanel(styleDetails, colourDetails, state.settings.style, (style) =>
    patch({ style }),
  );
  const changeOverlays = (overlays: Settings['overlays']) => patch({ overlays });
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
  // Under 700px responsive.css fixes the dock to the viewport bottom; --dock-space reserves its
  // height at the page foot so the footer and the last controls can scroll clear of it.
  const root = document.documentElement;
  const dockSpace = new ResizeObserver(() => {
    const dock = panelHost.querySelector<HTMLElement>('.dock');
    const fixed = dock !== null && getComputedStyle(dock).position === 'fixed';
    root.style.setProperty('--dock-space', fixed && dock ? `${dock.offsetHeight}px` : '0px');
  });
  let shownTool: Tool | undefined;
  let shownAdded = state.addedAudio;
  let changeTransform: ((t: NonNullable<Settings['transform']>) => void) | undefined;
  let panel: PreparePanel['panel'] | undefined;
  const thumbnailsForSource = (count: number, width: number, height: number, signal: AbortSignal) =>
    thumbnails(state, count, width, height, signal);
  let previewPlayable = canPlaySource(video, state.source.containerMime);
  let cropEditor: ReturnType<typeof mountCropEditor> | undefined;
  let overlayEditor: ReturnType<typeof mountOverlayEditor> | undefined;
  let livePreview: ReturnType<typeof mountLivePreview> | undefined;
  let previewAudio: ReturnType<typeof mountPreviewAudio> | undefined;
  const previewHost = el('div', 'preview-host');
  const trim = mountTrimBar(trimHost, {
    duration: state.source.durationSec,
    fps: state.source.video?.fps,
    aspect: state.source.video
      ? state.source.video.displayWidth / state.source.video.displayHeight
      : 16 / 9,
    value: state.settings.trim,
    cuts: cutSettings(state.settings),
    video,
    thumbnails: thumbnailsForSource,
    previewPlayable,
    onChange: (value) => dispatch({ type: 'setTrim', value }),
    onCutsChange: (value) => dispatch({ type: 'setCuts', value }),
  });
  let normalizationDb = 0;
  const waveform = mountMixWaveform(
    trim.waveformSlot,
    state.input,
    state.source.durationSec,
    video,
    (offset) => {
      const mix = current.settings.mix;
      if (mix?.added)
        dispatch({ type: 'setMix', value: { ...mix, added: { ...mix.added, offset } } });
    },
    !!state.source.audio?.decodable,
  );
  function updateWaveform(): void {
    waveform.update({
      trim: current.settings.trim,
      cuts: current.settings.cuts,
      mix: current.settings.mix,
      added: current.addedAudio,
      processing: current.settings.audioProcessing,
      normalizationDb,
    });
  }
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
  const {
    section: editSection,
    tools: editTools,
    frameButtons,
    status: frameStatus,
    updateFrameButtons,
  } = mountEditControls(saveCurrentFrame);
  let savingFrame = false;
  let frameSink: GifSink | undefined;
  let frameUrl: string | undefined;
  let destroyed = false;
  function updateFrameButton(): void {
    updateFrameButtons(!!current.exporting || video.readyState < 2 || video.seeking, savingFrame);
  }
  for (const event of ['loadeddata', 'seeking', 'seeked'])
    video.addEventListener(event, updateFrameButton);
  async function saveCurrentFrame(jpeg: boolean): Promise<void> {
    const source = current.source.video;
    const output =
      current.tool === 'gif' && current.gifSettings
        ? gifDimensions(
            current.gifSettings,
            current.source,
            current.settings.transform,
            current.settings.fit,
          )
        : current.settings.video;
    if (!source || !output || savingFrame || frameButtons[0]!.disabled) return;
    savingFrame = true;
    updateFrameButton();
    frameStatus.textContent = 'Saving frame…';
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
          { ...current.settings, output, timestamp: video.currentTime },
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
      } else frameStatus.textContent = '';
      toast(`${name} saved.`, 'success');
    } catch (error) {
      const sink = await pendingSink.catch(() => undefined);
      await sink?.abort();
      if (destroyed) return;
      frameStatus.textContent = '';
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        console.error('saving the current frame failed', error);
        toast(
          'The frame could not be saved. Check that the preview and selected style are available, then try again.',
          'error',
        );
      }
    } finally {
      savingFrame = false;
      frameSink = undefined;
      updateFrameButton();
    }
  }
  // Editors take the preview's place while open, so they sit directly after it.
  const editorsHost = el('div', 'editors');
  const onSpaceKeydown = (event: KeyboardEvent) => onSpace(event, video, editorsHost, livePreview);
  document.addEventListener('keydown', onSpaceKeydown);
  canvas.append(toolsHost, head, theater.button);
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
    previewAudio = mountPreviewAudio(
      video,
      state.input,
      (db) => {
        normalizationDb = db;
        updateWaveform();
      },
      (message) => {
        audioPreviewNote.textContent = message;
        audioPreviewNote.hidden = !message;
      },
      (busy) => waveform.setStatus(busy ? 'Measuring loudness for the preview…' : null),
    );
    previewAudio.update(previewAudioTarget(state), state.tool === 'gif');
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
  canvas.append(noticeSlot, trimHost);
  stage.append(canvas, settingsHost);
  container.replaceChildren(stage);
  title.focus();
  function update(value: AppState): void {
    if (value.kind !== 'prepare') return;
    trim.update(value.settings.trim, cutSettings(value.settings));
    current = value;
    fitPanel.update(value.settings.fit, value.tool !== 'audio' && !!value.source.video);
    captionPanel.update(value.settings.captions, value.tool !== 'audio' && !!value.source.video);
    audioDetails.hidden = value.tool === 'gif';
    const audioChanges = audioChangeCount(value.settings.mix, value.settings.audioProcessing);
    audioState.textContent = audioChanges
      ? `${audioChanges} ${audioChanges === 1 ? 'change' : 'changes'}`
      : 'Unchanged';
    audioState.classList.toggle('is-changed', audioChanges > 0);
    trim.waveformSlot.hidden = value.tool === 'gif';
    tracks.update({
      busy: value.addingAudio,
      sourceHasAudio: !!value.source.audio?.decodable,
      mix: value.settings.mix,
      added: value.addedAudio,
      duration: keptDuration(value.settings.trim, value.settings.cuts),
    });
    master.update(
      value.settings.audioProcessing,
      keptDuration(value.settings.trim, value.settings.cuts),
    );
    updateFrameButton();
    cropEditor?.update(value.settings);
    cropEditor?.setTool(value.tool !== 'audio');
    overlayEditor?.update(value.settings, value.overlayAssets);
    overlayEditor?.setTool(value.tool !== 'audio');
    overlayDetails.hidden = value.tool === 'audio' || !value.source.video;
    styleDetails.hidden = value.tool === 'audio' || !value.source.video;
    colourDetails.hidden = styleDetails.hidden;
    stylePanel.update(value.settings.style, styleUnavailable);
    editSection.hidden = value.tool === 'audio' || !previewPlayable || !value.source.video;
    previewAudio?.update(previewAudioTarget(value), value.tool === 'gif');
    updateWaveform();
    const previewOutput =
      value.tool === 'gif' && value.gifSettings
        ? gifDimensions(
            value.gifSettings,
            value.source,
            value.settings.transform,
            value.settings.fit,
          )
        : value.settings.video;
    if (value.source.video)
      livePreview?.update({
        transform: value.settings.transform,
        fit: value.settings.fit,
        style: value.settings.style,
        overlays: value.settings.overlays,
        captions: value.settings.captions,
        cutFade: {
          trim: value.settings.trim,
          cuts: value.settings.cuts,
          fade: value.settings.cutFade,
        },
        assets: value.overlayAssets,
        output: previewOutput ?? {
          width: value.source.video.displayWidth,
          height: value.source.video.displayHeight,
        },
        fps:
          value.tool === 'gif' && value.gifSettings
            ? value.gifSettings.fps
            : (value.settings.video?.fps ?? null),
        colors: value.tool === 'gif' ? value.gifSettings?.colors : undefined,
        sourceFps: value.source.video.fps,
        enabled: value.tool !== 'audio',
      });
    overlayState.textContent = overlaySummary(
      value.settings.overlays,
      !!value.overlayAssets?.image,
    );
    overlayState.classList.toggle('is-changed', overlayState.textContent !== 'Off');
    overlayPanel.update(value.settings.overlays);
    tabs.update(value.tool, audioReason(value), gifReason(value));
    if (value.tool !== shownTool || value.addedAudio !== shownAdded) {
      panel?.resetAll.destroy();
      shownTool = value.tool;
      shownAdded = value.addedAudio;
      panelHost.setAttribute('aria-labelledby', toolTabId(value.tool));
      ({ panel, changeTransform } = showPanel(
        panelHost,
        value,
        () => current,
        dispatch,
        onExport,
        onResetAll,
      ));
      dockSpace.disconnect();
      dockSpace.observe(root);
      const dock = panelHost.querySelector('.dock');
      if (dock) dockSpace.observe(dock);
    }
    panel?.update(value);
    panel?.resetAll.update(allSettingsChangeCount(value), value.exporting === true);
    panel?.setBusy(value.exporting === true || value.addingAudio === true);
  }
  update(state);
  return {
    update,
    destroy() {
      destroyed = true;
      theater.destroy();
      panel?.resetAll.destroy();
      void frameSink?.abort();
      if (frameUrl) URL.revokeObjectURL(frameUrl);
      document.body.classList.remove('is-theater');
      document.removeEventListener('keydown', onSpaceKeydown);
      dockSpace.disconnect();
      root.style.removeProperty('--dock-space');
      trim.destroy();
      waveform.destroy();
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

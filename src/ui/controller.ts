import { autoAudioExtract, validateAudioExtract } from '../core/audioExtract';
import { retryTargetSize } from '../core/targetSize';
import { autoGifSettings, validateGifSettings } from '../core/gifExport';
import { clampTrim } from './trimBar';
import { normalizeAudioProcessing } from '../core/audioProcess';
import { normalizeAudioMix, type AddedAudio, type AudioMix } from '../core/audioMix';
import { readAddedAudio } from '../core/addedAudio';
import { createExportFlow, PARTIAL_FILE } from './controllerExport';
import { createSourceLoader } from './controllerSource';
import { createOverlayLoader } from './controllerOverlay';
import {
  audioMixSource,
  inputOf,
  preserveQuality,
  smallerFor,
  validateSettings,
} from './controllerSettings';
import type { AppAction, AppDeps, AppState, Loaded, Notice } from './controllerTypes';

export { LARGE_FILE_BYTES } from './controllerTypes';
export type { AppAction, AppDeps, AppState, Notice, Tool } from './controllerTypes';
export {
  codecLabel,
  inputOf,
  audioMixSource,
  outputNameFor,
  smallerSettings,
  allSettingsChangeCount,
  availableVideoCodecs,
  validateSettings,
  outputChangeCount,
  settingsChangeCount,
} from './controllerSettings';

/**
 * DOM-free state machine: owns state, dispatch and the source-loading flow.
 * `onChange` runs after every state change.
 */
export function createController(
  deps: AppDeps,
  onChange: (state: AppState) => void,
): { dispatch(a: AppAction): void; getState(): AppState } {
  let state: AppState = { kind: 'drop' };
  let addedToken = 0;
  let addedRead: AbortController | undefined;

  // Any in-flight read is superseded: its late result is dropped and its Input disposed.
  // Any export in flight is canceled and its late result dropped.
  const cancelLoad = () => {
    sourceLoader.cancel();
    overlayLoader.cancel();
    addedToken++;
    addedRead?.abort();
    exportFlow.cancel();
  };

  // A prepare-screen change while an export awaits its preflight or save picker drops that
  // export, so it never starts with the settings, trim or tool it was begun with.
  function supersedePending(): void {
    if (state.kind === 'prepare' && state.exporting) exportFlow.supersede();
  }

  function setState(next: AppState): void {
    const prev = state;
    const prevInput = inputOf(prev);
    const previousAdded = prev.kind === 'drop' ? undefined : prev.addedAudio;
    const nextAdded = next.kind === 'drop' ? undefined : next.addedAudio;
    state = next;
    const previousImage = prev.kind !== 'drop' ? prev.overlayAssets?.image : undefined;
    const nextImage = next.kind !== 'drop' ? next.overlayAssets?.image : undefined;
    if (previousImage && previousImage !== nextImage) previousImage.close();
    if (prevInput && inputOf(next) !== prevInput) prevInput.dispose();
    if (previousAdded && previousAdded !== nextAdded) previousAdded.input.dispose();
    const prevUrl = prev.kind === 'result' ? prev.output.url : null;
    if (prevUrl && !(next.kind === 'result' && next.output.url === prevUrl))
      URL.revokeObjectURL(prevUrl);
    onChange(state);
  }

  function toPrepare(from: Loaded & { addingAudio?: boolean }, notice?: Notice): void {
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
      addedAudio: from.addedAudio,
      ...(from.addingAudio ? { addingAudio: true } : {}),
      notice,
    });
  }

  const sourceLoader = createSourceLoader(deps, dispatch);
  const overlayLoader = createOverlayLoader(() => state, setState);
  const exportFlow = createExportFlow(deps, () => state, setState, toPrepare);

  function dispatch(action: AppAction): void {
    switch (action.type) {
      case 'addAudio':
        if (state.kind === 'prepare' && !state.exporting) void loadAddedAudio(action.file);
        return;
      case 'resetAll':
        if (state.kind === 'prepare' && !state.exporting) {
          overlayLoader.cancel();
          addedToken++;
          addedRead?.abort();
          const audioAuto = autoAudioExtract(state.source, state.caps);
          setState({
            ...state,
            settings: { ...state.auto.settings, passthrough: state.auto.alreadyOptimal },
            audioAuto,
            audioSettings: audioAuto,
            gifSettings: state.gifAuto,
            addedAudio: undefined,
            addingAudio: undefined,
            overlayAssets: undefined,
            notice: undefined,
          });
        }
        return;
      case 'removeAddedAudio':
        if (state.kind === 'prepare' && !state.exporting) {
          addedToken++;
          addedRead?.abort();
          const mix = normalizeAudioMix(
            state.settings.mix,
            state.settings.trim.end - state.settings.trim.start,
          );
          delete mix.added;
          applyMix({ ...state, addingAudio: undefined }, mix, undefined);
        }
        return;
      case 'setMix':
        if (state.kind === 'prepare' && !state.exporting) {
          supersedePending();
          const mix = normalizeAudioMix(
            action.value,
            state.settings.trim.end - state.settings.trim.start,
          );
          if (!state.addedAudio) delete mix.added;
          applyMix(state, mix, state.addedAudio);
        }
        return;
      case 'setAudioProcessing':
        if (state.kind === 'prepare') {
          supersedePending();
          const audioProcessing = normalizeAudioProcessing(
            action.value,
            state.settings.trim.end - state.settings.trim.start,
          );
          setState({
            ...state,
            exporting: undefined,
            notice: unlessMemoryConfirm(state.notice),
            settings: validateSettings(
              { ...state.settings, audioProcessing },
              state.auto,
              state.caps,
              state.source,
            ),
            audioSettings:
              state.audioSettings &&
              validateAudioExtract(
                { ...state.audioSettings, audioProcessing },
                state.audioAuto!,
                audioMixSource(state.source, state.addedAudio),
                state.caps,
              ),
          });
        }
        return;
      case 'pick':
        cancelLoad();
        sourceLoader.pick(action.file);
        return;
      case 'continueLarge': {
        const pending = state.kind === 'drop' ? state.notice?.pending : undefined;
        if (pending) void sourceLoader.load(pending);
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
              : {
                  ...state.settings,
                  trim,
                  ...(state.settings.mix
                    ? { mix: normalizeAudioMix(state.settings.mix, trim.end - trim.start) }
                    : {}),
                  ...(state.settings.audioProcessing
                    ? {
                        audioProcessing: normalizeAudioProcessing(
                          state.settings.audioProcessing,
                          trim.end - trim.start,
                        ),
                      }
                    : {}),
                },
            audioSettings: state.audioSettings && {
              ...state.audioSettings,
              trim,
              ...(state.audioSettings.mix
                ? { mix: normalizeAudioMix(state.audioSettings.mix, trim.end - trim.start) }
                : {}),
              ...(state.audioSettings.audioProcessing
                ? {
                    audioProcessing: normalizeAudioProcessing(
                      state.audioSettings.audioProcessing,
                      trim.end - trim.start,
                    ),
                  }
                : {}),
            },
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
            audioMixSource(state.source, state.addedAudio),
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
        if (state.kind === 'prepare' && !state.exporting)
          void overlayLoader.loadOverlayImage(action.file);
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
        if (
          state.kind === 'prepare' &&
          !state.exporting &&
          !state.addingAudio &&
          (state.tool !== 'audio' || state.audioSettings)
        )
          void exportFlow.startExport(state, action.confirmed === true);
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

  function applyMix(
    from: Extract<AppState, { kind: 'prepare' }>,
    mix: AudioMix,
    addedAudio?: AddedAudio,
  ): void {
    const effectiveSource = audioMixSource(from.source, addedAudio);
    const audioAuto =
      (mix.original.include && from.source.audio?.decodable) || (mix.added && addedAudio)
        ? autoAudioExtract(effectiveSource, from.caps)
        : null;
    const audioSettings = audioAuto
      ? validateAudioExtract(
          {
            ...(from.audioSettings ?? audioAuto),
            trim: from.settings.trim,
            mix,
            audioProcessing: from.settings.audioProcessing,
          },
          audioAuto,
          effectiveSource,
          from.caps,
        )
      : null;
    setState({
      ...from,
      addedAudio,
      addingAudio: from.addingAudio,
      notice: undefined,
      exporting: undefined,
      settings: validateSettings({ ...from.settings, mix }, from.auto, from.caps, from.source),
      audioAuto,
      audioSettings,
      tool: from.tool === 'audio' && !audioAuto ? 'shrink' : from.tool,
    });
  }

  async function loadAddedAudio(file: File): Promise<void> {
    if (state.kind !== 'prepare') return;
    const input = state.input;
    const token = ++addedToken;
    addedRead?.abort();
    const controller = new AbortController();
    addedRead = controller;
    supersedePending();
    setState({ ...state, addingAudio: true, exporting: undefined, notice: undefined });
    try {
      const added = await (deps.readAddedAudio ?? readAddedAudio)(file, controller.signal);
      if (token !== addedToken || state.kind !== 'prepare' || state.input !== input) {
        added.input.dispose();
        return;
      }
      const mix = normalizeAudioMix(
        state.settings.mix,
        state.settings.trim.end - state.settings.trim.start,
      );
      mix.added = { volumeDb: 0, offset: 0, loop: false };
      applyMix({ ...state, addingAudio: undefined }, mix, added);
    } catch (error) {
      if (token !== addedToken || state.kind !== 'prepare' || state.input !== input) return;
      setState({
        ...state,
        addingAudio: undefined,
        notice: {
          tone: 'error',
          title: 'Audio could not be added',
          message: error instanceof Error ? error.message : 'Choose a file with decodable audio.',
        },
      });
    }
  }

  return { dispatch, getState: () => state };
}

/** A memory confirm was asked for one estimate; a change to trim or settings voids it. */
function unlessMemoryConfirm(notice: Notice | undefined): Notice | undefined {
  return notice?.confirm === 'memory' ? undefined : notice;
}

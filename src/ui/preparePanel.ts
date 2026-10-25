import type { Settings } from '../core/types';
import { mountAudioPanel } from './audioPanel';
import { audioMixSource, type AppAction, type AppState } from './controller';
import { el } from './dom';
import { mountGifPanel } from './gifPanel';
import { mountResetAll } from './resetAll';
import { mountSettings } from './settingsPanel';

type Prepare = Extract<AppState, { kind: 'prepare' }>;
export interface PreparePanel {
  panel: {
    resetAll: ReturnType<typeof mountResetAll>;
    update(value: Prepare): void;
    setBusy(busy: boolean): void;
  };
  changeTransform: ((t: NonNullable<Settings['transform']>) => void) | undefined;
}

// Each tool's panel is mounted fresh on a switch; its settings live in the controller.
export function showPanel(
  panelHost: HTMLElement,
  value: Prepare,
  current: () => Prepare,
  dispatch: (a: AppAction) => void,
  onExport: () => void,
  onResetAll: () => void,
): PreparePanel {
  if (value.tool === 'audio' && value.audioAuto && value.audioSettings) {
    const audio = mountAudioPanel(panelHost, {
      auto: value.audioAuto,
      source: audioMixSource(value.source, value.addedAudio),
      caps: value.caps,
      value: value.audioSettings,
      onChange: (next) => dispatch({ type: 'setAudioSettings', value: next }),
      onExport,
      onResetAll,
    });
    const panel: PreparePanel['panel'] = {
      resetAll: audio.resetAll,
      update: (s) => s.audioSettings && audio.update(s.audioSettings),
      setBusy: audio.setBusy,
    };
    return { panel, changeTransform: undefined };
  }
  if (value.tool === 'audio') {
    const card = el('section', 'card export-summary');
    card.setAttribute('aria-label', 'Audio summary');
    const spec = el('div', 'spec');
    spec.append(el('h2', undefined, 'No audio to extract'));
    const resetAll = mountResetAll(spec, onResetAll);
    card.append(spec);
    panelHost.replaceChildren(card);
    const panel: PreparePanel['panel'] = { resetAll, update() {}, setBusy() {} };
    return { panel, changeTransform: undefined };
  }
  if (value.tool === 'gif' && value.gifSettings) {
    const gif = mountGifPanel(panelHost, {
      value: value.gifSettings,
      source: value.source,
      transform: value.settings.transform,
      onChange: (next) => dispatch({ type: 'setGifSettings', value: next }),
      onExport,
      onResetAll,
    });
    const changeTransform: PreparePanel['changeTransform'] = (transform) =>
      dispatch({ type: 'setSettings', value: { ...current().settings, transform } });
    const panel: PreparePanel['panel'] = {
      resetAll: gif.resetAll,
      update: (s) => s.gifSettings && gif.update(s.gifSettings, s.settings.transform),
      setBusy: gif.setBusy,
    };
    return { panel, changeTransform };
  }
  const shrink = mountSettings(panelHost, {
    auto: value.auto,
    caps: value.caps,
    source: value.source,
    value: value.settings,
    onChange: (next) => dispatch({ type: 'setSettings', value: next }),
    onExport,
    onResetAll,
  });
  const changeTransform = shrink.changeTransform;
  const panel: PreparePanel['panel'] = {
    resetAll: shrink.resetAll,
    update: (s) => shrink.update(s.settings),
    setBusy: shrink.setBusy,
  };
  return { panel, changeTransform };
}

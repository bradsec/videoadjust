import { boundCuts, normalizeCuts, type CutSettings } from '../core/cuts';
import type { AppState } from './controllerTypes';
import { validateSettings } from './controllerSettings';

export function withCuts(state: Extract<AppState, { kind: 'prepare' }>, value: CutSettings) {
  const cuts = boundCuts(value.cuts, state.source.durationSec);
  const activeCuts = normalizeCuts(cuts, state.settings.trim);
  return {
    ...state,
    notice: state.notice?.confirm === 'memory' ? undefined : state.notice,
    exporting: undefined,
    settings: validateSettings(
      {
        ...state.settings,
        cuts,
        cutFade: value.fade,
        passthrough: activeCuts.length ? false : state.settings.passthrough,
        targetRetryScale: undefined,
      },
      state.auto,
      state.caps,
      state.source,
    ),
    audioSettings: state.audioSettings && {
      ...state.audioSettings,
      cuts,
      copy: activeCuts.length ? false : state.audioSettings.copy,
    },
    gifSettings: state.gifSettings && { ...state.gifSettings, cuts },
  };
}

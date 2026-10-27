import { normalizeAudioMix } from '../core/audioMix';
import { normalizeAudioProcessing } from '../core/audioProcess';
import { keptDuration, normalizeCuts, type Cut } from '../core/cuts';
import type { Settings } from '../core/types';
import type { AppState } from './controllerTypes';
import { validateSettings } from './controllerSettings';

export const keptSeconds = (state: { settings: Pick<Settings, 'trim' | 'cuts'> }) =>
  keptDuration(state.settings.trim, state.settings.cuts);

export function withCuts(state: Extract<AppState, { kind: 'prepare' }>, value: Cut[]) {
  const cuts = normalizeCuts(value, state.settings.trim);
  const seconds = keptDuration(state.settings.trim, cuts);
  return {
    ...state,
    notice: state.notice?.confirm === 'memory' ? undefined : state.notice,
    exporting: undefined,
    settings: validateSettings(
      {
        ...state.settings,
        cuts,
        passthrough: cuts.length ? false : state.settings.passthrough,
        targetRetryScale: undefined,
      },
      state.auto,
      state.caps,
      state.source,
    ),
    audioSettings: state.audioSettings && {
      ...state.audioSettings,
      cuts,
      copy: cuts.length ? false : state.audioSettings.copy,
      ...(state.audioSettings.mix
        ? { mix: normalizeAudioMix(state.audioSettings.mix, seconds) }
        : {}),
      ...(state.audioSettings.audioProcessing
        ? {
            audioProcessing: normalizeAudioProcessing(state.audioSettings.audioProcessing, seconds),
          }
        : {}),
    },
    gifSettings: state.gifSettings && { ...state.gifSettings, cuts },
  };
}
